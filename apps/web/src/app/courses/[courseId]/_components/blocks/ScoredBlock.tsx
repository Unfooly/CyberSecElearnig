'use client';

import type { ChosenAnswer, ClientProgressBlock, ContentBlock, ContentReaction, EvidenceSummary, InterrogationChallenge, ResultDetail } from '@/lib/courses-types';
import EmailAnalysisBlock from './EmailAnalysisBlock';
import OrderingBlock from './OrderingBlock';
import TextInputBlock from './TextInputBlock';
import CallRecordingBlock from './CallRecordingBlock';
import InterrogationBlock, { InterrogationResult } from './InterrogationBlock';
import OsintBlock from './OsintBlock';
import LiveCallBlock from './LiveCallBlock';

// Bloki oceniane z rozstrzygnięciem po odpowiedzi (mail, kolejność, zadanie tekstowe) w trzech widokach: odpowiadanie, WYNIK zaraz po
// zapisie (`live` - reakcja, animacja werdyktu) i PODGLĄD ukończonego bloku ("Wstecz"). Żaden widok nie ma przycisku dalej - „Dalej” jest
// wyłącznie w dolnym pasku (D-106). Ocena zawsze z serwera; ten komponent tylko pokazuje wybór gracza i rozstrzygnięcie (id nieprzejrzyste,
// jak w /start).
export const SCORED_TYPES = ['EMAIL_ANALYSIS', 'ORDERING', 'TEXT_INPUT_GUIDED', 'CALL_RECORDING', 'INTERROGATION', 'OSINT_SPOT', 'LIVE_CALL'] as const;

/**
 * Bloki „tablicowe” (B-136): wynik na tym samym ekranie co zadanie, wypełniają ramkę ('fill') także w wyniku zaraz po zapisie i w podglądzie
 * „Wstecz” - tablica śledcza (D-088), odsłuch nagrania (D-115), OSINT (D-121), rozmowa na żywo (D-123). Jedna lista dla CoursePlayer i ReviewBlock.
 */
export const BOARD_TYPES: readonly string[] = ['ORDERING', 'CALL_RECORDING', 'OSINT_SPOT', 'LIVE_CALL'];

export const isScored = (type: string) => (SCORED_TYPES as readonly string[]).includes(type);

/** Bloki, których wynik pokazujemy w samym bloku (zamiast ogólnego "Poprawna / niepoprawna odpowiedź"). */
export const hasInlineResult = (type: string) =>
  type === 'EMAIL_ANALYSIS' ||
  type === 'ORDERING' ||
  type === 'CALL_RECORDING' ||
  type === 'INTERROGATION' ||
  type === 'OSINT_SPOT' ||
  type === 'LIVE_CALL';

export interface ScoredResult {
  answer?: ChosenAnswer;
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  // Reakcja na wynik (schemaVersion 4; od D-093 tylko tekst), dopiero po ukończeniu - patrz packages/content D-061.
  reaction?: ContentReaction;
  // Przesłuchanie (D-118): własne podważenia gracza (trafienia i pudła) do wyniku.
  challenges?: InterrogationChallenge[];
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
  contentBase,
  onEvidence,
  myAvatarUrl,
  myInitials,
}: {
  block: ContentBlock;
  courseId: string;
  /** Przesłuchanie (D-118): liczby dowodów z serwera po trafionym podważeniu. */
  onEvidence?: (summary: EvidenceSummary) => void;
  myAvatarUrl?: string | null;
  myInitials?: string;
  /** Baza zasobów (nagrania CALL_RECORDING). */
  contentBase?: string;
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
    case 'CALL_RECORDING': {
      // Odsłuch nagrania (D-115): wynik pokazuje rozstrzygnięcie flag z serwera (detail.flags), nie wybór gracza.
      const answer = result?.answer && typeof result.answer === 'object' && 'taps' in result.answer ? result.answer : undefined;
      return (
        <CallRecordingBlock
          block={block}
          contentBase={contentBase ?? ''}
          onSubmit={onSubmit}
          disabled={disabled}
          result={result ? { answer, detail: result.detail, correct: result.correct, points: result.points, reaction: result.reaction } : undefined}
        />
      );
    }
    case 'INTERROGATION':
      // Przesłuchanie (D-118): wynik - rozstrzygnięcie sprzeczności z serwera i własne podważenia; bez wyniku - przesłuchanie na żywo.
      return result ? (
        <InterrogationResult block={block} detail={result.detail} challenges={result.challenges ?? progress?.challenges} points={result.points} />
      ) : (
        <InterrogationBlock
          block={block}
          courseId={courseId}
          contentBase={contentBase ?? ''}
          onSubmit={(answer) => onSubmit?.(answer)}
          onReady={(submit) => onReady?.(submit)}
          progress={progress}
          onProgress={onProgress}
          onEvidence={onEvidence}
          myAvatarUrl={myAvatarUrl}
          myInitials={myInitials}
        />
      );
    case 'OSINT_SPOT': {
      // OSINT (D-120/D-121): wynik na tej samej stronie - rozstrzygnięcie obszarów z serwera (detail.spots, z zaznaczeniami gracza).
      return (
        <OsintBlock
          block={block}
          contentBase={contentBase ?? ''}
          onSubmit={(answer) => onSubmit?.(answer)}
          onReady={(submit) => onReady?.(submit)}
          disabled={disabled}
          result={result ? { detail: result.detail, points: result.points } : undefined}
        />
      );
    }
    case 'LIVE_CALL': {
      // Rozmowa na żywo (D-122/D-123): wynik na tym samym ekranie - transkrypcja rozmowy ze ścieżki gracza i rozstrzygnięcie z serwera.
      const answer =
        result?.answer && typeof result.answer === 'object' && 'path' in result.answer && Array.isArray(result.answer.path) ? result.answer : undefined;
      return (
        <LiveCallBlock
          block={block}
          contentBase={contentBase ?? ''}
          onSubmit={(liveAnswer) => onSubmit?.(liveAnswer)}
          onReady={(submit) => onReady?.(submit)}
          disabled={disabled}
          result={result ? { detail: result.detail, answer, points: result.points } : undefined}
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
