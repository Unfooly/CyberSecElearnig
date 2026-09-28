import { ServerBlock } from './blocks';
import { collectPaths } from './introspect';
import { ContentModule, ContentValidationError, MODULE_SCHEMA_VERSION, moduleSchema } from './module';
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
  return used;
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
export const SCORED_BLOCK_TYPES = ['QUIZ', 'BRANCHING_SCENARIO', 'EMAIL_ANALYSIS', 'ORDERING', 'TEXT_INPUT_GUIDED'] as const;
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
        if (h.media?.kind === 'scene') {
          h.media.scene.hotspots.forEach((ih, j) => {
            const label = `hotspots[${i}].media.scene.hotspots[${j}]`;
            if (ih.x + ih.width > 100 || ih.y + ih.height > 100) errors.push(`${label}: obszar wychodzi poza obraz`);
            errors.push(...evidenceErrors(label, ih, kindRequired));
            errors.push(...audioMediaErrors(label, ih.media));
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
      const items = flattenHotspots(block.hotspots).filter((h) => !doorIds.has(h.id));
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
      block.documents.forEach((document, d) => {
        document.rows.forEach((row, r) => {
          const label = `documents[${d}].rows[${r}]`;
          if (row.cells.length !== document.columns.length) {
            errors.push(`${label}: liczba komórek (${row.cells.length}) różna od liczby kolumn (${document.columns.length})`);
          }
          errors.push(...evidenceErrors(label, row, kindRequired));
          // Zwykła linijka nie trafia do notatnika (zakreślenie pokazuje tylko "zwykłą operację") - notatka bez evidence byłaby martwa.
          if (row.note && row.evidence !== true) errors.push(`${label}: note bez evidence: true nigdy nie trafi do notatnika`);
          if (row.required === true && row.evidence !== true) errors.push(`${label}: required dotyczy wyłącznie wierszy-dowodów`);
          // Wiersz-dowód ma stały komunikat („Zakreślone…”) - własny message byłby martwy.
          if (row.message !== undefined && row.evidence === true) errors.push(`${label}: message dotyczy wyłącznie zwykłych linijek`);
        });
      });
      break;
    }
    case 'BRIEFING': {
      // Odprawa nie ma wyniku (zapis bez odpowiedzi, bez punktów) - waga > 0 tylko zaniżyłaby wynik modułu.
      if (block.weight !== undefined && block.weight > 0) errors.push('weight: blok BRIEFING jest nieoceniany (waga musi być 0)');
      block.steps.forEach((step, index) => errors.push(...briefingSceneErrors(`steps[${index}]`, step)));
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
export function moduleWarnings(contentModule: ContentModule): string[] {
  const warnings: string[] = [];
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
 * Waliduje moduł (schemat zod + relacje między polami + reguły całego modułu). Zwraca dane PO parsowaniu (z uzupełnionymi
 * wartościami domyślnymi) - właśnie ta postać jest zapisywana jako wersja kursu, więc serwer nie zgaduje domyślnych.
 */
export function parseModule(input: unknown): ContentModule {
  const parsed = moduleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || '(moduł)'}: ${i.message}`));
  }
  const contentModule = parsed.data;
  const errors: string[] = [];

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
  });

  // Metadane modułu z wersji 4 (nie są ścieżką WEWNĄTRZ bloku, więc osobne sprawdzenie od v3FeaturesUsed/v4FeaturesUsed).
  if (contentModule.schemaVersion < 4) {
    if (contentModule.subtitle !== undefined) errors.push('subtitle: wymaga schemaVersion 4');
    if (contentModule.level !== undefined) errors.push('level: wymaga schemaVersion 4');
    if (contentModule.objectives !== undefined) errors.push('objectives: wymaga schemaVersion 4');
  }
  // Miniatura modułu (D-084) - addytywnie w v5. Istnienie pliku sprawdza potok zasobów (--assets), jak obrazy bloków.
  if (contentModule.schemaVersion < 5 && contentModule.thumbnail !== undefined) errors.push('thumbnail: wymaga schemaVersion 5');
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

  if (errors.length > 0) throw new ContentValidationError(errors);
  return contentModule;
}
