'use client';

import type { ChosenAnswer, ClientProgressBlock, ContentBlock, ContentReaction, ResultDetail } from '@/lib/courses-types';
import EmailAnalysisBlock from './EmailAnalysisBlock';
import OrderingBlock from './OrderingBlock';
import TextInputBlock from './TextInputBlock';

// Bloki oceniane z rozstrzygnięciem po odpowiedzi (mail, kolejność, zadanie tekstowe) w trzech widokach: odpowiadanie, WYNIK zaraz po
// zapisie (`live` - reakcja, animacja werdyktu) i PODGLĄD ukończonego bloku ("Wstecz"). Żaden widok nie ma przycisku dalej - „Dalej” jest
// wyłącznie w dolnym pasku (D-106). Ocena zawsze z serwera; ten komponent tylko pokazuje wybór gracza i rozstrzygnięcie (id nieprzejrzyste,
// jak w /start).
export const SCORED_TYPES = ['EMAIL_ANALYSIS', 'ORDERING', 'TEXT_INPUT_GUIDED'] as const;

export const isScored = (type: string) => (SCORED_TYPES as readonly string[]).includes(type);

/** Bloki, których wynik pokazujemy w samym bloku (zamiast ogólnego "Poprawna / niepoprawna odpowiedź"). */
export const hasInlineResult = (type: string) => type === 'EMAIL_ANALYSIS' || type === 'ORDERING';

export interface ScoredResult {
  answer?: ChosenAnswer;
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  // Reakcja na wynik (schemaVersion 4; od D-093 tylko tekst), dopiero po ukończeniu - patrz packages/content D-061.
  reaction?: ContentReaction;
}

export default function ScoredBlock({
  block,
  courseId,
  onSubmit,
  disabled,
  result,
  progress,
  live = false,
  onReady,
  onProgress,
  caseNo,
}: {
  block: ContentBlock;
  courseId: string;
  /** Numer sprawy z odprawy (tabliczka tablicy śledczej, ORDERING). */
  caseNo?: string;
  onSubmit?: (answer?: unknown) => void;
  disabled?: boolean;
  /** Ustawione = widok wyniku (`live` - zaraz po zapisie, bez - podgląd "Wstecz"). */
  result?: ScoredResult;
  /** Wynik zaraz po zapisie (reakcja, animacja werdyktu) - nie podgląd. */
  live?: boolean;
  /** Stan zadania tekstowego z serwera (próby, podpowiedzi, rozwiązanie). */
  progress?: ClientProgressBlock;
  /** Zadanie tekstowe po rozstrzygnięciu zgłasza gotowość - zapis rusza „Dalej” w pasku (D-106). */
  onReady?: (submit: (() => void) | null) => void;
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
          result={result ? { answer, detail: result.detail, correct: result.correct, points: result.points, reaction: result.reaction } : undefined}
          live={live}
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
          result={result ? { answer, detail: result.detail, correct: result.correct, points: result.points, reaction: result.reaction } : undefined}
          live={live}
          caseNo={caseNo}
        />
      );
    }
    case 'TEXT_INPUT_GUIDED':
      return (
        <TextInputBlock
          block={block}
          courseId={courseId}
          progress={progress}
          onReady={onReady ? (ready) => onReady(ready ? () => onSubmit?.() : null) : undefined}
          disabled={disabled}
          readOnly={!!result && !live}
          onProgress={onProgress}
        />
      );
    default:
      return null;
  }
}
