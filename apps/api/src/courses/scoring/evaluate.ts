import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_WEIGHT, BlockType, idSchema, requiredItemIds } from '@cyberszkolo/content';
import { compileAnswerRegex } from '@cyberszkolo/content/dist/node';
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
      const hotspots = block.hotspots as { id: string; required?: boolean; evidence?: boolean; note?: unknown }[];
      const all = hotspots.map((h) => h.id);
      requireCoverage('hotspoty', visited, all, requiredItemIds(hotspots, block.requiredHotspots));
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
        entry: baseEntry(block, now, { correct: points === 1, points }),
        notesAdded,
        detail: {
          // Id nieprzejrzyste: klient rozpoznaje kryteria po id, które dostał w /start.
          criteria: criteria.map((c) => ({
            id: opaque(block.id, c.id),
            correct: c.correct,
            selected: selected.includes(c.id),
            ...(c.explanation ? { explanation: c.explanation } : {}),
          })),
        },
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
        entry: baseEntry(block, now, { correct: points === 1, points }),
        notesAdded: [],
        detail: {
          correctOrder: correctOrder.map((id) => opaque(block.id, id)),
          ...(block.explanation ? { explanation: block.explanation } : {}),
        },
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

// Bloki eksploracyjne: po spełnieniu wymagań punkty = 1 (ważne tylko, gdy autor nada im wagę > 0).
function weightPoints(block: Block): Partial<BlockEntry> {
  return weightOf(block) > 0 ? { points: 1, correct: true } : {};
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
