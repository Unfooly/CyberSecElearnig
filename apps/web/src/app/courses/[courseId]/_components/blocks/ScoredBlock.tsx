'use client';

import type { ChosenAnswer, ClientProgressBlock, ContentBlock, ResultDetail } from '@/lib/courses-types';
import EmailAnalysisBlock from './EmailAnalysisBlock';
import OrderingBlock from './OrderingBlock';
import TextInputBlock from './TextInputBlock';

// Bloki oceniane z rozstrzygnięciem po odpowiedzi (mail, kolejność, zadanie tekstowe) w trzech widokach: odpowiadanie, WYNIK zaraz po
// zapisie (z przyciskiem dalej) i PODGLĄD ukończonego bloku ("Wstecz", bez przycisku). Ocena zawsze z serwera; ten komponent tylko
// pokazuje wybór gracza i rozstrzygnięcie (id nieprzejrzyste, jak w /start).
export const SCORED_TYPES = ['EMAIL_ANALYSIS', 'ORDERING', 'TEXT_INPUT_GUIDED'] as const;

export const isScored = (type: string) => (SCORED_TYPES as readonly string[]).includes(type);

/** Bloki, których wynik pokazujemy w samym bloku (zamiast ogólnego "Poprawna / niepoprawna odpowiedź"). */
export const hasInlineResult = (type: string) => type === 'EMAIL_ANALYSIS' || type === 'ORDERING';

export interface ScoredResult {
  answer?: ChosenAnswer;
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
}

export default function ScoredBlock({
  block,
  courseId,
  onSubmit,
  disabled,
  result,
  progress,
  onContinue,
  continueLabel,
  onProgress,
}: {
  block: ContentBlock;
  courseId: string;
  onSubmit?: (answer?: unknown) => void;
  disabled?: boolean;
  /** Ustawione = widok wyniku (po zapisie z `onContinue`, w podglądzie bez). */
  result?: ScoredResult;
  /** Stan zadania tekstowego z serwera (próby, podpowiedzi, rozwiązanie). */
  progress?: ClientProgressBlock;
  onContinue?: () => void;
  continueLabel?: string;
  /** Zadanie tekstowe zgłasza rozstrzygnięty stan (do podglądu "Wstecz" w tej samej sesji). */
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
}) {
  switch (block.type) {
    case 'EMAIL_ANALYSIS': {
      const answer = result?.answer && typeof result.answer === 'object' && 'selected' in result.answer ? result.answer : undefined;
      return (
        <EmailAnalysisBlock
          block={block}
          onSubmit={onSubmit}
          disabled={disabled}
          result={result ? { answer, detail: result.detail, correct: result.correct, points: result.points } : undefined}
          onContinue={onContinue}
          continueLabel={continueLabel}
        />
      );
    }
    case 'ORDERING': {
      const answer = result?.answer && typeof result.answer === 'object' && 'order' in result.answer ? result.answer : undefined;
      return (
        <OrderingBlock
          block={block}
          onSubmit={onSubmit}
          disabled={disabled}
          result={result ? { answer, detail: result.detail, correct: result.correct, points: result.points } : undefined}
          onContinue={onContinue}
          continueLabel={continueLabel}
        />
      );
    }
    case 'TEXT_INPUT_GUIDED':
      return (
        <TextInputBlock
          block={block}
          courseId={courseId}
          progress={progress}
          onContinue={onContinue}
          disabled={disabled}
          readOnly={!!result && !onContinue}
          onProgress={onProgress}
        />
      );
    default:
      return null;
  }
}
