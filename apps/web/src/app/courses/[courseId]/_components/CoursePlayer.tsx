'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContentBlock, CourseDetail, CourseProgressResponse, LastResult } from '@/lib/courses-types';
import VideoBlock from './blocks/VideoBlock';
import QuizBlock from './blocks/QuizBlock';
import BranchingScenarioBlock from './blocks/BranchingScenarioBlock';
import DragAndDropBlock from './blocks/DragAndDropBlock';
import FeedbackPanel from './FeedbackPanel';
import SummaryScreen from './SummaryScreen';

export interface CoursePlayerInitialState extends CourseDetail {
  // Wzbogacone server-side (page.tsx) o wynik z GET /courses/my, gdy user
  // wraca do kursu już ukończonego wcześniej - /start go nie zwraca.
  score: number | null;
}

type PlayerState = Pick<CoursePlayerInitialState, 'status' | 'currentBlockIndex' | 'score'>;

function renderBlock(
  block: ContentBlock,
  onSubmit: (answer?: number) => void,
  disabled: boolean,
) {
  switch (block.type) {
    case 'VIDEO':
      return <VideoBlock block={block} onSubmit={() => onSubmit(undefined)} disabled={disabled} />;
    case 'QUIZ':
      return <QuizBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'BRANCHING_SCENARIO':
      return <BranchingScenarioBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'DRAG_AND_DROP':
      return <DragAndDropBlock block={block} onSubmit={() => onSubmit(undefined)} disabled={disabled} />;
    default:
      // Nieznany typ bloku (np. backend dodał nowy typ, front się jeszcze
      // nie zaktualizował) - jawny komunikat zamiast pustego <div>.
      return <p className="text-slate-500">Ten typ treści nie jest jeszcze obsługiwany.</p>;
  }
}

export default function CoursePlayer({
  courseId,
  initial,
  scoreUnavailable = false,
}: {
  courseId: string;
  initial: CoursePlayerInitialState;
  // true tylko, gdy user wrócił do JUŻ ukończonego kursu, a pobranie
  // wyniku z GET /courses/my (page.tsx) się nie powiodło - odróżnia to od
  // "kurs naprawdę nie miał ocenianych bloków" (score === null poprawnie).
  scoreUnavailable?: boolean;
}) {
  const router = useRouter();
  // Stan postępu (status/currentBlockIndex/score) pochodzi WYŁĄCZNIE z API -
  // po każdej odpowiedzi jest CAŁKOWICIE nadpisywany odpowiedzią z
  // /progress, nigdy inkrementowany lokalnie. `feedback` to jedyny czysto
  // lokalny, przejściowy stan UI (co przed chwilą odpowiedziałeś) - nie
  // konkuruje z currentBlockIndex jako źródło prawdy o postępie.
  const [state, setState] = useState<PlayerState>({
    status: initial.status,
    currentBlockIndex: initial.currentBlockIndex,
    score: initial.score,
  });
  const [feedback, setFeedback] = useState<LastResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kurs już ukończony (świeżo albo user wrócił do starego) - podsumowanie
  // zamiast pozwalania przejść przez bloki jeszcze raz. scoreUnavailable
  // dotyczy tylko ścieżki "wrócił do starego" - po świeżym ukończeniu w tej
  // sesji state.score zawsze pochodzi wprost z odpowiedzi /progress.
  if (state.status === 'COMPLETED' && !feedback) {
    return (
      <SummaryScreen title={initial.title} score={state.score} scoreUnavailable={scoreUnavailable} />
    );
  }

  async function handleAnswer(answer?: number) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          answer === undefined
            ? { blockIndex: state.currentBlockIndex }
            : { blockIndex: state.currentBlockIndex, answer },
        ),
      });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się zapisać odpowiedzi.');
        return;
      }

      const progress = data as CourseProgressResponse;
      setFeedback(progress.lastResult);
      setState({
        status: progress.status,
        currentBlockIndex: progress.currentBlockIndex,
        score: progress.score,
      });
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setSubmitting(false);
    }
  }

  if (feedback) {
    return (
      <FeedbackPanel
        feedback={feedback}
        onContinue={() => setFeedback(null)}
        continueLabel={state.status === 'COMPLETED' ? 'Zobacz podsumowanie' : 'Dalej'}
      />
    );
  }

  const currentBlock = initial.contentBlocks[state.currentBlockIndex];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">{initial.title}</h1>
      {error && (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        {currentBlock ? (
          renderBlock(currentBlock, handleAnswer, submitting)
        ) : (
          <p className="text-slate-500">Nie znaleziono treści tego bloku.</p>
        )}
      </div>
    </div>
  );
}
