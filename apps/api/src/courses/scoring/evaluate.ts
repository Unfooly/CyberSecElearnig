import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_WEIGHT, BlockType, idSchema, requiredItemIds } from '@cyberszkolo/content';
import {
  DossierRowLike,
  HotspotLike,
  MAX_DOSSIER_EVIDENCE,
  compileAnswerRegex,
  flattenDossierRows,
  flattenHotspots,
  SCORED_BLOCK_TYPES,
  WHEN_BASED_TYPES,
} from '@cyberszkolo/content/dist/node';
import { BlockEntry } from '../progress';

// Ocena odpowiedzi PO STRONIE SERWERA. Klient przesyła wyłącznie swój wybór (indeks, listę id, tekst) - nigdy ocenę ani
// punkty. Bloki pochodzą z zapisanej wersji kursu (klucz odpowiedzi tylko tutaj).

export type Block = Record<string, any> & { id: string; type: string };

export interface SubmitResult {
  entry: BlockEntry;
  // Klucze notatek dopisanych przez ten blok (`<blockId>.<itemId>`).
  notesAdded: string[];
  // Wynik pokazywany po ukończeniu bloku (własny wynik użytkownika: nie ujawnia niczego przed odpowiedzią).
  detail?: Record<string, unknown>;
}

const MAX_TEXT_ANSWER = 500;

const ids = z.array(idSchema).max(50);
// `noted`: hotspoty dodane do notatnika ("Dodaj do notatnika"); podzbiór `visited`, wyłącznie elementy z evidence (evaluateSubmit).
const visitedAnswer = z.object({ visited: ids, noted: ids.optional() }).strict();
const askedAnswer = z.object({ asked: ids }).strict();
const openedAnswer = z.object({ opened: ids }).strict();
// DOSSIER (D-083): otwarte dokumenty i zakreślone wiersze-dowody (bez domyślnego [] - klient zawsze wysyła oba pola). Limit
// `noted` = ta sama stała, którą walidacja modułu ogranicza liczbę wierszy-dowodów w teczce (inaczej blok byłby nie do ukończenia).
const dossierAnswer = z.object({ opened: ids, noted: z.array(idSchema).max(MAX_DOSSIER_EVIDENCE) }).strict();
const selectedAnswer = z.object({ selected: ids }).strict();
const orderAnswer = z.object({ order: ids }).strict();

function parseAnswer<T>(schema: z.ZodType<T>, answer: unknown): T {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  return parsed.data;
}

export function weightOf(block: Block): number {
  if (typeof block.weight === 'number') return block.weight;
  return Object.prototype.hasOwnProperty.call(DEFAULT_WEIGHT, block.type) ? DEFAULT_WEIGHT[block.type as BlockType] : 0;
}

function unique(list: string[]): boolean {
  return new Set(list).size === list.length;
}

function baseEntry(block: Block, now: Date, extra: Partial<BlockEntry> = {}): BlockEntry {
  return { type: block.type, done: true, answeredAt: now.toISOString(), weight: weightOf(block), ...extra };
}

/** Bramka wymaganych elementów w blokach eksploracyjnych (hotspoty, dialog, zakładki). To bramka UX, nie dowód kliknięcia. */
function requireCoverage(label: string, given: string[], allIds: string[], required: string[] | undefined) {
  if (!unique(given) || given.some((id) => !allIds.includes(id))) {
    throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  }
  const need = required ?? allIds;
  if (need.some((id) => !given.includes(id))) {
    throw new BadRequestException(`Nie ukończono wymaganych elementów (${label})`);
  }
}

const noteKey = (blockId: string, itemId: string) => `${blockId}.${itemId}`;

/** Nieprzejrzyste id elementu widziane przez klienta (client-view.ts, shuffleContext.opaqueId). */
export type OpaqueId = (blockId: string, itemId: string) => string;

/**
 * Tłumaczy id z odpowiedzi klienta (nieprzejrzyste) na id z treści. Id spoza tego przypisania (np. z cudzego assignmentu) nie
 * mają odpowiednika, więc odpowiedź jest odrzucana zwykłym, bezpiecznym komunikatem (bez treści bloku).
 */
function toRealIds(block: Block, opaque: OpaqueId, items: { id: string }[], given: string[]): string[] {
  const byOpaque = new Map(items.map((item) => [opaque(block.id, item.id), item.id]));
  const real = given.map((id) => byOpaque.get(id));
  if (real.some((id) => id === undefined)) throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  return real as string[];
}

export function evaluateSubmit(
  block: Block,
  answer: unknown,
  existing: BlockEntry | undefined,
  now: Date,
  opaque: OpaqueId,
): SubmitResult {
  switch (block.type) {
    case 'QUIZ':
    case 'BRANCHING_SCENARIO': {
      const options: Record<string, any>[] = Array.isArray(block.options) ? block.options : [];
      if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const option = options[answer];
      const correct = option.correct === true || option.outcome === 'correct';
      return {
        entry: baseEntry(block, now, { answer, correct, points: correct ? 1 : 0 }),
        notesAdded: [],
      };
    }

    case 'SCENE_HOTSPOTS': {
      const { visited, noted = [] } = parseAnswer(visitedAnswer, answer);
      // Spłaszczone: zewnętrzne hotspoty + wewnętrzne z media.kind:'scene' (B-086/D-071) - ta sama funkcja co walidacja
      // modułu (semantics.ts), więc "ten sam zbiór id" jest dokładnie jedną definicją, nie dwiema, które mogłyby się rozjechać.
      const hotspots = flattenHotspots(block.hotspots as HotspotLike[]);
      const all = hotspots.map((h) => h.id);
      // Drzwi (action:'next', B-086/D-071) WYKLUCZONE z puli required: nigdy nie trafiają do `visited` same z siebie
      // (klik od razu kończy blok) - inaczej scena z SAMYMI drzwiami nigdy nie mogłaby się ukończyć (semantics.ts ma
      // tę samą wykluczenie przy walidacji modułu).
      const doorIds = new Set((block.hotspots as { id: string; action?: string }[]).filter((h) => h.action === 'next').map((h) => h.id));
      requireCoverage('hotspoty', visited, all, requiredItemIds(hotspots.filter((h) => !doorIds.has(h.id)), block.requiredHotspots));
      // Do notatnika trafia tylko odwiedzony hotspot z evidence (i notatką); reszta to zwykły, bezpieczny 400 bez treści bloku.
      const evidenceIds = hotspots.filter((h) => h.evidence === true && h.note).map((h) => h.id);
      if (!unique(noted) || noted.some((id) => !visited.includes(id) || !evidenceIds.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: noted.map((id) => noteKey(block.id, id)) };
    }

    case 'DIALOGUE': {
      const { asked } = parseAnswer(askedAnswer, answer);
      const questions = block.questions as { id: string; required?: boolean; note?: unknown }[];
      requireCoverage('pytania', asked, questions.map((q) => q.id), requiredItemIds(questions, block.requiredQuestions));
      const notesAdded = questions.filter((q) => q.note && asked.includes(q.id)).map((q) => noteKey(block.id, q.id));
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded };
    }

    case 'DOSSIER': {
      // Teczka (D-083): wszystkie dokumenty otwarte (jak zakładki TABS), `noted` = zakreślone wiersze-dowody - ta sama ścieżka
      // notatek co hotspoty (klucz `<blockId>.<rowId>`). Zwykła linijka nigdy nie trafia do `noted` (400 bez treści bloku).
      const { opened, noted } = parseAnswer(dossierAnswer, answer);
      const documents = block.documents as { id: string; rows: DossierRowLike[] }[];
      requireCoverage('dokumenty', opened, documents.map((d) => d.id), undefined);
      const rows = flattenDossierRows(documents);
      const evidenceIds = rows.filter((r) => r.evidence === true && r.note).map((r) => r.id);
      if (!unique(noted) || noted.some((id) => !evidenceIds.includes(id))) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      // Wymagane wiersze (required: true, tylko dowody - walidacja treści) muszą być zakreślone - ta sama reguła co klient.
      const required = rows.filter((r) => r.required === true).map((r) => r.id);
      if (required.some((id) => !noted.includes(id))) {
        throw new BadRequestException('Nie ukończono wymaganych elementów (dowody w teczce)');
      }
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: noted.map((id) => noteKey(block.id, id)) };
    }

    case 'TABS': {
      const { opened } = parseAnswer(openedAnswer, answer);
      const all = (block.tabs as { id: string }[]).map((t) => t.id);
      requireCoverage('zakładki', opened, all, block.requiredTabs);
      return { entry: baseEntry(block, now, weightPoints(block)), notesAdded: [] };
    }

    case 'EMAIL_ANALYSIS': {
      const { selected: selectedOpaque } = parseAnswer(selectedAnswer, answer);
      const criteria = block.criteria as { id: string; correct: boolean; explanation?: string; note?: unknown }[];
      const selected = toRealIds(block, opaque, criteria, selectedOpaque);
      if (!unique(selected)) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const correctIds = criteria.filter((c) => c.correct).map((c) => c.id);
      const hits = selected.filter((id) => correctIds.includes(id)).length;
      const wrong = selected.length - hits;
      const points = emailPoints(block.scoring, correctIds.length, hits, wrong);
      const notesAdded = criteria
        .filter((c) => c.correct && c.note && selected.includes(c.id))
        .map((c) => noteKey(block.id, c.id));
      return {
        // `selected` (id z treści) zostaje w wpisie: podgląd ukończonego bloku ("Wstecz") pokazuje wybór gracza (clientProgress).
        entry: baseEntry(block, now, { correct: points === 1, points, selected }),
        notesAdded,
        detail: emailDetail(block, selected, opaque),
      };
    }

    case 'ORDERING': {
      const { order: orderOpaque } = parseAnswer(orderAnswer, answer);
      const items = block.items as { id: string }[];
      const correctOrder = items.map((i) => i.id);
      const order = toRealIds(block, opaque, items, orderOpaque);
      if (order.length !== correctOrder.length || !unique(order)) {
        throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
      }
      const inPlace = order.filter((id, index) => id === correctOrder[index]).length;
      const points = block.scoring === 'exact' ? (inPlace === correctOrder.length ? 1 : 0) : inPlace / correctOrder.length;
      return {
        entry: baseEntry(block, now, { correct: points === 1, points, order }),
        notesAdded: [],
        detail: orderingDetail(block, opaque),
      };
    }

    case 'TEXT_INPUT_GUIDED': {
      // "Dalej" po zadaniu: sama ocena zapada w /attempt. Bez rozstrzygnięcia (poprawna próba albo wyczerpane próby) nie da się przejść.
      if (!existing || !existing.done) {
        throw new BadRequestException('Najpierw rozwiąż zadanie (odpowiedz w polu tekstowym)');
      }
      return { entry: existing, notesAdded: [] };
    }

    // VIDEO, DRAG_AND_DROP, EMBEDDED_HTML, NOTEPAD, SUMMARY i typy nieznane (np. z wersji sprzed silnika): samo oznaczenie
    // wykonania, odpowiedź klienta jest ignorowana, nic nie jest oceniane po jego stronie.
    default:
      return { entry: baseEntry(block, now), notesAdded: [] };
  }
}

/**
 * Rozstrzygnięcie kryteriów maila po odpowiedzi (id nieprzejrzyste, jak w /start). Ta sama postać idzie w odpowiedzi /progress i, dla
 * bloku UKOŃCZONEGO, w widoku postępu (clientProgress): po ukończeniu klucz nie jest już tajny (pokazano go w wyniku).
 */
export function emailDetail(block: Block, selected: string[], opaque: OpaqueId) {
  const criteria = (Array.isArray(block.criteria) ? block.criteria : []) as { id: string; correct: boolean; explanation?: string }[];
  return {
    criteria: criteria.map((c) => ({
      id: opaque(block.id, c.id),
      correct: c.correct,
      selected: selected.includes(c.id),
      ...(c.explanation ? { explanation: c.explanation } : {}),
    })),
  };
}

/** Poprawna kolejność (id nieprzejrzyste) i wyjaśnienie: jak wyżej, tylko po ukończeniu bloku. */
export function orderingDetail(block: Block, opaque: OpaqueId) {
  const items = (Array.isArray(block.items) ? block.items : []) as { id: string }[];
  return {
    correctOrder: items.map((i) => opaque(block.id, i.id)),
    ...(block.explanation ? { explanation: block.explanation } : {}),
  };
}

// Bloki eksploracyjne: po spełnieniu wymagań punkty = 1 (ważne tylko, gdy autor nada im wagę > 0).
function weightPoints(block: Block): Partial<BlockEntry> {
  return weightOf(block) > 0 ? { points: 1, correct: true } : {};
}

export interface Reaction {
  pose: string;
  text: string;
}

interface ReactionResultEntry {
  pose: string;
  text: string;
  when?: 'correct' | 'incorrect';
  minScore?: number;
}

/**
 * Reakcja maskotki na WYNIK bloku ocenianego (schemaVersion 4, packages/content: baseShape.reactions.result). Pole jest
 * `secret` (FIELD_CLASSIFICATION) - nie ma go w treści z `/start` - więc wolno je czytać wprost z pełnego `block` po stronie
 * serwera, dopiero gdy wynik jest znany (ten sam wzorzec co `emailDetail`/`orderingDetail`/`solution`/`hints[]`: NIGDY przed
 * odpowiedzią). SCORED_BLOCK_TYPES/WHEN_BASED_TYPES to te same stałe, którymi semantics.ts (packages/content) waliduje treść
 * modułu przy imporcie, więc wybór tutaj zawsze trafia w kształt, jaki walidacja zagwarantowała.
 */
export function pickReaction(block: Block, entry: Pick<BlockEntry, 'correct' | 'points'>): Reaction | undefined {
  if (!(SCORED_BLOCK_TYPES as readonly string[]).includes(block.type)) return undefined;
  const result = (block.reactions as { result?: ReactionResultEntry[] } | undefined)?.result;
  if (!Array.isArray(result) || result.length === 0) return undefined;
  let match: ReactionResultEntry | undefined;
  if (WHEN_BASED_TYPES.has(block.type)) {
    if (entry.correct === undefined) return undefined; // nierozstrzygnięte (np. próba z zostałymi próbami) - jeszcze bez reakcji
    const when = entry.correct ? 'correct' : 'incorrect';
    match = result.find((candidate) => candidate.when === when);
  } else if (entry.points !== undefined) {
    const points = entry.points;
    // Lista malejąca (semantics.ts to waliduje przy imporcie): pierwszy wpis, którego próg jest osiągnięty, wygrywa.
    match = result.find((candidate) => typeof candidate.minScore === 'number' && candidate.minScore <= points);
  }
  // Wyłącznie pose+text: `when`/`minScore` to wewnętrzny klucz doboru reakcji, nie treść do pokazania (i tak jest tylko w
  // sekrecie serwera, ale odpowiedź API ma nieść dokładnie to, co ma pokazać klient, nic więcej - biała lista jak toClientBlock).
  return match ? { pose: match.pose, text: match.text } : undefined;
}

export function emailPoints(scoring: string | undefined, totalCorrect: number, hits: number, wrong: number): number {
  if (scoring === 'exact') return hits === totalCorrect && wrong === 0 ? 1 : 0;
  if (totalCorrect === 0) return wrong === 0 ? 1 : 0;
  return Math.max(0, (hits - wrong) / totalCorrect);
}

// --- TEXT_INPUT_GUIDED --------------------------------------------------------------------------------------------------

export interface AttemptResponse {
  blockId: string;
  correct: boolean;
  attempt: number;
  attemptsLeft: number;
  done: boolean;
  points?: number;
  hint?: { text: string; narration?: unknown };
  solution?: { text: string; explanation?: string };
  reaction?: Reaction;
}

export function normalizeText(
  input: string,
  rules: { trim?: boolean; collapseWhitespace?: boolean; caseSensitive?: boolean },
): string {
  let value = input;
  if (rules.trim !== false) value = value.trim();
  if (rules.collapseWhitespace !== false) value = value.replace(/\s+/g, ' ');
  if (!rules.caseSensitive) value = value.toLowerCase();
  return value;
}

export function isTextCorrect(block: Block, input: string): boolean {
  const caseSensitive = block.answer?.caseSensitive === true;
  const rules = { ...(block.normalize ?? {}), caseSensitive };
  const value = normalizeText(input, rules);
  const accept: string[] = Array.isArray(block.answer?.accept) ? block.answer.accept : [];
  if (accept.some((candidate) => normalizeText(candidate, rules) === value)) return true;
  if (typeof block.answer?.regex === 'string') {
    // Silnik RE2 (czas liniowy, bez nawrotu): żaden wzorzec z treści nie zawiesi procesu (ReDoS). TEN SAM silnik waliduje wzorzec
    // przy imporcie modułu, więc co przeszło walidację, da się dopasować. Dopasowanie obejmuje CAŁĄ odpowiedź (^(?:...)$), a
    // limity długości wzorca (200) i odpowiedzi (MAX_TEXT_ANSWER, sprawdzany w evaluateAttempt przed dopasowaniem) są drugim
    // bezpiecznikiem.
    return compileAnswerRegex(block.answer.regex, caseSensitive).test(value);
  }
  return false;
}

export function attemptPoints(attemptNumber: number, penalty: number, floor: number): number {
  return Math.max(floor, 1 - (attemptNumber - 1) * penalty);
}

/** Jedna próba odpowiedzi. Rozstrzyga blok przy poprawnej odpowiedzi albo po wyczerpaniu prób (wtedy odsłania rozwiązanie). */
export function evaluateAttempt(
  block: Block,
  input: string,
  existing: BlockEntry | undefined,
  now: Date,
): { entry: BlockEntry; response: AttemptResponse } {
  if (input.length > MAX_TEXT_ANSWER) throw new BadRequestException('Odpowiedź jest zbyt długa');
  if (existing?.done) throw new BadRequestException('To zadanie jest już rozstrzygnięte');

  const maxAttempts: number = block.maxAttempts ?? 4;
  const attemptNumber = (existing?.attempts ?? 0) + 1;
  const hints: { text: string; narration?: unknown }[] = Array.isArray(block.hints) ? block.hints : [];
  const correct = isTextCorrect(block, input);
  const exhausted = !correct && attemptNumber >= maxAttempts;
  const done = correct || exhausted;

  const scoring = block.scoring ?? {};
  const points = correct ? attemptPoints(attemptNumber, scoring.attemptPenalty ?? 0.25, scoring.floor ?? 0.25) : 0;

  // Podpowiedź przysługuje po błędnej próbie (n-ta błędna próba -> n-ta podpowiedź); po rozstrzygnięciu nie ma po co.
  const hint = !done && hints[attemptNumber - 1] ? hints[attemptNumber - 1] : undefined;
  const hintsShown = Math.max(existing?.hintsShown ?? 0, hint ? attemptNumber : 0);

  const entry: BlockEntry = {
    type: block.type,
    done,
    answeredAt: now.toISOString(),
    weight: weightOf(block),
    attempts: attemptNumber,
    hintsShown,
    ...(done ? { correct, points } : {}),
  };

  const response: AttemptResponse = {
    blockId: block.id,
    correct,
    attempt: attemptNumber,
    attemptsLeft: Math.max(0, maxAttempts - attemptNumber),
    done,
    ...(done ? { points } : {}),
    ...(hint ? { hint } : {}),
    ...(exhausted ? { solution: block.solution } : {}),
  };
  return { entry, response };
}
