import { QUIZ_PASS_PERCENT, finalQuizIndexes } from '@cyberszkolo/content';
import type { ProgressV2 } from './progress';
import type { Block } from './scoring/evaluate';

// Próg i zakres quizu (D-207) - wspólna reguła z packages/content (ta sama w dev harnessie odtwarzacza).
export { QUIZ_PASS_PERCENT, finalQuizIndexes };

/** Stan quizu w postępie przypisania (`progress.quiz`, D-207): liczba podejść i wynik ostatniego. */
export interface QuizState {
  /** Ukończone podejścia do quizu (zaliczone albo nie). */
  attempts: number;
  /** Ostatnie podejście poniżej progu - przejście dalej zablokowane do „Powtórz quiz”. */
  failed: boolean;
  correct: number;
  total: number;
}

export interface QuizResult {
  correct: number;
  total: number;
  passPercent: number;
  passed: boolean;
  attempts: number;
}

/** Wynik quizu z wpisów postępu: dobrze = blok zapisany z `correct: true` (jedna próba, D-204); zaliczony od QUIZ_PASS_PERCENT %. */
export function quizScore(progress: ProgressV2, blocks: readonly Block[], indexes: readonly number[]): { correct: number; total: number; passed: boolean } {
  const total = indexes.length;
  const correct = indexes.filter((index) => {
    const entry = progress.blocks[blocks[index].id];
    return entry?.done === true && entry.correct === true;
  }).length;
  return { correct, total, passed: total === 0 || correct * 100 >= QUIZ_PASS_PERCENT * total };
}

export function quizResultOf(state: QuizState): QuizResult {
  return { correct: state.correct, total: state.total, passPercent: QUIZ_PASS_PERCENT, passed: !state.failed, attempts: state.attempts };
}

/** Quiz w odpowiedzi /start (D-207): id pytań quizu i wynik ostatniego podejścia; null - moduł bez quizu. */
export function quizViewOf(
  blocks: readonly Block[],
  simpleMode: boolean,
  progress: ProgressV2,
): { blockIds: string[]; passPercent: number; result: QuizResult | null } | null {
  const indexes = finalQuizIndexes(blocks, simpleMode);
  if (indexes.length === 0) return null;
  // Po „Powtórz quiz” stan ma total 0 (nowe podejście w toku) - bez wyniku.
  const state = progress.quiz && progress.quiz.total > 0 ? progress.quiz : undefined;
  return { blockIds: indexes.map((index) => blocks[index].id), passPercent: QUIZ_PASS_PERCENT, result: state ? quizResultOf(state) : null };
}

/** Odczyt `progress.quiz` z bazy (JSON) - tylko poprawny kształt, inaczej brak stanu. */
export function readQuizState(raw: unknown): QuizState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const int = (key: string) => (Number.isInteger(value[key]) && (value[key] as number) >= 0 ? (value[key] as number) : null);
  const attempts = int('attempts');
  const correct = int('correct');
  const total = int('total');
  if (attempts === null || correct === null || total === null || typeof value.failed !== 'boolean') return undefined;
  return { attempts, correct, total, failed: value.failed };
}
