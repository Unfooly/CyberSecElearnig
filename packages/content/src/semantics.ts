import { LIVE_CALL_HANG_UP, LIVE_CALL_REJECT, LIVE_CALL_SILENCE, SWIPE_VERDICTS, ServerBlock } from './blocks';
import { DEFAULT_CONTENT_LOCALE, V6_NOTE_KINDS, V6_VOICE_ROLES, hasLocaleShape, requiredItemIds } from './common';
import { collectPaths } from './introspect';
import { localesIn, localizeContent, localizedPaths, missingTranslations } from './localize';
import { ContentModule, ContentValidationError, MODULE_SCHEMA_VERSION, ResolvedModule, moduleSchema } from './module';
import { validateRegex } from './regex';

// Walidacja semantyczna modułu (relacje między polami, których zod nie wyrazi w schemacie obiektu, kompilacja wzorców RE2).
// Kod tylko dla Node (patrz regex.ts): eksportowany z `@cyberszkolo/content/dist/node`.

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/**
 * Kształt rozmowy na żywo (LIVE_CALL, D-122) wystarczający do przejścia drzewa - zgodny z `ServerBlock` i z luźno typowanym `Block` w
 * apps/api. Krawędzie węzła ma jedna definicja (`liveCallEdges`) - tę samą czytają walidacja i ocena ścieżki odpowiedzi (`replayLiveCall`).
 */
export interface LiveCallLike {
  start: string;
  nodes: { id: string; choices: { id: string; next: string }[]; silence?: string; narration?: { voice?: string } }[];
  endings: { id: string; outcome?: string }[];
  infoChoices?: string[];
  /** Zakończenie po odrzuceniu połączenia na ekranie przychodzącym (`#id`, D-129). */
  reject?: string;
  /** Zakończenie po rozłączeniu się w trakcie rozmowy - dostępne w każdym węźle (`#id`, D-129). */
  hangUp?: string;
}
type LiveCallNodeLike = LiveCallLike['nodes'][number];

/** Zakończenie wskazane polem `reject` / `hangUp` (`#id` istniejącego zakończenia) albo null. */
function liveCallExit(block: LiveCallLike, target: string | undefined): string | null {
  if (typeof target !== 'string' || !target.startsWith('#')) return null;
  const ending = target.slice(1);
  return block.endings.some((candidate) => candidate?.id === ending) ? ending : null;
}

/** Cel krawędzi: zakończenie (`#id`) albo węzeł (id). */
export function liveCallTarget(next: string): { ending: string } | { node: string } {
  return next.startsWith('#') ? { ending: next.slice(1) } : { node: next };
}

/** Krawędzie węzła: odpowiedzi gracza i (gdy `allowSilence` i węzeł ją ma) cisza po upływie limitu. `step` - krok ścieżki odpowiedzi. */
export function liveCallEdges(node: LiveCallNodeLike, { allowSilence }: { allowSilence: boolean }): { step: string; next: string }[] {
  const choices = Array.isArray(node.choices) ? node.choices.map((choice) => ({ step: choice.id, next: choice.next })) : [];
  return allowSilence && typeof node.silence === 'string' ? [...choices, { step: LIVE_CALL_SILENCE, next: node.silence }] : choices;
}

/**
 * Przejście drzewa rozmowy po ścieżce odpowiedzi gracza (`choiceId` albo `silence`) od `start`. Zwraca zakończenie i przebyte odpowiedzi
 * albo null, gdy ścieżka nie zgadza się z grafem (nieznana odpowiedź w węźle, `silence` bez krawędzi albo niedozwolone, ścieżka kończy się
 * przed zakończeniem albo idzie dalej po nim) albo treść jest uszkodzona (obronnie - zapisana treść jest zwalidowana przy imporcie).
 * D-129: `reject` - jedyny krok ścieżki (połączenie odrzucone przed rozmową, gdy blok ma `reject`); `hangup` - ostatni krok w dowolnym
 * węźle (gdy blok ma `hangUp`), `hungUp: true` w wyniku (ocena zależy wtedy od tego, czy wcześniej oddano informację).
 */
export function replayLiveCall(
  block: LiveCallLike,
  path: readonly string[],
  { allowSilence }: { allowSilence: boolean },
): { ending: string; choices: string[]; hungUp?: boolean } | null {
  if (!Array.isArray(block.nodes) || !Array.isArray(block.endings) || !Array.isArray(path)) return null;
  if (path.length === 1 && path[0] === LIVE_CALL_REJECT) {
    const ending = liveCallExit(block, block.reject);
    return ending === null ? null : { ending, choices: [] };
  }
  let nodeId = block.start;
  const choices: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = block.nodes.find((candidate) => candidate?.id === nodeId);
    if (!node) return null;
    const step = path[i];
    if (step === LIVE_CALL_HANG_UP) {
      const ending = liveCallExit(block, block.hangUp);
      return ending === null || i !== path.length - 1 ? null : { ending, choices, hungUp: true };
    }
    const edge = liveCallEdges(node, { allowSilence }).find((candidate) => candidate.step === step);
    if (!edge || typeof edge.next !== 'string') return null;
    if (step !== LIVE_CALL_SILENCE) choices.push(step);
    const target = liveCallTarget(edge.next);
    if ('ending' in target) {
      if (i !== path.length - 1 || !block.endings.some((ending) => ending?.id === target.ending)) return null;
      return { ending: target.ending, choices };
    }
    nodeId = target.node;
  }
  return null;
}

function liveCallErrors(block: LiveCallLike): string[] {
  const errors: string[] = [];
  const nodeIds = block.nodes.map((node) => node.id);
  const endingIds = block.endings.map((ending) => ending.id);
  for (const id of duplicates(nodeIds)) errors.push(`nodes: powtórzony identyfikator "${id}"`);
  for (const id of duplicates(endingIds)) errors.push(`endings: powtórzony identyfikator "${id}"`);
  for (const id of nodeIds.filter((id) => endingIds.includes(id))) errors.push(`"${id}": to samo id węzła i zakończenia`);
  const choiceIds = block.nodes.flatMap((node) => node.choices.map((choice) => choice.id));
  for (const id of duplicates(choiceIds)) errors.push(`nodes[].choices: powtórzony identyfikator odpowiedzi "${id}" (unikalne w całym bloku)`);
  if (choiceIds.includes(LIVE_CALL_SILENCE)) errors.push('nodes[].choices: id "silence" jest zarezerwowane (cisza po upływie limitu)');
  // D-129: odrzucenie połączenia i rozłączenie się to osobne kroki ścieżki - ich id nie mogą być id odpowiedzi; oba prowadzą do dobrego
  // zakończenia (odrzucenie i rozłączenie się to zawsze właściwa reakcja; rozłączenie PO oddaniu informacji serwer ocenia jako złe).
  for (const reserved of [LIVE_CALL_REJECT, LIVE_CALL_HANG_UP]) {
    if (choiceIds.includes(reserved)) errors.push(`nodes[].choices: id "${reserved}" jest zarezerwowane (odrzucenie połączenia / rozłączenie się)`);
  }
  for (const [field, target] of [['reject', block.reject], ['hangUp', block.hangUp]] as const) {
    if (target === undefined) continue;
    const ending = liveCallExit(block, target);
    if (ending === null) errors.push(`${field}: "${target}" - oczekiwane #id istniejącego zakończenia`);
    else if (block.endings.find((candidate) => candidate.id === ending)?.outcome !== 'good') errors.push(`${field}: zakończenie "${ending}" musi mieć outcome "good"`);
    // Zakończenie odrzucenia/rozłączenia jest jawnie dobre (pole `client` + reguła wyżej), więc nie może być celem zwykłej odpowiedzi ani
    // ciszy - inaczej krawędzie `next` do niego zdradzałyby klientowi dobre odpowiedzi mimo tasowania (code review D-129).
    else if (block.nodes.some((node) => liveCallEdges(node, { allowSilence: true }).some((edge) => edge.next === `#${ending}`))) {
      errors.push(`${field}: zakończenie "${ending}" nie może być celem odpowiedzi ani ciszy (osobne zakończenie dla odrzucenia/rozłączenia)`);
    }
  }
  if (!nodeIds.includes(block.start)) errors.push(`start: nieznany węzeł "${block.start}"`);
  for (const id of block.infoChoices ?? []) {
    if (!choiceIds.includes(id)) errors.push(`infoChoices: nieznana odpowiedź "${id}"`);
  }
  for (const id of duplicates(block.infoChoices ?? [])) errors.push(`infoChoices: powtórzony identyfikator "${id}"`);
  if (!block.endings.some((ending) => ending.outcome === 'good')) errors.push('endings: co najmniej jedno zakończenie z outcome "good"');

  const edges = (node: LiveCallNodeLike) => liveCallEdges(node, { allowSilence: true }).map((edge) => edge.next);
  block.nodes.forEach((node, i) => {
    const label = `nodes[${i}] (${node.id})`;
    if (node.narration && node.narration.voice === undefined) errors.push(`${label}.narration.voice: kwestia dzwoniącego wymaga roli głosu`);
    for (const next of edges(node)) {
      const target = liveCallTarget(next);
      if ('ending' in target ? !endingIds.includes(target.ending) : !nodeIds.includes(target.node)) {
        errors.push(`${label}: krawędź "${next}" prowadzi donikąd (id węzła albo #id zakończenia)`);
      }
    }
  });

  // Cykle i osiągalność: DFS od startu (kolory: 1 - na stosie, 2 - odwiedzony).
  const state = new Map<string, number>();
  const reachedEndings = new Set<string>();
  const visit = (id: string) => {
    const node = block.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    state.set(id, 1);
    for (const next of edges(node)) {
      const target = liveCallTarget(next);
      if ('ending' in target) {
        reachedEndings.add(target.ending);
        continue;
      }
      const seen = state.get(target.node);
      if (seen === 1) errors.push(`nodes (${id} → ${target.node}): cykl w rozmowie`);
      else if (seen === undefined) visit(target.node);
    }
    state.set(id, 2);
  };
  if (nodeIds.includes(block.start)) visit(block.start);
  for (const target of [block.reject, block.hangUp]) {
    const ending = liveCallExit(block, target);
    if (ending !== null) reachedEndings.add(ending);
  }
  for (const id of nodeIds.filter((id) => !state.has(id))) errors.push(`nodes: węzeł "${id}" nieosiągalny od start`);
  for (const id of endingIds.filter((id) => !reachedEndings.has(id))) errors.push(`endings: zakończenie "${id}" nieosiągalne`);

  // Bez limitu czasu (ustawienie konta, przełącznik przed połączeniem) krawędzi `silence` nie ma - dobre zakończenie musi być osiągalne
  // samymi odpowiedziami, inaczej gracz bez limitu nie mógłby zdobyć wyniku 1.
  const good = new Set(block.endings.filter((ending) => ending.outcome === 'good').map((ending) => ending.id));
  const seenByChoices = new Set<string>();
  const reachesGood = (id: string): boolean => {
    if (seenByChoices.has(id)) return false;
    seenByChoices.add(id);
    const node = block.nodes.find((candidate) => candidate.id === id);
    return !!node && liveCallEdges(node, { allowSilence: false }).some(({ next }) => {
      const target = liveCallTarget(next);
      return 'ending' in target ? good.has(target.ending) : reachesGood(target.node);
    });
  };
  if (good.size > 0 && nodeIds.includes(block.start) && !reachesGood(block.start)) {
    errors.push('endings: zakończenie "good" musi być osiągalne bez ciszy (gracz bez limitu czasu nie ma krawędzi silence)');
  }
  return errors;
}

/**
 * Kształt hotspotu SCENE_HOTSPOTS wystarczający do spłaszczenia (id, required, evidence, note, zagnieżdżona scena) -
 * strukturalnie zgodny zarówno z `ServerBlock`'s wariantem SCENE_HOTSPOTS (blocks.ts), jak i z luźno typowanym `Block`
 * w apps/api (evaluate.ts, client-view.ts), które NIE importują pełnych typów zod (unikają zależności od `zod` w API).
 */
export interface HotspotLike {
  id: string;
  required?: boolean;
  evidence?: boolean;
  note?: { text: string; kind?: string };
  media?: { kind?: string; scene?: { hotspots?: readonly HotspotLike[] } };
}

/**
 * Spłaszcza hotspoty SCENE_HOTSPOTS (zewnętrzne + WEWNĘTRZNE z `media.kind: 'scene'`, B-086/D-071) do JEDNEJ listy -
 * DZIELONA definicja między walidacją modułu (poniżej) a apps/api (liczenie dowodów, walidacja `visited`/`noted`):
 * jedno miejsce decyduje, co się liczy, żeby te dwie strony nigdy nie rozjechały się w tym, co uznają za "ten sam zbiór".
 * Zawsze dokładnie jeden poziom (innerHotspotSchema nie ma już własnego `media.kind: 'scene'`), więc bez rekurencji.
 */
export function flattenHotspots(hotspots: readonly HotspotLike[]): HotspotLike[] {
  return hotspots.flatMap((h) => [h, ...(h.media?.kind === 'scene' ? (h.media.scene?.hotspots ?? []) : [])]);
}

/**
 * Notatka i dowód. Dowód (evidence: true) musi mieć `note`. Od schemaVersion 3 KAŻDA notatka ma `kind` (ikona w notatniku; jedna reguła
 * zamiast "kind tylko przy dowodzie"); moduły w wersji 2 nie mają tego pola, więc są zwolnione.
 */
function evidenceErrors(
  label: string,
  item: { evidence?: boolean; note?: { text: string; kind?: string } },
  kindRequired: boolean,
): string[] {
  const errors: string[] = [];
  if (item.evidence === true && !item.note) errors.push(`${label}: evidence wymaga pola note`);
  if (item.note && !item.note.kind && kindRequired) errors.push(`${label}: note wymaga note.kind (ikona w notatniku)`);
  return errors;
}

/**
 * Kotwice kryteriów w makiecie maila (criteria[].target): spójność z treścią maila. link -> linkId istnieje w email.links (bez quote);
 * text -> quote jest fragmentem email.body (bez linkId); attachment -> mail ma załącznik; sender i subject bez dodatkowych pól;
 * dwa kryteria nie mogą mieć tej samej kotwicy (kliknięcie fragmentu zaznacza dokładnie jedno kryterium).
 */
function emailTargetErrors(block: Extract<ServerBlock, { type: 'EMAIL_ANALYSIS' }>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  block.criteria.forEach((c, i) => {
    const t = c.target;
    if (!t) return;
    const label = `criteria[${i}].target`;
    if (t.kind === 'link') {
      if (!t.linkId || !block.email.links.some((l) => l.id === t.linkId)) errors.push(`${label}: link wymaga linkId istniejącego w email.links`);
      if (t.quote !== undefined) errors.push(`${label}: link nie ma quote`);
    } else if (t.kind === 'text') {
      if (!t.quote || !t.quote.trim() || !block.email.body.includes(t.quote)) errors.push(`${label}: quote musi być fragmentem email.body`);
      if (t.linkId !== undefined) errors.push(`${label}: text nie ma linkId`);
    } else {
      if (t.linkId !== undefined || t.quote !== undefined) errors.push(`${label}: ${t.kind} nie ma linkId ani quote`);
      if (t.kind === 'attachment' && !block.email.attachment) errors.push(`${label}: attachment wymaga email.attachment`);
    }
    const key = `${t.kind}:${t.linkId ?? ''}:${t.quote ?? ''}`;
    if (seen.has(key)) errors.push(`${label}: ta sama kotwica jest już użyta przez inne kryterium`);
    seen.add(key);
  });
  return errors;
}

/** Najwięcej wierszy-dowodów w jednej teczce - apps/api (evaluate.ts, `dossierAnswer`) używa tej samej stałej jako limitu `noted`. */
export const MAX_DOSSIER_EVIDENCE = 50;

export interface DossierRowLike {
  id: string;
  evidence?: boolean;
  note?: { text?: string; kind?: string };
  required?: boolean;
}

/**
 * Wiersze wszystkich dokumentów teczki (DOSSIER, D-083) w JEDNEJ liście - ta sama definicja dla walidacji modułu i apps/api
 * (liczenie dowodów, walidacja `noted`, notatki), jak flattenHotspots dla scen.
 */
export function flattenDossierRows(documents: readonly { rows?: readonly DossierRowLike[] }[]): DossierRowLike[] {
  return documents.flatMap((document) => [...(document.rows ?? [])]);
}

/**
 * Wiersze dokumentów teczki (DOSSIER) i konsoli przesłuchania (INTERROGATION.documents, D-118): komórki = kolumny, dowód z notatką,
 * notatka i `required` tylko przy dowodzie, `message` tylko przy zwykłej linijce.
 */
function dossierDocumentErrors(
  documents: readonly { columns: readonly string[]; rows: readonly (DossierRowLike & { cells: readonly string[]; message?: string })[] }[],
  kindRequired: boolean,
): string[] {
  const errors: string[] = [];
  documents.forEach((document, d) => {
    document.rows.forEach((row, r) => {
      const label = `documents[${d}].rows[${r}]`;
      if (row.cells.length !== document.columns.length) {
        errors.push(`${label}: liczba komórek (${row.cells.length}) różna od liczby kolumn (${document.columns.length})`);
      }
      errors.push(...evidenceErrors(label, row as { evidence?: boolean; note?: { text: string; kind?: string } }, kindRequired));
      // Zwykła linijka nie trafia do notatnika (zakreślenie pokazuje tylko "zwykłą operację") - notatka bez evidence byłaby martwa.
      if (row.note && row.evidence !== true) errors.push(`${label}: note bez evidence: true nigdy nie trafi do notatnika`);
      if (row.required === true && row.evidence !== true) errors.push(`${label}: required dotyczy wyłącznie wierszy-dowodów`);
      // Wiersz-dowód ma stały komunikat („Zakreślone…”) - własny message byłby martwy.
      if (row.message !== undefined && row.evidence === true) errors.push(`${label}: message dotyczy wyłącznie zwykłych linijek`);
    });
  });
  return errors;
}

/** Element bloku, który może dopisać notatkę (klucz `<blockId>.<id>`). */
export interface NoteItemLike {
  id: string;
  evidence?: boolean;
  note?: { text?: string; kind?: string };
  /**
   * Dowód ukryty do zebrania (sprzeczność przesłuchania D-118, obszar OSINT D-120) - znacznik semantyczny: KTÓRY to element, klient
   * nie wie, dopóki go nie zbierze. Od D-130 (stały mianownik, decyzja właściciela) licznik dowodów liczy te elementy do sumy od startu,
   * więc ich LICZBA jest jawna (ile kwestii kłamie, ile obszarów OSINT jest poprawnych); żaden kod produkcyjny nie czyta już tego pola.
   */
  hidden?: boolean;
}

interface InterrogationLineLike {
  id: string;
  fragment?: { evidence?: boolean; note?: NoteItemLike['note'] };
  contradiction?: { note?: NoteItemLike['note'] };
}

/**
 * Elementy bloku, które mogą dopisać notatkę: hotspoty (spłaszczone), pytania dialogu, kryteria maila, wiersze teczki, dowody nagrania,
 * kwestie przesłuchania (fragment, sprzeczność - dowód po podważeniu) i wiersze jego konsoli. JEDNA definicja dla walidacji modułu
 * (`refutedBy` wskazuje dowód z wcześniejszego bloku) i apps/api (treść notatek, licznik dowodów). Luźne typy - apps/api nie importuje
 * pełnych typów zod.
 */
export function noteItemsOf(block: { type: string } & Record<string, unknown>): NoteItemLike[] {
  switch (block.type) {
    case 'SCENE_HOTSPOTS':
      return Array.isArray(block.hotspots) ? flattenHotspots(block.hotspots as HotspotLike[]) : [];
    case 'DIALOGUE':
      return Array.isArray(block.questions) ? (block.questions as NoteItemLike[]) : [];
    case 'EMAIL_ANALYSIS':
      return Array.isArray(block.criteria) ? (block.criteria as NoteItemLike[]) : [];
    case 'DOSSIER':
      return Array.isArray(block.documents) ? flattenDossierRows(block.documents as { rows?: DossierRowLike[] }[]) : [];
    case 'CALL_RECORDING':
      // Każdy wpis `evidence` jest dowodem (notatka po trafieniu flagi jego segmentu).
      return Array.isArray(block.evidence) ? (block.evidence as NoteItemLike[]).map((item) => ({ id: item.id, evidence: true, note: item.note })) : [];
    case 'INTERROGATION': {
      const questions = Array.isArray(block.questions) ? (block.questions as { lines?: InterrogationLineLike[] }[]) : [];
      const lines = questions.flatMap((question) =>
        (question.lines ?? []).flatMap((line): NoteItemLike[] =>
          line.fragment
            ? [{ id: line.id, evidence: line.fragment.evidence, note: line.fragment.note }]
            : line.contradiction
              ? [{ id: line.id, evidence: true, note: line.contradiction.note, hidden: true }]
              : [],
        ),
      );
      const rows = Array.isArray(block.documents) ? flattenDossierRows(block.documents as { rows?: DossierRowLike[] }[]) : [];
      return [...lines, ...rows];
    }
    case 'OSINT_SPOT':
      // OSINT (D-120): dowodem jest użyty obszar z notatką (notatka po ocenie, gdy gracz go zaznaczył). Ukryty do zebrania (jak sprzeczność,
      // D-118) - które obszary, klient nie wie; od D-130 ich LICZBA jest w sumie licznika od startu (świadomie - patrz `hidden`).
      return Array.isArray(block.spots)
        ? (block.spots as (NoteItemLike & { used?: boolean })[])
            .filter((spot) => spot.used === true && spot.note)
            .map((spot) => ({ id: spot.id, evidence: true, note: spot.note, hidden: true }))
        : [];
    default:
      return [];
  }
}

// Sloty sceny odprawy (D-084): które rodzaje kroku mogą je mieć - zadania sprawy są w karcie (caseFile), dane gracza na legitymacji.
const BRIEFING_SLOT_KINDS: Record<string, string> = { tasks: 'caseFile', name: 'badge', number: 'badge', photo: 'badge' };

interface BriefingSceneLike {
  kind: string;
  image?: string;
  closedImage?: string;
  hotspot?: { id: string; x: number; y: number; w: number; h: number };
  openHotspot?: { id: string; x: number; y: number; w: number; h: number };
  slots?: Partial<Record<string, { x: number; y: number; w: number; h: number }>>;
  tasks?: unknown[];
  portrait?: Omit<BriefingSceneLike, 'kind' | 'tasks' | 'portrait'>;
}

/**
 * Grafika kroku odprawy (D-084): prostokąty w granicach sceny (x + w <= 100, y + h <= 100 - schemat pilnuje tylko 0-100 każdego pola),
 * każde pole sceny wymaga obrazu tła, `closedImage` (tylko caseFile - schemat) zawsze z hotspotem (klik otwiera teczkę), sloty zgodne z
 * rodzajem kroku. Istnienie plików obrazów sprawdza potok zasobów (scripts/content, --assets: plik w assets/ modułu).
 */
function briefingSceneErrors(label: string, step: BriefingSceneLike): string[] {
  const errors: string[] = [];
  const inScene = (name: string, rect: { x: number; y: number; w: number; h: number }) => {
    if (rect.x + rect.w > 100 || rect.y + rect.h > 100) errors.push(`${label}.${name}: prostokąt wychodzi poza scenę (x + w i y + h najwyżej 100)`);
  };
  const needsImage = (name: string) => errors.push(`${label}.${name} wymaga pola image (obrazu sceny kroku)`);
  // closedImage w scenie poziomej istnieje tylko w schemacie kroku caseFile (inne kroki odrzuca .strict()); w wariancie pionowym schemat
  // dopuszcza je przy każdym kroku, a odrzuca je dopiero zgodność ze sceną poziomą niżej (portrait).
  if (step.closedImage !== undefined) {
    if (step.image === undefined) needsImage('closedImage');
    if (step.hotspot === undefined) errors.push(`${label}.closedImage wymaga hotspotu (klik otwiera teczkę)`);
  }
  if (step.hotspot) {
    if (step.image === undefined) needsImage('hotspot');
    inScene('hotspot', step.hotspot);
  }
  // openHotspot (tylko caseFile - schemat): klik w otwarte akta; ma sens wyłącznie przy dwóch fazach (closedImage).
  if (step.openHotspot) {
    if (step.closedImage === undefined) errors.push(`${label}.openHotspot wymaga closedImage (dwie fazy teczki)`);
    inScene('openHotspot', step.openHotspot);
  }
  for (const [slot, rect] of Object.entries(step.slots ?? {})) {
    if (!rect) continue;
    if (step.image === undefined) needsImage(`slots.${slot}`);
    if (BRIEFING_SLOT_KINDS[slot] !== step.kind) errors.push(`${label}.slots.${slot}: dotyczy wyłącznie kroku ${BRIEFING_SLOT_KINDS[slot]}`);
    if (slot === 'tasks' && !(step.tasks && step.tasks.length > 0)) errors.push(`${label}.slots.tasks wymaga listy tasks`);
    inScene(`slots.${slot}`, rect);
  }
  // Wariant pionowy (D-098): te same zasady co scena pozioma (rekurencyjnie) plus zgodność z nią - odtwarzacz w pionie korzysta
  // WYŁĄCZNIE z pól portrait, więc każdy przedmiot i slot sceny poziomej musi mieć odpowiednik (inaczej w pionie zniknęłoby jedyne
  // przejście dalej albo dane gracza), a pionowa nie może mieć niczego ponad poziomą.
  if (step.portrait) {
    const p = step.portrait;
    if (step.image === undefined) errors.push(`${label}.portrait wymaga sceny poziomej (image)`);
    errors.push(...briefingSceneErrors(`${label}.portrait`, { kind: step.kind, tasks: step.tasks, ...p }));
    const pairs: [string, unknown, unknown][] = [
      ['closedImage', step.closedImage, p.closedImage],
      ['hotspot', step.hotspot, p.hotspot],
      ['openHotspot', step.openHotspot, p.openHotspot],
    ];
    for (const [name, landscape, portrait] of pairs) {
      if ((landscape === undefined) !== (portrait === undefined)) errors.push(`${label}.portrait.${name}: musi być tam, gdzie w scenie poziomej (i tylko tam)`);
    }
    // Ten sam przedmiot w obu orientacjach - to samo id (np. przyszła telemetria po id nie może rozjechać się między wariantami).
    for (const name of ['hotspot', 'openHotspot'] as const) {
      const landscapeId = step[name]?.id;
      const portraitId = p[name]?.id;
      if (landscapeId !== undefined && portraitId !== undefined && landscapeId !== portraitId) {
        errors.push(`${label}.portrait.${name}.id: "${portraitId}" zamiast "${landscapeId}" (jak w scenie poziomej)`);
      }
    }
    const landscapeSlots = Object.keys(step.slots ?? {}).sort().join(',');
    const portraitSlots = Object.keys(p.slots ?? {}).sort().join(',');
    if (landscapeSlots !== portraitSlots) errors.push(`${label}.portrait.slots: te same sloty co scena pozioma (${landscapeSlots || 'brak'})`);
  }
  return errors;
}

/** `required` jawnie ustawione co najmniej na jednym elemencie musi zostawiać co najmniej jeden element wymagany (przy obu sposobach wygrywa `required`). */
function checkRequiredFlags(label: string, items: { required?: boolean }[], errors: string[]) {
  if (!items.some((item) => item.required !== undefined)) return;
  if (!items.some((item) => item.required === true)) errors.push(`${label}: co najmniej jeden element musi mieć required: true`);
}

// Pola dostępne dopiero od schemaVersion 3 (moduł w wersji 2 ich nie używa). Ścieżki względem bloku: `a.b`, `a[].b`.
const V3_FEATURES = ['hotspots[].evidence', 'hotspots[].note', 'hotspots[].required', 'questions[].evidence', 'questions[].required',
  'questions[].lines', 'questions[].note.kind', 'character.avatar', 'criteria[].evidence', 'criteria[].note.kind', 'criteria[].target', 'email.date', 'email.attachment'];

// Pola dostępne dopiero od schemaVersion 4 (poziom bloku; metadane modułu - subtitle/level/objectives - i blok NARRATIVE mają
// osobne sprawdzenie w parseModule, bo nie są ścieżkami WEWNĄTRZ bloku). `hotspots[].media` obejmuje też zagnieżdżoną
// scenę (każda ścieżka `hotspots[].media.scene.hotspots[].*` zaczyna się od tego samego prefiksu - jeden wpis wystarcza,
// featuresUsed dopasowuje po prefiksie, nie dokładnym stringu).
const V4_FEATURES = ['character.opening', 'reactions.complete', 'reactions.result', 'email.to', 'hotspots[].action', 'hotspots[].media'];

// schemaVersion 5: blok BRIEFING w całości (z zadaniami sprawy) ma osobne sprawdzenie w parseModule (jak blok NARRATIVE i
// subtitle/level/objectives przy v4). Pola WEWNĄTRZ innych bloków z v5 (D-082): nagranie media audio z
// potoku TTS (`media.narration`, także w zagnieżdżonej scenie) i rola głosu `voice` w KAŻDEJ narracji (dowolna ścieżka
// kończąca się na `narration.voice`/`Narration.voice` - dlatego osobna funkcja, nie lista prefiksów jak v3/v4).
export function v5FeaturesUsed(block: ServerBlock): string[] {
  const paths = collectPaths(block);
  const used: string[] = [];
  if (paths.some((path) => /(^|\.)media\.narration(\.|$)/.test(path))) used.push('media.narration');
  if (paths.some((path) => /[nN]arration\.voice$/.test(path))) used.push('narration.voice');
  // Okienka easter egga (D-100): `outro` jest wymagane i występuje tylko w media.kind "popups".
  if (paths.some((path) => /(^|\.)media\.outro$/.test(path))) used.push('media.popups');
  return used;
}

/**
 * Okienka easter egga (D-100) to nie dowód: hotspot z media.kind "popups" nie ma evidence ani note i nie jest wymagany (znalezienie
 * go nie może być warunkiem ukończenia bloku ani zmieniać licznika dowodów).
 */
function popupsHotspotErrors(label: string, h: { media?: { kind: string }; evidence?: boolean; note?: unknown; required?: boolean }): string[] {
  if (h.media?.kind !== 'popups') return [];
  return h.evidence !== undefined || h.note !== undefined || h.required === true
    ? [`${label}: okienka (media.kind "popups") nie są dowodem - bez evidence, note i required: true`]
    : [];
}

/**
 * Media audio (D-082): dokładnie jedno z `audioUrl` (plik z --assets) / `narration` (nagranie z potoku TTS); `transcript` tylko
 * przy `audioUrl` - przy `narration` transkrypcją jest `narration.text` (jeden tekst, bez rozjazdu dwóch kopii).
 */
function audioMediaErrors(label: string, media: { kind: string; audioUrl?: string; transcript?: string; narration?: unknown } | undefined): string[] {
  if (media?.kind !== 'audio') return [];
  const errors: string[] = [];
  if ((media.audioUrl === undefined) === (media.narration === undefined)) errors.push(`${label}.media: audio wymaga dokładnie jednego z pól audioUrl/narration`);
  if (media.audioUrl !== undefined && media.transcript === undefined) errors.push(`${label}.media: audioUrl wymaga transcript`);
  if (media.narration !== undefined && media.transcript !== undefined) errors.push(`${label}.media: przy narration transkrypcją jest narration.text (bez transcript)`);
  return errors;
}

function featuresUsed(block: ServerBlock, features: string[]): string[] {
  const paths = new Set(collectPaths(block));
  return features.filter((feature) => [...paths].some((path) => path === feature || path.startsWith(`${feature}.`) || path.startsWith(`${feature}[]`)));
}

/** Pola z wersji 3 użyte w bloku (do sprawdzenia względem deklarowanego schemaVersion). */
export function v3FeaturesUsed(block: ServerBlock): string[] {
  return featuresUsed(block, V3_FEATURES);
}

/** Pola z wersji 4 użyte w bloku. */
export function v4FeaturesUsed(block: ServerBlock): string[] {
  return featuresUsed(block, V4_FEATURES);
}

// Typy bloków, których wynik jest wyliczany 0-1 (evaluate.ts) - jedyne, którym wolno mieć `reactions.result`. Pozostałe typy
// (eksploracyjne, VIDEO, NARRATIVE...) nie mają wyniku do progowania; dla nich zostaje wyłącznie `reactions.complete`.
// Eksportowane: apps/api (evaluate.ts, pickReaction) wybiera pasujący wpis reactions.result tą samą regułą, którą tu walidujemy.
export const SCORED_BLOCK_TYPES = [
  'QUIZ',
  'BRANCHING_SCENARIO',
  'EMAIL_ANALYSIS',
  'ORDERING',
  'TEXT_INPUT_GUIDED',
  'CALL_RECORDING',
  'INTERROGATION',
  'OSINT_SPOT',
  'LIVE_CALL',
  'SWIPE_SORT',
] as const;
// TEXT_INPUT_GUIDED: wynik binarny (poprawnie / po wyczerpaniu prób) - reakcje po `when`. Reszta: wynik 0-1 - reakcje po `minScore`.
export const WHEN_BASED_TYPES = new Set<string>(['TEXT_INPUT_GUIDED']);

/**
 * `reactions.result` (schemaVersion 4): tylko na blokach ocenianych (SCORED_BLOCK_TYPES); TEXT_INPUT_GUIDED używa `when`
 * (co najwyżej jeden wpis 'correct' i jeden 'incorrect'), reszta `minScore` (malejąco, bez duplikatów - pierwszy pasujący wpis
 * wygrywa, więc rosnąca/płaska lista uczyniłaby dalsze wpisy nieosiągalnymi).
 */
function reactionErrors(block: ServerBlock): string[] {
  const result = block.reactions?.result;
  if (!result) return [];
  const errors: string[] = [];
  if (!(SCORED_BLOCK_TYPES as readonly string[]).includes(block.type)) {
    errors.push(`reactions.result: nieprawidłowe dla bloku typu ${block.type} (brak wyniku 0-1 do progowania)`);
    return errors;
  }
  if (WHEN_BASED_TYPES.has(block.type)) {
    result.forEach((entry, i) => {
      if (entry.when === undefined) errors.push(`reactions.result[${i}]: dla TEXT_INPUT_GUIDED każdy wpis musi mieć "when"`);
    });
    const whens = result.map((entry) => entry.when).filter((w): w is 'correct' | 'incorrect' => w !== undefined);
    for (const dup of duplicates(whens)) errors.push(`reactions.result: powtórzone "when": "${dup}"`);
  } else {
    result.forEach((entry, i) => {
      if (entry.minScore === undefined) errors.push(`reactions.result[${i}]: dla ${block.type} każdy wpis musi mieć "minScore"`);
    });
    // Indeksy ORYGINALNE z result[] (nie skondensowanej listy samych minScore) - komunikat ma wskazywać prawdziwą pozycję
    // wpisu, także gdy któryś wcześniejszy wpis nie miał minScore wcale (błąd wyżej).
    const scores = result.map((entry, i) => [i, entry.minScore] as const).filter((pair): pair is [number, number] => pair[1] !== undefined);
    for (let k = 1; k < scores.length; k += 1) {
      const [i, score] = scores[k];
      if (score >= scores[k - 1][1]) errors.push(`reactions.result[${i}]: lista minScore musi być malejąca (pierwszy pasujący wpis wygrywa)`);
    }
  }
  return errors;
}

/** Zwraca listę błędów semantycznych bloku (pusta = OK). */
export function validateBlockSemantics(block: ServerBlock, schemaVersion: number = MODULE_SCHEMA_VERSION): string[] {
  const errors: string[] = [...reactionErrors(block)];
  const kindRequired = schemaVersion >= 3;
  const checkUnique = (label: string, ids: string[]) => {
    for (const id of duplicates(ids)) errors.push(`${label}: powtórzony identyfikator "${id}"`);
  };
  const checkSubset = (label: string, required: string[] | undefined, ids: string[]) => {
    for (const id of required ?? []) {
      if (!ids.includes(id)) errors.push(`${label}: nieznany identyfikator "${id}"`);
    }
  };

  switch (block.type) {
    case 'QUIZ':
    case 'BRANCHING_SCENARIO': {
      block.options.forEach((option, i) => {
        const marks = Number(option.correct !== undefined) + Number(option.outcome !== undefined);
        if (marks !== 1) errors.push(`options[${i}]: dokładnie jedno z pól correct/outcome`);
        if (block.type === 'QUIZ' && option.outcome !== undefined) errors.push(`options[${i}]: QUIZ używa "correct"`);
        if (block.type === 'BRANCHING_SCENARIO' && option.correct !== undefined) {
          errors.push(`options[${i}]: BRANCHING_SCENARIO używa "outcome"`);
        }
      });
      const correct = block.options.filter((o) => o.correct === true || o.outcome === 'correct').length;
      if (correct < 1) errors.push('options: brak poprawnej opcji');
      break;
    }
    case 'SCENE_HOTSPOTS': {
      // Id i required liczone na SPŁASZCZONEJ liście (ta sama funkcja co apps/api - flattenHotspots wyżej w tym pliku).
      const outerIds = block.hotspots.map((h) => h.id);
      checkUnique('hotspots', flattenHotspots(block.hotspots).map((h) => h.id));
      checkSubset('requiredHotspots', block.requiredHotspots, outerIds); // lista jest PRZESTARZAŁA i starsza niż zagnieżdżanie: tylko zewnętrzne.
      // Ekran monitora sceny zagnieżdżonej (D-116) w granicach grafiki pulpitu.
      block.hotspots.forEach((h, i) => {
        const screen = h.media?.kind === 'scene' ? h.media.scene.screen : undefined;
        if (screen && (screen.x + screen.w > 100 || screen.y + screen.h > 100)) errors.push(`hotspots[${i}].media.scene.screen: prostokąt wychodzi poza grafikę`);
      });
      // Wariant pionowy sceny (D-116): grafika i prostokąty razem, dokładnie te same przedmioty co scena pozioma (inaczej w pionie
      // zniknąłby przedmiot albo drzwi), prostokąty w granicach grafiki.
      if ((block.imagePortrait === undefined) !== (block.portraitHotspots === undefined)) {
        errors.push('imagePortrait i portraitHotspots występują razem (wariant pionowy sceny)');
      }
      if (block.portraitHotspots) {
        const portraitIds = block.portraitHotspots.map((h) => h.id);
        checkUnique('portraitHotspots', portraitIds);
        for (const id of outerIds.filter((id) => !portraitIds.includes(id))) errors.push(`portraitHotspots: brak przedmiotu "${id}" (te same id co hotspots)`);
        for (const id of portraitIds.filter((id) => !outerIds.includes(id))) errors.push(`portraitHotspots: nieznany przedmiot "${id}"`);
        block.portraitHotspots.forEach((h, i) => {
          if (h.x + h.width > 100 || h.y + h.height > 100) errors.push(`portraitHotspots[${i}] (${h.id}): prostokąt wychodzi poza grafikę`);
        });
        // Napisy sceny na grafice pionowej: bez `portrait` odtwarzacz użyłby prostokąta z grafiki poziomej (inne położenie).
        (block.textLayer ?? []).forEach((entry, i) => {
          if (!entry.portrait) errors.push(`textLayer[${i}] (${entry.id}): scena z imagePortrait wymaga prostokąta portrait`);
        });
      }
      // Okienka easter egga (D-100) nigdy nie są wymagane - także przez przestarzałą listę; wyróżnienia unikalne w bloku (etykieta po id).
      const popupsHotspots = flattenHotspots(block.hotspots).filter((h) => h.media?.kind === 'popups');
      for (const h of popupsHotspots) {
        if (block.requiredHotspots?.includes(h.id)) errors.push(`requiredHotspots: "${h.id}" to okienka (media.kind "popups") - nie mogą być wymagane`);
      }
      checkUnique(
        'media.badge.id',
        popupsHotspots.flatMap((h) => {
          const badge = (h.media as { badge?: { id: string } }).badge;
          return badge ? [badge.id] : [];
        }),
      );
      block.hotspots.forEach((h, i) => {
        if (h.x + h.width > 100 || h.y + h.height > 100) errors.push(`hotspots[${i}]: obszar wychodzi poza obraz`);
        if (h.action === 'next') {
          // "Drzwi": klik kończy blok jak przycisk "Dalej" - nigdy nie otwiera karty, więc content/media/evidence/note
          // byłyby martwą konfiguracją (autor mógłby pomyśleć, że działają). `required` też zakazane: drzwi nigdy nie
          // trafiają do `visited` (klik od razu wysyła submit, nie "odwiedza" siebie samych) - required:true na nich
          // byłoby ślepym zaułkiem (blok nigdy nie mógłby się ukończyć: warunek gotowości nigdy nie zostałby spełniony).
          if (h.content !== undefined || h.media !== undefined || h.evidence !== undefined || h.note !== undefined || h.required !== undefined) {
            errors.push(`hotspots[${i}]: action "next" (drzwi) nie może mieć content, media, evidence, note ani required`);
          }
        } else {
          // Zbliżenie przedmiotu (D-086) pokazuje grafikę, nie tekst karty - content jest wymagane tylko przy przedmiocie bez mediów.
          if (h.content === undefined && h.media === undefined) errors.push(`hotspots[${i}]: content albo media jest wymagane (chyba że action: "next")`);
          // Przedmiot ze sceną zagnieżdżoną nie ma "Zabierz" (zbliżenie przechodzi w scenę) - dowód byłby niemożliwy do zebrania.
          if (h.media?.kind === 'scene' && (h.evidence !== undefined || h.note !== undefined)) {
            errors.push(`hotspots[${i}]: przedmiot ze sceną zagnieżdżoną (media.kind "scene") nie może mieć evidence ani note - dowody są w jego scenie`);
          }
          errors.push(...evidenceErrors(`hotspots[${i}]`, h, kindRequired));
        }
        errors.push(...audioMediaErrors(`hotspots[${i}]`, h.media));
        errors.push(...popupsHotspotErrors(`hotspots[${i}]`, h));
        if (h.media?.kind === 'scene') {
          h.media.scene.hotspots.forEach((ih, j) => {
            const label = `hotspots[${i}].media.scene.hotspots[${j}]`;
            if (ih.x + ih.width > 100 || ih.y + ih.height > 100) errors.push(`${label}: obszar wychodzi poza obraz`);
            errors.push(...evidenceErrors(label, ih, kindRequired));
            errors.push(...audioMediaErrors(label, ih.media));
            errors.push(...popupsHotspotErrors(label, ih));
          });
        }
      });
      // Drzwi (action:'next') WYKLUCZONE z puli required: nigdy nie trafiają do `visited` same z siebie (klik od razu
      // kończy blok, nie "odwiedza" siebie), więc licząc je "wszystkie required" (fallback, brak jawnych flag) scena
      // z SAMYMI drzwiami (bez innych hotspotów - np. "korytarz") nigdy nie mogłaby się ukończyć.
      const doorIds = new Set(block.hotspots.filter((h) => h.action === 'next').map((h) => h.id));
      // Scena z drzwiami może mieć ZERO wymaganych przedmiotów (D-086: korytarz - tablica jest dowodem opcjonalnym, wyjściem są drzwi),
      // ale tylko gdy KAŻDY przedmiot ma jawnie required: false (świadoma decyzja autora). Częściowe `false` przy reszcie nieustawionej
      // to dalej błąd (pomyłka), a bez drzwi co najmniej jeden przedmiot musi być wymagany.
      // Okienka easter egga (D-100) nigdy nie są wymagane (także w domyślnym „wszystkie”) - poza pulą jak drzwi (apps/api evaluate.ts).
      const items = flattenHotspots(block.hotspots).filter((h) => !doorIds.has(h.id) && h.media?.kind !== 'popups');
      const optionalByDesign = doorIds.size > 0 && items.length > 0 && items.every((h) => h.required === false);
      if (!optionalByDesign) checkRequiredFlags('hotspots', items, errors);
      break;
    }
    case 'DIALOGUE': {
      const ids = block.questions.map((q) => q.id);
      checkUnique('questions', ids);
      checkSubset('requiredQuestions', block.requiredQuestions, ids);
      block.questions.forEach((q, i) => {
        if ((q.answer === undefined) === (q.lines === undefined)) {
          errors.push(`questions[${i}]: dokładnie jedno z pól answer / lines`);
        }
        errors.push(...evidenceErrors(`questions[${i}]`, q, kindRequired));
      });
      checkRequiredFlags('questions', block.questions, errors);
      break;
    }
    case 'EMAIL_ANALYSIS': {
      checkUnique('criteria', block.criteria.map((c) => c.id));
      checkUnique('email.links', block.email.links.map((l) => l.id));
      block.criteria.forEach((c, i) => {
        errors.push(...evidenceErrors(`criteria[${i}]`, c, kindRequired));
        if (c.evidence === true && c.correct !== true) errors.push(`criteria[${i}]: dowodem może być tylko kryterium poprawne (correct: true)`);
      });
      errors.push(...emailTargetErrors(block));
      break;
    }
    case 'TEXT_INPUT_GUIDED': {
      if (block.answer.accept.length === 0 && block.answer.regex === undefined) {
        errors.push('answer: wymagane accept albo regex');
      }
      if (block.answer.regex !== undefined) {
        errors.push(...validateRegex(block.answer.regex));
      }
      if (block.hints.length >= block.maxAttempts) {
        errors.push('hints: podpowiedzi przysługują po błędnej próbie, więc musi ich być mniej niż maxAttempts');
      }
      break;
    }
    case 'ORDERING': {
      checkUnique('items', block.items.map((i) => i.id));
      break;
    }
    case 'TABS': {
      const ids = block.tabs.map((t) => t.id);
      checkUnique('tabs', ids);
      checkSubset('requiredTabs', block.requiredTabs, ids);
      break;
    }
    case 'DOSSIER': {
      // Id dokumentów i wierszy unikalne w CAŁYM bloku (jedna przestrzeń kluczy notatek `<blockId>.<id>` i odpowiedzi opened/noted).
      const rows = flattenDossierRows(block.documents);
      checkUnique('documents/rows', [...block.documents.map((d) => d.id), ...rows.map((r) => r.id)]);
      // Teczka jest nieoceniana, a wszystkie jej pola są publiczne (D-083) - waga > 0 dawałaby punkty za samo przejście.
      if (block.weight !== undefined && block.weight > 0) errors.push('weight: blok DOSSIER jest nieoceniany (waga musi być 0)');
      // Odpowiedź `noted` przyjmuje najwyżej MAX_DOSSIER_EVIDENCE id (evaluate.ts) - więcej dowodów = bloku nie da się ukończyć.
      const evidenceCount = rows.filter((r) => r.evidence === true).length;
      if (evidenceCount > MAX_DOSSIER_EVIDENCE) {
        errors.push(`documents: ${evidenceCount} wierszy-dowodów, najwyżej ${MAX_DOSSIER_EVIDENCE} (limit odpowiedzi noted)`);
      }
      errors.push(...dossierDocumentErrors(block.documents, kindRequired));
      break;
    }
    case 'INTERROGATION': {
      // Przesłuchanie (D-118): id pytań unikalne; id kwestii, dokumentów i wierszy konsoli - w JEDNEJ przestrzeni (klucze notatek
      // `<blockId>.<id>`, odpowiedzi noted/opened i /challenge).
      checkUnique('questions', block.questions.map((q) => q.id));
      const lines = block.questions.flatMap((q) => q.lines);
      const documents = block.documents ?? [];
      const rows = flattenDossierRows(documents);
      checkUnique('lines/documents/rows', [...lines.map((l) => l.id), ...documents.map((d) => d.id), ...rows.map((r) => r.id)]);
      checkRequiredFlags('questions', block.questions, errors);
      block.questions.forEach((question, q) => {
        question.lines.forEach((line, l) => {
          const label = `questions[${q}].lines[${l}]`;
          // Kwestie mówi postać, nie lektor - nagranie wymaga roli głosu (jak segmenty nagrania).
          if (line.narration && line.narration.voice === undefined) errors.push(`${label}.narration.voice: kwestia postaci wymaga roli głosu`);
          if (line.fragment && line.contradiction) errors.push(`${label}: kwestia jest fragmentem do notatnika ALBO sprzecznością, nie oboma`);
          if (line.fragment) errors.push(...evidenceErrors(`${label}.fragment`, line.fragment, kindRequired));
          const contradiction = line.contradiction;
          if (contradiction) {
            if (!/^[^.]+\.[^.]+$/.test(contradiction.refutedBy)) {
              errors.push(`${label}.contradiction.refutedBy: klucz dowodu w postaci "<idBloku>.<idElementu>"`);
            }
            if (kindRequired && contradiction.note.kind === undefined) errors.push(`${label}.contradiction.note.kind: dowód wymaga rodzaju notatki`);
          }
        });
      });
      // Konsola: otwiera ją dokładnie jedno pytanie (opensDocuments) - i tylko gdy blok ma dokumenty.
      const openers = block.questions.filter((q) => q.opensDocuments === true).length;
      if (documents.length > 0 && openers !== 1) errors.push('documents: konsolę otwiera dokładnie jedno pytanie z opensDocuments: true');
      if (documents.length === 0 && openers > 0) errors.push('questions: opensDocuments bez documents (nie ma czego otworzyć)');
      errors.push(...dossierDocumentErrors(documents, kindRequired));
      // `noted` (fragmenty + wiersze konsoli) ma ten sam limit odpowiedzi co teczka (evaluate.ts).
      const notable = lines.filter((line) => line.fragment).length + rows.filter((row) => row.evidence === true).length;
      if (notable > MAX_DOSSIER_EVIDENCE) errors.push(`${notable} fragmentów i wierszy-dowodów, najwyżej ${MAX_DOSSIER_EVIDENCE} (limit odpowiedzi noted)`);
      // Bez sprzeczności przesłuchanie nie ma wyniku (samo przejście) - waga > 0 dawałaby punkty za przejście, a reakcje na wynik (także przy
      // jawnej wadze 0) nigdy by się nie pokazały.
      const scored = lines.some((line) => line.contradiction) && block.weight !== 0;
      if (!lines.some((line) => line.contradiction) && block.weight !== undefined && block.weight > 0) {
        errors.push('weight: przesłuchanie bez sprzeczności jest nieoceniane (waga musi być 0)');
      }
      if (!scored && block.reactions?.result) errors.push('reactions.result: przesłuchanie bez wyniku (bez sprzeczności albo z wagą 0) nie ma reakcji na wynik');
      // Wymagany wiersz konsoli jest wymagany tylko wtedy, gdy gracz musi otworzyć konsolę - pytanie konsoli też wymagane.
      const opener = block.questions.find((q) => q.opensDocuments === true);
      const requiredQuestions = requiredItemIds(block.questions, undefined);
      if (opener && rows.some((row) => row.required === true) && !requiredQuestions.includes(opener.id)) {
        errors.push(`questions: wymagane wiersze konsoli wymagają wymaganego pytania konsoli ("${opener.id}")`);
      }
      break;
    }
    case 'OSINT_SPOT': {
      // OSINT (D-120): id obszarów unikalne; przynajmniej jeden użyty (inaczej wynik dzieliłby przez zero); notatka (dowód) tylko przy
      // użytym, wyjaśnienie pułapki tylko przy nieużytym; obszary w granicach grafiki; nagranie głosem postaci; ukryte zakończenia unikalne.
      const ids = block.spots.map((spot) => spot.id);
      checkUnique('spots', ids);
      if (!block.spots.some((spot) => spot.used)) errors.push('spots: co najmniej jeden obszar z used: true (wynik to trafione użyte / wszystkie użyte)');
      block.spots.forEach((spot, i) => {
        const label = `spots[${i}] (${spot.id})`;
        if (spot.note && !spot.used) errors.push(`${label}: note (dowód) tylko przy obszarze użytym przez oszusta`);
        if (spot.trapText !== undefined && spot.used) errors.push(`${label}: trapText tylko przy pułapce (used: false)`);
        if (spot.note && kindRequired && spot.note.kind === undefined) errors.push(`${label}.note.kind: dowód wymaga rodzaju notatki`);
        if (spot.x + spot.w > 100 || spot.y + spot.h > 100) errors.push(`${label}: obszar wychodzi poza grafikę`);
        const media = spot.media;
        if (media) {
          if (media.narration.voice === undefined) errors.push(`${label}.media.narration.voice: nagranie wymaga roli głosu`);
          if (media.image !== undefined && media.alt === undefined) errors.push(`${label}.media.alt: kadr odtwarzacza (image) wymaga opisu alt`);
          if (media.imagePortrait !== undefined && media.image === undefined) errors.push(`${label}.media.imagePortrait: wariant pionowy wymaga image`);
          if (media.imagePortrait !== undefined) {
            (media.textLayer ?? []).forEach((entry, t) => {
              if (!entry.portrait) errors.push(`${label}.media.textLayer[${t}] (${entry.id}): kadr z imagePortrait wymaga prostokąta portrait`);
            });
          }
        }
      });
      for (const id of duplicates(block.spots.flatMap((spot) => (spot.media?.secretEnding ? [spot.media.secretEnding.id] : [])))) {
        errors.push(`spots: powtórzone ukryte zakończenie "${id}"`);
      }
      // Wariant pionowy (jak scena, D-116): grafika i obszary razem, te same id, w granicach; napisy strony z prostokątem pionowym.
      if ((block.imagePortrait === undefined) !== (block.portraitSpots === undefined)) errors.push('imagePortrait i portraitSpots występują razem (wariant pionowy)');
      if (block.portraitSpots) {
        const portraitIds = block.portraitSpots.map((spot) => spot.id);
        checkUnique('portraitSpots', portraitIds);
        for (const id of ids.filter((id) => !portraitIds.includes(id))) errors.push(`portraitSpots: brak obszaru "${id}" (te same id co spots)`);
        for (const id of portraitIds.filter((id) => !ids.includes(id))) errors.push(`portraitSpots: nieznany obszar "${id}"`);
        block.portraitSpots.forEach((spot, i) => {
          if (spot.x + spot.w > 100 || spot.y + spot.h > 100) errors.push(`portraitSpots[${i}] (${spot.id}): obszar wychodzi poza grafikę`);
        });
        (block.textLayer ?? []).forEach((entry, i) => {
          if (!entry.portrait) errors.push(`textLayer[${i}] (${entry.id}): strona z imagePortrait wymaga prostokąta portrait`);
        });
      }
      break;
    }
    case 'LIVE_CALL': {
      // Rozmowa na żywo (D-122): id węzłów i zakończeń rozłączne, id odpowiedzi unikalne w całym bloku (infoChoices i ścieżka odpowiedzi),
      // każda krawędź prowadzi do istniejącego węzła/zakończenia, graf bez cykli, każdy węzeł i zakończenie osiągalne od `start`,
      // co najmniej jedno zakończenie dobre; kwestie dzwoniącego głosem postaci.
      errors.push(...liveCallErrors(block));
      break;
    }
    case 'SWIPE_SORT': {
      // Segregowanie wiadomości (D-132): id kart unikalne; co najmniej jedna karta z każdym werdyktem (inaczej „wszystko w lewo” wygrywa).
      checkUnique('cards', block.cards.map((card) => card.id));
      for (const verdict of SWIPE_VERDICTS) {
        if (!block.cards.some((card) => card.correct === verdict)) errors.push(`cards: brak karty z werdyktem "${verdict}"`);
      }
      break;
    }
    case 'BRIEFING': {
      // Odprawa nie ma wyniku (zapis bez odpowiedzi, bez punktów) - waga > 0 tylko zaniżyłaby wynik modułu.
      if (block.weight !== undefined && block.weight > 0) errors.push('weight: blok BRIEFING jest nieoceniany (waga musi być 0)');
      block.steps.forEach((step, index) => errors.push(...briefingSceneErrors(`steps[${index}]`, step)));
      break;
    }
    case 'CALL_RECORDING': {
      // Nagranie (D-115): jedna przestrzeń id segmentów; flaga najwyżej jedna na segment; dowód tylko na segmencie z flagą (notatka
      // trafia do notatnika po trafieniu TEJ flagi); każdy segment ma rolę głosu (kwestie rozmowy mówią postacie, nie lektor).
      const segmentIds = block.segments.map((s) => s.id);
      checkUnique('segments', segmentIds);
      const flagged = block.flags.map((f) => f.segmentId);
      for (const id of duplicates(flagged)) errors.push(`flags: segment "${id}" ma więcej niż jedną flagę`);
      checkSubset('flags', flagged, segmentIds);
      block.segments.forEach((segment, i) => {
        if (segment.narration.voice === undefined) errors.push(`segments[${i}].narration.voice: kwestia nagrania wymaga roli głosu`);
      });
      const evidence = block.evidence ?? [];
      checkUnique('evidence', evidence.map((e) => e.id));
      evidence.forEach((item, i) => {
        if (!flagged.includes(item.segmentId)) errors.push(`evidence[${i}].segmentId: "${item.segmentId}" nie jest segmentem z flagą`);
        if (kindRequired && item.note.kind === undefined) errors.push(`evidence[${i}].note.kind: dowód wymaga rodzaju notatki`);
      });
      break;
    }
    case 'ANNOTATED_REPLAY': {
      // Omówienie (D-115): znaczniki 1..N po kolei; kotwica zgodna ze źródłem (segment dla transkrypcji, punkt dla grafiki). Istnienie
      // bloku źródłowego i segmentów - parseModule (relacja między blokami).
      block.markers.forEach((marker, i) => {
        if (marker.n !== i + 1) errors.push(`markers[${i}].n: znaczniki numerowane kolejno od 1 (oczekiwano ${i + 1})`);
        const { segmentId, x, y } = marker.anchor;
        if (block.source.kind === 'transcript' && (segmentId === undefined || x !== undefined || y !== undefined)) {
          errors.push(`markers[${i}].anchor: przy source.kind "transcript" kotwicą jest wyłącznie segmentId`);
        }
        if (block.source.kind === 'image' && (segmentId !== undefined || x === undefined || y === undefined)) {
          errors.push(`markers[${i}].anchor: przy source.kind "image" kotwicą jest punkt { x, y }`);
        }
      });
      if (block.weight !== undefined && block.weight > 0) errors.push('weight: blok ANNOTATED_REPLAY jest nieoceniany (waga musi być 0)');
      break;
    }
    default:
      break;
  }
  return errors;
}

/**
 * Ostrzeżenia (NIE błędy) dla poprawnego modułu: przestarzałe pola, które nadal działają. Import wypisuje je autorowi. PR 4 usuwa
 * requiredHotspots[] / requiredQuestions[] po migracji fixtur.
 */
export function moduleWarnings(stored: ContentModule): string[] {
  const warnings: string[] = [];
  // Częściowe tłumaczenie (schemaVersion 6): moduł ma już jakiś język poza `pl`, ale nie w każdym polu wielojęzycznym - gracz w tym
  // języku zobaczy w tych polach tekst `pl` (fallback). Moduł tylko po polsku nie dostaje ostrzeżeń.
  for (const locale of localesIn(stored)) {
    if (locale === DEFAULT_CONTENT_LOCALE) continue;
    for (const path of missingTranslations(stored, locale)) warnings.push(`brak tłumaczenia ${locale.toUpperCase()}: ${path}`);
  }
  const contentModule = localizeContent(stored, DEFAULT_CONTENT_LOCALE);
  contentModule.blocks.forEach((block, index) => {
    const where = `blocks[${index}] (${block.id})`;
    // D-096: odtwarzacz nie pokazuje postaci (D-093) - mascot i pose są przestarzałe.
    if (block.mascot !== undefined) warnings.push(`${where}: mascot jest przestarzałe, użyj tip (sam tekst podpowiedzi)`);
    if (block.reactions?.complete?.pose !== undefined || block.reactions?.result?.some((entry) => entry.pose !== undefined)) {
      warnings.push(`${where}: reactions[].pose jest przestarzałe i ignorowane - zostaw sam text`);
    }
    if (block.type === 'SCENE_HOTSPOTS' && block.requiredHotspots !== undefined) {
      warnings.push(`${where}: requiredHotspots[] jest przestarzałe, użyj hotspots[].required`);
    }
    if (block.type === 'SCENE_HOTSPOTS') {
      block.hotspots.forEach((h, i) => {
        if (h.media?.kind === 'scene') {
          h.media.scene.hotspots.forEach((ih, j) => {
            if (ih.note && ih.evidence !== true) {
              warnings.push(`${where}: hotspots[${i}].media.scene.hotspots[${j}].note bez evidence: true nigdy nie trafi do notatnika`);
            }
          });
        }
        if (h.note && h.evidence !== true) warnings.push(`${where}: hotspots[${i}].note bez evidence: true nigdy nie trafi do notatnika`);
      });
    }
    if (block.type === 'EMAIL_ANALYSIS') {
      const anchored = block.criteria.filter((c) => c.target);
      // Klikalne fragmenty tylko przy poprawnych kryteriach zdradzają odpowiedź (D-056): kotwice mają mieć też kryteria błędne.
      if (anchored.length > 0 && anchored.every((c) => c.correct === true)) {
        warnings.push(`${where}: wszystkie kryteria z target są poprawne: klikalność fragmentów zdradza odpowiedź (dodaj kotwice kryteriom błędnym)`);
      }
      block.criteria.forEach((c, i) => {
        const quote = c.target?.kind === 'text' ? c.target.quote : undefined;
        if (quote && block.email.body.split(quote).length > 2) {
          warnings.push(`${where}: criteria[${i}].target.quote występuje w treści więcej niż raz (podświetlone zostanie pierwsze wystąpienie)`);
        }
      });
    }
    if (block.type === 'DIALOGUE' && block.requiredQuestions !== undefined) {
      warnings.push(`${where}: requiredQuestions[] jest przestarzałe, użyj questions[].required`);
    }
  });
  return warnings;
}

/**
 * Każda NAGRYWANA narracja w bloku (`narration` na dowolnej głębokości i `answerNarration` pytań rozmowy - jak NARRATION_PATHS potoku
 * scripts/content) i tekst, który przeczyta głos (`spokenText`, a bez niego `text`). Podpowiedzi (`hints[].narration`) są tylko tekstem
 * (pola `secret`, bez nagrań) - pomijane. Wyjątki muszą odpowiadać TEXT_ONLY_NARRATION_PATHS w scripts/content/src/pipeline.ts (nowe pole
 * narracji tylko-tekstowej = dopisać je tutaj i tam).
 */
export function narrationsIn(node: unknown, path = ''): { path: string; spoken: string }[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => narrationsIn(item, `${path}[${index}]`));
  if (!node || typeof node !== 'object') return [];
  const found: { path: string; spoken: string }[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'hints') continue;
    const here = path ? `${path}.${key}` : key;
    if ((key === 'narration' || key === 'answerNarration') && value && typeof value === 'object' && !Array.isArray(value)) {
      const narration = value as { text?: unknown; spokenText?: unknown };
      const spoken = typeof narration.spokenText === 'string' ? narration.spokenText : narration.text;
      if (typeof spoken === 'string') found.push({ path: here, spoken });
    } else {
      found.push(...narrationsIn(value, here));
    }
  }
  return found;
}

function valueAt(input: unknown, path: (string | number)[]): unknown {
  let node = input;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/**
 * Błędy zod z pełną ścieżką pola. Pole wielojęzyczne (schemaVersion 6) to unia „wartość jednojęzyczna | { pl, en }” - zod zgłasza ją
 * jednym „invalid_union”; tu rozwijamy ją do gałęzi pasującej do kształtu danych (obiekt z `pl` = gałąź wielojęzyczna, reszta =
 * jednojęzyczna), żeby autor dostał np. `blocks.0.narration.voice: Invalid enum value`, a nie ogólne „Invalid input”.
 */
function formatIssues(issues: import('zod').ZodIssue[], input: unknown): string[] {
  return issues.flatMap((issue) => {
    if (issue.code === 'invalid_union') {
      const data = valueAt(input, issue.path);
      if (typeof data === 'string' || (data && typeof data === 'object' && !Array.isArray(data))) {
        const branch = issue.unionErrors[hasLocaleShape(data) ? issue.unionErrors.length - 1 : 0];
        const first = branch?.issues[0];
        // Obiekt bez `pl` w miejscu tekstu (np. { "en": "x" } albo { "PL": "x" }): zamiast „Expected string, received object” - podpowiedź.
        if (first && first.code === 'invalid_type' && first.expected === 'string' && first.path.length === issue.path.length) {
          return [`${issue.path.join('.')}: pole wielojęzyczne wymaga klucza "pl" ({ "pl": "…", "en"?: "…" }) albo zwykłego tekstu`];
        }
        if (branch) return formatIssues(branch.issues, input);
      }
    }
    return [`${issue.path.join('.') || '(moduł)'}: ${issue.message}`];
  });
}

/**
 * Waliduje moduł (schemat zod + relacje między polami + reguły całego modułu). Zwraca dane PO parsowaniu (z uzupełnionymi
 * wartościami domyślnymi) - właśnie ta postać jest zapisywana jako wersja kursu, więc serwer nie zgaduje domyślnych.
 */
export function parseModule(input: unknown): ContentModule {
  const parsed = moduleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentValidationError(formatIssues(parsed.error.issues, input));
  }
  const contentModule = parsed.data;
  const errors = v6FeatureErrors(contentModule);

  // Reguły semantyczne sprawdzane na treści rozwiniętej do KAŻDEGO użytego języka (schemaVersion 6): np. cytat kryterium maila musi
  // być w treści maila tego samego języka, a reguła cyfr lektora (D-109) dotyczy spokenText każdego języka. Błąd, który występuje
  // tylko w innym języku niż `pl`, dostaje prefiks `[en]`. Treść jednojęzyczna = jeden przebieg, jak przed v6.
  const base = moduleSemanticErrors(localizeContent(contentModule, DEFAULT_CONTENT_LOCALE));
  errors.push(...base);
  for (const locale of localesIn(contentModule)) {
    if (locale === DEFAULT_CONTENT_LOCALE) continue;
    for (const error of moduleSemanticErrors(localizeContent(contentModule, locale))) {
      if (!base.includes(error)) errors.push(`[${locale}] ${error}`);
    }
  }

  if (errors.length > 0) throw new ContentValidationError(errors);
  return contentModule;
}

/** Wywołuje `visit` dla każdego pola treści (ścieżka, klucz, wartość, klucz rodzica). */
function walkFields(value: unknown, visit: (path: string, key: string, item: unknown, parentKey: string) => void, path = '', parentKey = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkFields(item, visit, `${path}[${index}]`, parentKey));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    visit(here, key, item, parentKey);
    walkFields(item, visit, here, key);
  }
}

/**
 * Nowości schemaVersion 6 użyte w module o niższej wersji: pola wielojęzyczne, `textLayer`, rodzaje notatek call/log/web i role
 * głosu karol/pawel/oszust. Sprawdzane na treści ZAPISANEJ (przed rozwinięciem języka) - po rozwinięciu obiekty `{ pl, en }` znikają.
 */
function v6FeatureErrors(contentModule: ContentModule): string[] {
  if (contentModule.schemaVersion >= 6) return [];
  const errors: string[] = [];
  const localized = localizedPaths(contentModule);
  if (localized.length > 0) {
    const more = localized.length > 1 ? ` (i ${localized.length - 1} innych pól)` : '';
    errors.push(`${localized[0]}: pola wielojęzyczne ({ pl, en }) wymagają schemaVersion 6${more}`);
  }
  walkFields(contentModule, (path, key, item, parentKey) => {
    if (key === 'textLayer') errors.push(`${path}: textLayer wymaga schemaVersion 6`);
    if (key === 'kind' && parentKey === 'note' && (V6_NOTE_KINDS as readonly unknown[]).includes(item)) {
      errors.push(`${path}: rodzaj notatki "${String(item)}" wymaga schemaVersion 6`);
    }
    if (key === 'voice' && (V6_VOICE_ROLES as readonly unknown[]).includes(item)) errors.push(`${path}: rola głosu "${String(item)}" wymaga schemaVersion 6`);
  });
  return errors;
}

/** Warstwa tekstu (schemaVersion 6): unikalne id w obrębie jednej warstwy i prostokąty w granicach grafiki. */
function textLayerErrors(contentModule: ResolvedModule): string[] {
  const errors: string[] = [];
  walkFields(contentModule, (path, key, item) => {
    if (key !== 'textLayer' || !Array.isArray(item)) return;
    const layer = item as { id: string; x: number; y: number; w: number; h: number; portrait?: { x: number; y: number; w: number; h: number } }[];
    for (const id of duplicates(layer.map((entry) => entry.id))) errors.push(`${path}: powtórzony identyfikator "${id}"`);
    layer.forEach((entry, index) => {
      if (entry.x + entry.w > 100 || entry.y + entry.h > 100) errors.push(`${path}[${index}]: prostokąt wychodzi poza grafikę`);
      const p = entry.portrait;
      if (p && (p.x + p.w > 100 || p.y + p.h > 100)) errors.push(`${path}[${index}].portrait: prostokąt wychodzi poza pionową grafikę`);
    });
  });
  return errors;
}

// --- Tryb prosty (D-132, moduł 3 i kolejne): każdą minigrę ma przejść osoba nietechniczna bez instrukcji -------------------------------
//
// Dozwolone bloki: narracja (NARRATIVE, odprawa BRIEFING), DIALOGUE, SCENE_HOTSPOTS, wybór (QUIZ: 2-3 odpowiedzi, jedna poprawna),
// SWIPE_SORT i raport (SUMMARY). Bloki z limitem czasu (LIVE_CALL) i wymagające wprawy (ORDERING, INTERROGATION, CALL_RECORDING,
// OSINT_SPOT) - zakazane, jak każdy typ spoza listy.
export const SIMPLE_MODE_BLOCK_TYPES = ['NARRATIVE', 'BRIEFING', 'DIALOGUE', 'SCENE_HOTSPOTS', 'QUIZ', 'SWIPE_SORT', 'SUMMARY'] as const;
export const SIMPLE_PROMPT_MAX = 90;
export const SIMPLE_FEEDBACK_MAX = 140;
export const SIMPLE_MAX_HOTSPOTS = 4;
/** Najmniejszy cel dotykowy (WCAG 2.5.5) w skali wyświetlania. */
export const SIMPLE_TOUCH_TARGET_PX = 44;
/**
 * Najmniejsza scena, na której liczymy cel dotykowy: pozioma - scena 16:9 w obszarze bloku telefonu w poziomie (844×390 bez pasków
 * odtwarzacza: ok. 480×270 px); pionowa (`imagePortrait`, D-116) - grafika na szerokość telefonu w pionie (ok. 360 px) w proporcjach 9:16.
 */
export const SIMPLE_SCENE_REF = { landscape: { width: 480, height: 270 }, portrait: { width: 360, height: 640 } } as const;

/** Jedno zdanie: po kropce, wykrzykniku, pytajniku albo wielokropku nie ma dalszego tekstu (ani nowej linii). */
export function isOneSentence(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[.!?…]\s+\S/.test(trimmed) && !/\n/.test(trimmed);
}

function instructionErrors(label: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  const errors: string[] = [];
  if (value.length > SIMPLE_PROMPT_MAX) errors.push(`${label}: tryb prosty - polecenie najwyżej ${SIMPLE_PROMPT_MAX} znaków (jest ${value.length})`);
  if (!isOneSentence(value)) errors.push(`${label}: tryb prosty - polecenie to jedno zdanie`);
  return errors;
}

function touchTargetErrors(label: string, rect: { width: number; height: number }, ref: { width: number; height: number }): string[] {
  const width = (rect.width / 100) * ref.width;
  const height = (rect.height / 100) * ref.height;
  if (width >= SIMPLE_TOUCH_TARGET_PX && height >= SIMPLE_TOUCH_TARGET_PX) return [];
  return [
    `${label}: tryb prosty - cel dotykowy min. ${SIMPLE_TOUCH_TARGET_PX}×${SIMPLE_TOUCH_TARGET_PX} px na scenie ${ref.width}×${ref.height} px (jest ${Math.floor(width)}×${Math.floor(height)})`,
  ];
}

/** Reguły trybu prostego (błędy, nie ostrzeżenia) - tylko dla modułu z `simpleMode: true`. */
function simpleModeErrors(contentModule: ResolvedModule): string[] {
  if (contentModule.simpleMode !== true) return [];
  const errors: string[] = [];
  if (contentModule.schemaVersion < 6) errors.push('simpleMode: wymaga schemaVersion 6');
  contentModule.blocks.forEach((block, index) => {
    const where = `blocks[${index}] (${block.id})`;
    if (!(SIMPLE_MODE_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      errors.push(`${where}: tryb prosty nie dopuszcza bloku ${block.type} (dozwolone: ${SIMPLE_MODE_BLOCK_TYPES.join(', ')})`);
      return;
    }
    errors.push(...instructionErrors(`${where}: tip`, block.tip));
    // Brak limitów czasu - także w polach, które dopiero powstaną (dziś limit ma wyłącznie LIVE_CALL, zakazany wyżej).
    walkFields(block, (path, key) => {
      if (/timelimit/i.test(key)) errors.push(`${where}: ${path}: tryb prosty nie dopuszcza limitów czasu`);
    });
    switch (block.type) {
      case 'QUIZ': {
        errors.push(...instructionErrors(`${where}: prompt`, block.prompt));
        if (block.options.length > 3) errors.push(`${where}: options: tryb prosty - 2-3 odpowiedzi (jest ${block.options.length})`);
        if (block.options.filter((option) => option.correct === true).length !== 1) errors.push(`${where}: options: tryb prosty - dokładnie jedna poprawna odpowiedź`);
        block.options.forEach((option, i) => {
          if (option.feedback === undefined) errors.push(`${where}: options[${i}].feedback: tryb prosty - każda odpowiedź ma zdanie po kliknięciu`);
          else if (option.feedback.length > SIMPLE_FEEDBACK_MAX) errors.push(`${where}: options[${i}].feedback: tryb prosty - najwyżej ${SIMPLE_FEEDBACK_MAX} znaków`);
        });
        if (block.hint === undefined) errors.push(`${where}: hint: tryb prosty - podpowiedź po 2 błędach jest wymagana`);
        break;
      }
      case 'SWIPE_SORT': {
        errors.push(...instructionErrors(`${where}: prompt`, block.prompt));
        if (block.hint === undefined) errors.push(`${where}: hint: tryb prosty - podpowiedź po 2 błędach jest wymagana`);
        break;
      }
      case 'SCENE_HOTSPOTS': {
        const all = flattenHotspots(block.hotspots);
        if (all.length > SIMPLE_MAX_HOTSPOTS) errors.push(`${where}: hotspots: tryb prosty - najwyżej ${SIMPLE_MAX_HOTSPOTS} cele (jest ${all.length})`);
        block.hotspots.forEach((h, i) => errors.push(...touchTargetErrors(`${where}: hotspots[${i}] (${h.id})`, h, SIMPLE_SCENE_REF.landscape)));
        (block.portraitHotspots ?? []).forEach((h, i) => errors.push(...touchTargetErrors(`${where}: portraitHotspots[${i}] (${h.id})`, h, SIMPLE_SCENE_REF.portrait)));
        break;
      }
      default:
        break;
    }
  });
  return errors;
}

/** Reguły semantyczne modułu rozwiniętego do jednego języka (bloki, relacje między blokami, reguła cyfr lektora, SUMMARY). */
function moduleSemanticErrors(contentModule: ResolvedModule): string[] {
  const errors: string[] = textLayerErrors(contentModule);

  const seen = new Set<string>();
  contentModule.blocks.forEach((block, index) => {
    if (seen.has(block.id)) errors.push(`blocks[${index}]: powtórzony identyfikator bloku "${block.id}"`);
    seen.add(block.id);
    for (const error of validateBlockSemantics(block, contentModule.schemaVersion)) errors.push(`blocks[${index}] (${block.id}): ${error}`);
    if (contentModule.schemaVersion < 3) {
      for (const feature of v3FeaturesUsed(block)) {
        errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 3`);
      }
    }
    if (contentModule.schemaVersion < 4) {
      if (block.type === 'NARRATIVE') errors.push(`blocks[${index}] (${block.id}): blok NARRATIVE wymaga schemaVersion 4`);
      for (const feature of v4FeaturesUsed(block)) {
        errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 4`);
      }
    }
    if (contentModule.schemaVersion < 5) {
      if (block.type === 'BRIEFING') errors.push(`blocks[${index}] (${block.id}): blok BRIEFING wymaga schemaVersion 5`);
      if (block.type === 'DOSSIER') errors.push(`blocks[${index}] (${block.id}): blok DOSSIER wymaga schemaVersion 5`);
      for (const feature of v5FeaturesUsed(block)) errors.push(`blocks[${index}] (${block.id}): pole ${feature} wymaga schemaVersion 5`);
    }
    if (
      contentModule.schemaVersion < 6 &&
      (block.type === 'CALL_RECORDING' ||
        block.type === 'ANNOTATED_REPLAY' ||
        block.type === 'INTERROGATION' ||
        block.type === 'OSINT_SPOT' ||
        block.type === 'LIVE_CALL' ||
        block.type === 'SWIPE_SORT')
    ) {
      errors.push(`blocks[${index}] (${block.id}): blok ${block.type} wymaga schemaVersion 6`);
    }
  });

  // Sprzeczność w przesłuchaniu (D-118): `refutedBy` wskazuje dowód (element z evidence i notatką) z WCZEŚNIEJSZEGO bloku - gracz musi
  // go mieć w notatniku, zanim dojdzie do przesłuchania.
  contentModule.blocks.forEach((block, index) => {
    if (block.type !== 'INTERROGATION') return;
    block.questions.forEach((question, q) => {
      question.lines.forEach((line, l) => {
        const refutedBy = line.contradiction?.refutedBy;
        if (refutedBy === undefined || !/^[^.]+\.[^.]+$/.test(refutedBy)) return;
        const [blockId, itemId] = refutedBy.split('.');
        const sourceIndex = contentModule.blocks.findIndex((b) => b.id === blockId);
        const where = `blocks[${index}] (${block.id}): questions[${q}].lines[${l}].contradiction.refutedBy`;
        if (sourceIndex < 0 || sourceIndex >= index) {
          errors.push(`${where}: "${refutedBy}" - blok "${blockId}" musi być WCZEŚNIEJ w module`);
          return;
        }
        const item = noteItemsOf(contentModule.blocks[sourceIndex] as ServerBlock & Record<string, unknown>).find((candidate) => candidate.id === itemId);
        if (!item || item.evidence !== true || !item.note?.text) errors.push(`${where}: "${refutedBy}" nie jest dowodem (evidence z notatką) w bloku "${blockId}"`);
      });
    });
  });

  // Omówienie na transkrypcji (D-115): blok źródłowy to CALL_RECORDING tego modułu, a kotwice wskazują jego segmenty.
  contentModule.blocks.forEach((block, index) => {
    if (block.type !== 'ANNOTATED_REPLAY' || block.source.kind !== 'transcript') return;
    const where = `blocks[${index}] (${block.id})`;
    const fromBlock = block.source.fromBlock;
    const sourceIndex = contentModule.blocks.findIndex((b) => b.id === fromBlock);
    const source = contentModule.blocks[sourceIndex];
    if (!source || source.type !== 'CALL_RECORDING') {
      errors.push(`${where}: source.fromBlock "${fromBlock}" nie jest blokiem CALL_RECORDING tego modułu`);
      return;
    }
    // Znaczniki omówienia wskazują flagi nagrania - omówienie przed nagraniem odsłoniłoby klucz odpowiedzi (API wstrzymuje je tylko
    // do dotarcia gracza do bloku omówienia, D-115).
    if (sourceIndex > index) errors.push(`${where}: omówienie musi stać PO bloku nagrania "${fromBlock}" (znaczniki zdradzają flagi)`);
    for (const id of duplicates(block.markers.flatMap((m) => (m.anchor.segmentId ? [m.anchor.segmentId] : [])))) {
      errors.push(`${where}: więcej niż jeden znacznik przy segmencie "${id}"`);
    }
    const segmentIds = source.segments.map((s) => s.id);
    block.markers.forEach((marker, m) => {
      const segmentId = marker.anchor.segmentId;
      if (segmentId !== undefined && !segmentIds.includes(segmentId)) {
        errors.push(`${where}: markers[${m}].anchor.segmentId "${segmentId}" nie istnieje w bloku "${source.id}"`);
      }
    });
  });

  // Metadane modułu z wersji 4 (nie są ścieżką WEWNĄTRZ bloku, więc osobne sprawdzenie od v3FeaturesUsed/v4FeaturesUsed).
  if (contentModule.schemaVersion < 4) {
    if (contentModule.subtitle !== undefined) errors.push('subtitle: wymaga schemaVersion 4');
    if (contentModule.level !== undefined) errors.push('level: wymaga schemaVersion 4');
    if (contentModule.objectives !== undefined) errors.push('objectives: wymaga schemaVersion 4');
  }
  // Miniatura modułu (D-084) - addytywnie w v5. Istnienie pliku sprawdza potok zasobów (--assets), jak obrazy bloków.
  if (contentModule.schemaVersion < 5 && contentModule.thumbnail !== undefined) errors.push('thumbnail: wymaga schemaVersion 5');
  errors.push(...simpleModeErrors(contentModule));
  // Zadania sprawy (BRIEFING, krok caseFile, D-081): unikalne id, completeWhen wskazuje istniejące bloki modułu, ale nie
  // BRIEFING - "Pomiń odprawę" zalicza blok odprawy, a pominięcie nie może odhaczać zadań. Relacja z INNYMI blokami, więc
  // sprawdzenie na poziomie modułu (validateBlockSemantics widzi tylko jeden blok).
  const blockTypes = new Map(contentModule.blocks.map((b) => [b.id, b.type]));
  contentModule.blocks.forEach((block, index) => {
    if (block.type !== 'BRIEFING') return;
    block.steps.forEach((step, s) => {
      if (step.kind !== 'caseFile' || !step.tasks) return;
      const where = `blocks[${index}] (${block.id}): steps[${s}].tasks`;
      for (const id of duplicates(step.tasks.map((task) => task.id))) errors.push(`${where}: powtórzony identyfikator "${id}"`);
      step.tasks.forEach((task, t) => {
        for (const id of duplicates(task.completeWhen)) errors.push(`${where}[${t}].completeWhen: powtórzony blok "${id}"`);
        for (const id of task.completeWhen) {
          const type = blockTypes.get(id);
          if (type === undefined) errors.push(`${where}[${t}].completeWhen: nieznany blok "${id}"`);
          else if (type === 'BRIEFING') errors.push(`${where}[${t}].completeWhen: blok odprawy (BRIEFING) nie może odhaczać zadań`);
        }
      });
    });
  });

  // Lektor źle czyta cyfry (godziny, kwoty, numery - fix/tts-numbers, D-109): tekst czytany przez głos (`spokenText`, a bez niego
  // `text`) każdej nagrywanej narracji (blok, kroki odprawy, hotspoty, media, sceny zagnieżdżone, odpowiedzi rozmowy) jest bez cyfr -
  // liczby słownie w `spokenText`, w przypadku zależnym od zdania. Napisy (`text`, `cues`) zostają z cyframi.
  contentModule.blocks.forEach((block, index) => {
    for (const { path, spoken } of narrationsIn(block)) {
      if (/\d/.test(spoken)) errors.push(`blocks[${index}] (${block.id}): ${path}: cyfry w tekście czytanym przez lektora - dodaj spokenText ze słownym zapisem`);
    }
  });

  const summaries = contentModule.blocks.map((b, i) => (b.type === 'SUMMARY' ? i : -1)).filter((i) => i >= 0);
  if (summaries.length > 1) errors.push('SUMMARY: co najwyżej jeden blok podsumowania');
  if (summaries.length === 1 && summaries[0] !== contentModule.blocks.length - 1) {
    errors.push('SUMMARY: blok podsumowania musi być ostatni');
  }
  // Ekran zamknięcia sprawy (D-089): sloty w granicach sceny raportu.
  for (const block of contentModule.blocks) {
    if (block.type !== 'SUMMARY' || !block.closing) continue;
    for (const [name, rect] of Object.entries(block.closing.slots)) {
      if (rect.x + rect.w > 100 || rect.y + rect.h > 100) errors.push(`SUMMARY: closing.slots.${name} wychodzi poza scenę raportu`);
    }
    // Wariant pionowy (D-098): komplet slotów wymusza schemat, tu - granice pionowej sceny.
    for (const [name, rect] of Object.entries(block.closing.portrait?.slots ?? {})) {
      if (rect.x + rect.w > 100 || rect.y + rect.h > 100) errors.push(`SUMMARY: closing.portrait.slots.${name} wychodzi poza pionową scenę raportu`);
    }
  }

  return errors;
}
