import { createHmac, hkdfSync } from 'node:crypto';
import { ClientContext, ShuffleSeed, toClientBlock } from '@cyberszkolo/content';
import { HotspotLike, flattenHotspots, noteItemsOf } from '@cyberszkolo/content/dist/node';
import { BlockEntry, ProgressV2 } from './progress';
import {
  Block,
  OpaqueId,
  challengesView,
  emailDetail,
  interrogationDetail,
  liveCallDetail,
  orderingDetail,
  osintDetail,
  osintSecretEndings,
  pickReaction,
} from './scoring/evaluate';
import { recordingDetail } from './scoring/recording';

/**
 * Klucze pochodne od JWT_SECRET (HKDF-SHA256 ze stałym `info` osobnym dla każdego zastosowania), więc bez nowej zmiennej
 * środowiskowej, a klucz do tasowania i do nieprzejrzystych id nie jest kluczem JWT ani nie jest sobie równy. Zmiana JWT_SECRET
 * zmienia tylko kolejność wyświetlania i wygląd id (odpowiedzi idą po id nadanym w tej samej sesji, nie po pozycji).
 */
function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
}

/**
 * Kontekst projekcji treści dla JEDNEGO przypisania i jego wersji. Wszystko jest HMAC-iem z kluczem SERWERA, stałym dla
 * (przypisanie, wersja, blok[, element]):
 *  - seed tasowania: odświeżenie strony nie daje nowej permutacji (inaczej porównanie dwóch układów odsłaniałoby kolejność),
 *    a bez klucza nie da się permutacji odwrócić do kolejności z treści (= odpowiedź);
 *  - nieprzejrzyste id elementów (ORDERING, EMAIL_ANALYSIS): inne w każdym przypisaniu, więc nazwy id w treści nie zdradzają
 *    klucza, a id z cudzego przypisania nie da się użyć (mapowanie z powrotem tylko po stronie serwera, evaluate.ts).
 */
export function shuffleContext(secret: string, assignmentId: string, versionId: string): ClientContext {
  const shuffleKey = deriveKey(secret, 'content-shuffle');
  const idKey = deriveKey(secret, 'content-opaque-id');
  const scope = `${assignmentId}\n${versionId}`;
  return {
    shuffleSeed: (blockId: string): ShuffleSeed => {
      const digest = createHmac('sha256', shuffleKey).update(`${scope}\n${blockId}`).digest();
      return [digest.readUInt32BE(0), digest.readUInt32BE(4), digest.readUInt32BE(8), digest.readUInt32BE(12)];
    },
    // 96 bitów w hex: zgodne z idSchema (odpowiedź klienta przechodzi tę samą walidację co zwykłe id), bez kolizji w praktyce.
    opaqueId: (blockId: string, itemId: string): string =>
      createHmac('sha256', idKey).update(`${scope}\n${blockId}\n${itemId}`).digest('hex').slice(0, 24),
  };
}

/**
 * Bloki, których treść wychodzi do klienta dopiero, gdy gracz do nich DOTRZE (D-115, security review 1b). Omówienie nagrania
 * (ANNOTATED_REPLAY) jest publiczne, ale jego znaczniki wskazują segmenty z flagami CALL_RECORDING i nazywają ich kategorie - w /start
 * (które wysyła wszystkie bloki kursu) byłyby kluczem odpowiedzi nagrania. Walidacja modułu wymusza omówienie PO bloku nagrania.
 */
const GATED_BLOCK_TYPES = new Set(['ANNOTATED_REPLAY']);

/**
 * Projekcja bloku do /start: jak toClientBlock, ale blok z GATED_BLOCK_TYPES przed bieżącym miejscem (index > reachedIndex, kurs
 * nieukończony) idzie bez znaczników (`withheld: true`). Po dotarciu klient dostaje pełny blok w odpowiedzi /progress (revealedBlock).
 */
export function projectBlockForStart(block: Block, index: number, context: ClientContext, reachedIndex: number, completed: boolean) {
  const client = toClientBlock(block, context);
  if (!GATED_BLOCK_TYPES.has(block.type) || completed || index <= reachedIndex) return client;
  // Biała lista, nie „usuń markers”: narracja bloku, podpowiedź czy opis grafiki źródła też mogłyby nazwać flagi nagrania (review 1b).
  return { id: client.id, type: client.type, ...(typeof client.title === 'string' ? { title: client.title } : {}), withheld: true };
}

/** Pełny blok dla nowo osiągniętego miejsca, gdy jest wstrzymywany w /start (odpowiedź /progress); inaczej undefined. */
export function revealedBlockAt(blocks: Block[], index: number, context: ClientContext) {
  const block = blocks[index];
  return block && GATED_BLOCK_TYPES.has(block.type) ? { blockIndex: index, block: toClientBlock(block, context) } : undefined;
}

interface ClientNote {
  key: string;
  blockId: string;
  text: string;
  kind?: string;
}

/**
 * Nieprzejrzysty odnośnik do notatki (D-118): klient wskazuje nim dowód przy podważeniu kwestii przesłuchania. Klucz notatki zawiera id
 * elementu Z TREŚCI (np. dowodu nagrania - sekret), więc nie wychodzi do klienta; odnośnik to HMAC z kluczem serwera, inny w każdym
 * przypisaniu (jak id kryteriów maila), w osobnej przestrzeni (`note:`) - nie pokrywa się z id elementów bloku.
 */
export function noteRef(opaque: OpaqueId, key: string): string {
  const dot = key.indexOf('.');
  return opaque(key.slice(0, dot), `note:${key.slice(dot + 1)}`);
}

/** Klucz notatki z postępu dla odnośnika z odpowiedzi klienta; null, gdy gracz takiej notatki nie ma. */
export function noteKeyForRef(progress: ProgressV2, opaque: OpaqueId, ref: string): string | null {
  return progress.notes.find((key) => key.indexOf('.') > 0 && noteRef(opaque, key) === ref) ?? null;
}

/** Notatka w postaci dla klienta: id bloku, treść, rodzaj i - gdy znany kontekst przypisania - odnośnik do podważeń. */
export function toClientNote({ key, blockId, text, kind }: ClientNote, opaque?: OpaqueId) {
  return { blockId, text, ...(kind ? { kind } : {}), ...(opaque ? { ref: noteRef(opaque, key) } : {}) };
}

/** Treść notatki z treści modułu (klient nigdy nie wysyła treści notatek). */
export function resolveNote(blocks: Block[], key: string): ClientNote | null {
  const dot = key.indexOf('.');
  if (dot < 1) return null;
  const blockId = key.slice(0, dot);
  const itemId = key.slice(dot + 1);
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;
  const item = noteItemsOf(block).find((i) => i.id === itemId);
  return item?.note?.text ? { key, blockId, text: item.note.text, ...(item.note.kind ? { kind: item.note.kind } : {}) } : null;
}

export interface EvidenceSummary {
  collected: number;
  total: number;
  /** Tylko bloki z dowodami; bez identyfikatorów elementów (tylko id bloku i liczby). */
  perBlock: { blockId: string; collected: number; total: number }[];
}

/**
 * Dowody zebrane w śledztwie: elementy z `evidence: true`, których notatka trafiła do `progress.notes`. Liczby liczy serwer z zapisanej
 * wersji kursu (flaga evidence przy KONKRETNYM kryterium maila jest sekretem, więc klient nie może sam policzyć, KTÓRE kryteria to
 * dowody - `total` to tylko ich LICZBA per blok, znana od startu, dla wszystkich typów bloków jednolicie, łącznie z EMAIL_ANALYSIS
 * (poprawka D-055 pkt 2, PR 4: wcześniejsze ukrywanie tej liczby do zatwierdzenia odpowiedzi było zbyt małym wyciekiem, żeby psuć UX
 * licznikiem "?" przez cztery bloki).
 */
export function evidenceSummary(progress: ProgressV2, blocks: readonly Block[], { includeHidden = false }: { includeHidden?: boolean } = {}): EvidenceSummary {
  const noted = new Set(progress.notes);
  const perBlock: EvidenceSummary['perBlock'] = [];
  let collected = 0;
  let total = 0;
  for (const block of blocks) {
    // Dowód ukryty do zebrania (sprzeczność przesłuchania, D-118) liczy się dopiero po trafieniu do notatnika - licznik od startu nie
    // zdradza, ile kwestii kłamie. `includeHidden` (tylko serwer - osiągnięcia, D-124): komplet dowodów z treści, łącznie z ukrytymi.
    const evidence = noteItemsOf(block).filter(
      (item) => item.evidence === true && item.note?.text && (includeHidden || !item.hidden || noted.has(`${block.id}.${item.id}`)),
    );
    if (evidence.length === 0) continue;
    const got = evidence.filter((item) => noted.has(`${block.id}.${item.id}`)).length;
    perBlock.push({ blockId: block.id, collected: got, total: evidence.length });
    collected += got;
    total += evidence.length;
  }
  return { collected, total, perBlock };
}

/**
 * Wyróżnienia easter egga (D-100) do notatnika: etykiety z treści dla id zapisanych przy ukończeniu bloku (`easterEggs`). Nieznane id
 * (np. usunięte w nowszej wersji treści - klient i tak dostaje etykietę wyłącznie z zapisanej wersji kursu) są pomijane.
 */
export function distinctions(progress: ProgressV2, blocks: Block[]): { blockId: string; label: string; note?: string }[] {
  const found: { blockId: string; label: string; note?: string }[] = [];
  for (const [blockId, entry] of Object.entries(progress.blocks)) {
    const block = blocks.find((b) => b.id === blockId);
    // Ukryte zakończenie nagrania w OSINT (D-120): etykieta i zdanie z treści dla wysłuchanych (id z postępu).
    if (Array.isArray(entry.secretEndings) && block?.type === 'OSINT_SPOT') {
      for (const ending of osintSecretEndings(block, entry.secretEndings)) found.push({ blockId, label: ending.label, ...(ending.note ? { note: ending.note } : {}) });
    }
    if (!Array.isArray(entry.easterEggs)) continue;
    if (block?.type !== 'SCENE_HOTSPOTS' || !Array.isArray(block.hotspots)) continue;
    const badges = flattenHotspots(block.hotspots as HotspotLike[])
      .map((h) => h.media as { kind?: string; badge?: { id?: unknown; label?: unknown } } | undefined)
      .filter((media) => media?.kind === 'popups' && typeof media.badge?.id === 'string' && typeof media.badge.label === 'string')
      .map((media) => media!.badge as { id: string; label: string });
    for (const id of entry.easterEggs) {
      const badge = badges.find((b) => b.id === id);
      if (badge) found.push({ blockId, label: badge.label });
    }
  }
  return found;
}

/** Stan częściowy sceny do widoku postępu (D-128): id przedmiotów z zapisu, ograniczone do tych, które są w treści bloku. */
function explorationView(block: Block, entry: BlockEntry): { visited: string[]; noted: string[] } | undefined {
  if (!Array.isArray(block.hotspots)) return undefined;
  const ids = new Set(flattenHotspots(block.hotspots as HotspotLike[]).map((hotspot) => hotspot.id));
  const known = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && ids.has(id)) : []);
  const visited = known(entry.visited);
  const noted = known(entry.noted).filter((id) => visited.includes(id));
  return visited.length > 0 ? { visited, noted } : undefined;
}

/**
 * Widok postępu dla klienta: własne wyniki i stan, plus WYŁĄCZNIE ujawnione dotąd elementy zadań tekstowych (podpowiedzi
 * odsłonięte próbami; rozwiązanie po wyczerpaniu prób) i rozwiązane notatki. Niczego, co nie było jeszcze ujawnione.
 */
export function clientProgress(progress: ProgressV2, blocks: Block[], opaque?: OpaqueId) {
  const view: Record<string, unknown> = {};
  for (const [blockId, entry] of Object.entries(progress.blocks)) {
    const block = blocks.find((b) => b.id === blockId);
    const revealedHints =
      block?.type === 'TEXT_INPUT_GUIDED' && Array.isArray(block.hints) ? block.hints.slice(0, entry.hintsShown ?? 0) : undefined;
    const solution = block?.type === 'TEXT_INPUT_GUIDED' && entry.done && entry.correct === false ? block.solution : undefined;
    // Reakcja maskotki na WYNIK (schemaVersion 4, pole secret): jak solution, tylko po ukończeniu bloku - nie wymaga `opaque`
    // (nie odsłania żadnych id z treści), więc dostępna też przy starszych wywołaniach bez tego parametru.
    const reaction = block && entry.done ? pickReaction(block, entry) : undefined;
    // Podgląd UKOŃCZONEGO bloku ("Wstecz"): własny wybór gracza i rozstrzygnięcie (po ukończeniu klucz nie jest już tajny, wynik
    // pokazano przy zapisie). Elementy zawsze jako id nieprzejrzyste, jak w /start. Bez `opaque` (starsze wywołania) nie ma ich wcale.
    let answer: unknown;
    let detail: unknown;
    // Przesłuchanie (D-118): podważenia są w wpisie także PRZED ukończeniem bloku (odświeżenie strony w trakcie) - własne wyniki gracza,
    // kwestia po podważeniu wyłącznie przy trafieniu (ta sama, którą pokazała odpowiedź /challenge).
    const challenges = block?.type === 'INTERROGATION' && Array.isArray(entry.challenges) ? challengesView(block, entry.challenges) : undefined;
    // Scena (D-128): stan częściowy - obejrzane przedmioty i zabrane dowody NIEUKOŃCZONEGO bloku, żeby po powrocie do kursu scena
    // wyglądała tak, jak ją zostawiono. Id przedmiotów są publiczne (pole `hotspots[].id`); tylko te, które nadal są w treści bloku.
    const exploration = block?.type === 'SCENE_HOTSPOTS' && !entry.done ? explorationView(block, entry) : undefined;
    if (block && entry.done && opaque) {
      if ((block.type === 'QUIZ' || block.type === 'BRANCHING_SCENARIO') && typeof entry.answer === 'number') answer = entry.answer;
      if (block.type === 'EMAIL_ANALYSIS' && Array.isArray(entry.selected)) {
        answer = { selected: entry.selected.map((id) => opaque(block.id, id)) };
        detail = emailDetail(block, entry.selected, opaque);
      }
      if (block.type === 'ORDERING' && Array.isArray(entry.order)) {
        answer = { order: entry.order.map((id) => opaque(block.id, id)) };
        detail = orderingDetail(block, opaque);
      }
      // Nagranie (D-115): rozstrzygnięcie flag (id segmentów są publiczne) - jak mail, dopiero po ukończeniu.
      if (block.type === 'CALL_RECORDING' && Array.isArray(entry.flagsHit) && Array.isArray(block.flags)) {
        detail = recordingDetail(block as Block & Parameters<typeof recordingDetail>[0], { flagsHit: entry.flagsHit, falseTaps: entry.falseTaps ?? 0 });
      }
      // Przesłuchanie (D-118): które kwestie kłamały i ich przyznanie - jak mail i nagranie, dopiero po ukończeniu bloku.
      if (block.type === 'INTERROGATION') detail = interrogationDetail(block);
      // OSINT (D-120): zaznaczenia gracza i rozstrzygnięcie obszarów (id obszarów są publiczne).
      if (block.type === 'OSINT_SPOT' && Array.isArray(entry.marked)) {
        answer = { marked: entry.marked };
        detail = osintDetail(block, entry.marked);
      }
      // Rozmowa na żywo (D-122): ścieżka gracza i rozstrzygnięcie (zakończenie, ocena, odpowiedzi oddające informację).
      if (block.type === 'LIVE_CALL' && Array.isArray(entry.path)) {
        answer = { path: entry.path, timed: entry.timed === true };
        detail = liveCallDetail(block, entry.path);
      }
    }
    view[blockId] = {
      type: entry.type,
      done: entry.done,
      ...(entry.correct !== undefined ? { correct: entry.correct } : {}),
      ...(entry.points !== undefined ? { points: entry.points } : {}),
      ...(entry.attempts !== undefined ? { attempts: entry.attempts } : {}),
      ...(revealedHints && revealedHints.length > 0 ? { revealedHints } : {}),
      ...(solution ? { solution } : {}),
      ...(reaction ? { reaction } : {}),
      ...(answer !== undefined ? { answer } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(challenges !== undefined ? { challenges } : {}),
      ...(exploration !== undefined ? { exploration } : {}),
    };
  }
  // Klucz notatki (`<blockId>.<itemId>`) zawiera id elementu Z TREŚCI (np. kryterium maila), więc do klienta idzie tylko blockId, treść i
  // nieprzejrzysty odnośnik (noteRef, D-118): klient buduje klucz listy z indeksu. Żadne id z treści (poza id bloku) nie wychodzi w progress.
  const notes = progress.notes
    .map((key) => resolveNote(blocks, key))
    .filter((n): n is ClientNote => n !== null)
    .map((note) => toClientNote(note, opaque));
  return { v: 2 as const, blocks: view, notes, evidence: evidenceSummary(progress, blocks), distinctions: distinctions(progress, blocks) };
}
