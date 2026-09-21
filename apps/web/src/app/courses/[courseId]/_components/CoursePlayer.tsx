'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ClientProgressBlock,
  ContentBlock,
  CourseCompletionReward,
  CourseDetail,
  CourseProgressResponse,
  LastResult,
} from '@/lib/courses-types';
import { LOCAL_CONTENT_BASE, contentAssetUrl } from '@/lib/content-assets';
import MascotSays from '@/components/MascotSays';
import VideoBlock from './blocks/VideoBlock';
import QuizBlock from './blocks/QuizBlock';
import BranchingScenarioBlock from './blocks/BranchingScenarioBlock';
import DragAndDropBlock from './blocks/DragAndDropBlock';
import EmbeddedHtmlBlock from './blocks/EmbeddedHtmlBlock';
import ExploratoryBlock, { isExploratory } from './blocks/ExploratoryBlock';
import FeedbackPanel from './FeedbackPanel';
import SummaryScreen from './SummaryScreen';
import PlayerShell from './player/PlayerShell';
import NarrationPlayer from './player/NarrationPlayer';
import ReviewBlock from './player/ReviewBlock';
import { NotesPanel, NotesProvider, useNotes } from './player/notes';
import { useNarrationPreference } from './player/useNarrationPreference';

export interface CoursePlayerInitialState extends CourseDetail {
  // Wzbogacone server-side (page.tsx) o wynik z GET /courses/my, gdy user
  // wraca do kursu już ukończonego wcześniej - /start go nie zwraca.
  score: number | null;
}

type PlayerState = Pick<CoursePlayerInitialState, 'status' | 'currentBlockIndex' | 'score'>;

function renderBlock(
  block: ContentBlock,
  onSubmit: (answer?: unknown) => void,
  disabled: boolean,
  contentBase: string,
) {
  if (isExploratory(block.type)) {
    // key: stan wewnętrzny (odwiedzone elementy) nie może przechodzić między kolejnymi blokami tego samego typu.
    return <ExploratoryBlock key={block.id} block={block} contentBase={contentBase} onSubmit={onSubmit} disabled={disabled} />;
  }
  switch (block.type) {
    case 'VIDEO':
      return <VideoBlock block={block} onSubmit={() => onSubmit(undefined)} disabled={disabled} />;
    case 'QUIZ':
      return <QuizBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'BRANCHING_SCENARIO':
      return <BranchingScenarioBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'DRAG_AND_DROP':
      return <DragAndDropBlock block={block} onSubmit={() => onSubmit(undefined)} disabled={disabled} />;
    case 'EMBEDDED_HTML':
      return <EmbeddedHtmlBlock block={block} onSubmit={() => onSubmit(undefined)} disabled={disabled} />;
    default:
      // Nieznany typ bloku (np. backend dodał nowy typ, front się jeszcze
      // nie zaktualizował) - jawny komunikat zamiast pustego <div>.
      return <p className="text-slate-500">Ten typ treści nie jest jeszcze obsługiwany.</p>;
  }
}

// Powłoka z licznikiem notatek (kontekst notatnika): osobny komponent, bo hook useNotes musi być pod NotesProvider.
const NOTES_ID = 'notes-panel';

function ShellWithNotes(props: Omit<React.ComponentProps<typeof PlayerShell>, 'notesCount' | 'notesPanel' | 'notesId'>) {
  const { notes } = useNotes();
  return <PlayerShell {...props} notesCount={notes.length} notesId={NOTES_ID} notesPanel={<NotesPanel id={NOTES_ID} />} />;
}

const blockIdOf = (blocks: ContentBlock[], index: number) => blocks[index]?.id ?? `b${index}`;

export default function CoursePlayer({
  courseId,
  initial,
  scoreUnavailable = false,
  narrationEnabled = true,
  contentBase = LOCAL_CONTENT_BASE,
}: {
  courseId: string;
  initial: CoursePlayerInitialState;
  // true tylko, gdy user wrócił do JUŻ ukończonego kursu, a pobranie
  // wyniku z GET /courses/my (page.tsx) się nie powiodło - odróżnia to od
  // "kurs naprawdę nie miał ocenianych bloków" (score === null poprawnie).
  scoreUnavailable?: boolean;
  // Ustawienie konta (users.narrationEnabled), czytane server-side w page.tsx.
  narrationEnabled?: boolean;
  // Baza adresów zasobów (CONTENT_BASE_URL albo /content lokalnie), z page.tsx.
  contentBase?: string;
}) {
  const router = useRouter();
  // Stan postępu (status/currentBlockIndex/score) pochodzi WYŁĄCZNIE z API -
  // po każdej odpowiedzi jest CAŁKOWICIE nadpisywany odpowiedzią z
  // /progress, nigdy inkrementowany lokalnie. `feedback` to jedyny czysto
  // lokalny, przejściowy stan UI (co przed chwilą odpowiedziałeś) - nie
  // konkuruje z currentBlockIndex jako źródło prawdy o postępie.
  // Po odświeżeniu strony wracamy do bloku z serwera (initial), nie z localStorage.
  const [state, setState] = useState<PlayerState>({
    status: initial.status,
    currentBlockIndex: initial.currentBlockIndex,
    score: initial.score,
  });
  const [feedback, setFeedback] = useState<LastResult | null>(null);
  // Obecne WYŁĄCZNIE po świeżym ukończeniu w TEJ sesji (ustawiane w
  // handleAnswer z odpowiedzi /progress) - zostaje null, gdy user po prostu
  // wrócił do wcześniej ukończonego kursu, więc CourseRewardModal wtedy się
  // nie pokazuje.
  const [reward, setReward] = useState<CourseCompletionReward | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Podgląd wcześniejszego bloku ("Wstecz"): tylko klient, bez skutku na serwerze; null = bieżący blok z serwera.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  // Klucz bloku, dla którego wolno rozpocząć narrację automatycznie (po geście "Dalej", gdy poprzedni blok miał nagranie).
  const [autoPlayFor, setAutoPlayFor] = useState<string | null>(null);
  // Wyniki bloków po id: początkowe z /start, uzupełniane po każdej odpowiedzi w tej sesji (dla podglądu "Wstecz").
  const [results, setResults] = useState<Record<string, ClientProgressBlock>>(initial.progress?.blocks ?? {});
  const preference = useNarrationPreference(narrationEnabled);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  // Synchroniczna blokada podwójnego wysłania (stan `submitting` aktualizuje się asynchronicznie, więc dwa kliknięcia w tym samym ticku
  // by go ominęły): każdy blok oceniany korzysta z handleAnswer, więc wzorzec jest w powłoce.
  const submittingRef = useRef(false);

  const blocks = initial.contentBlocks;
  const displayedIndex = viewIndex ?? state.currentBlockIndex;

  // Po zmianie bloku fokus na nagłówek sceny (czytniki ekranu i klawiatura zaczynają od nowej treści); nie przy pierwszym renderze.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [displayedIndex, feedback]);

  // Kurs już ukończony (świeżo albo user wrócił do starego) - podsumowanie
  // zamiast pozwalania przejść przez bloki jeszcze raz. scoreUnavailable
  // dotyczy tylko ścieżki "wrócił do starego" - po świeżym ukończeniu w tej
  // sesji state.score zawsze pochodzi wprost z odpowiedzi /progress.
  if (state.status === 'COMPLETED' && !feedback) {
    return (
      <SummaryScreen
        title={initial.title}
        score={state.score}
        scoreUnavailable={scoreUnavailable}
        reward={reward}
      />
    );
  }

  const hasAudio = (index: number) =>
    preference.enabled && contentAssetUrl(contentBase, blocks[index]?.narration?.audioUrl, 'audio') !== null;
  const keyOf = (index: number) => blockIdOf(blocks, index);

  async function handleAnswer(answer?: unknown) {
    if (submittingRef.current) return;
    submittingRef.current = true;
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
      // Po zapisie wracamy do bieżącego bloku z serwera: ewentualny podgląd ("Wstecz") z czasu oczekiwania nie może przetrwać.
      setViewIndex(null);
      setFeedback(progress.lastResult);
      setResults((current) => ({
        ...current,
        [progress.lastResult.blockId ?? blockIdOf(blocks, progress.lastResult.blockIndex)]: {
          type: progress.lastResult.type,
          done: true,
          ...(progress.lastResult.correct !== undefined ? { correct: progress.lastResult.correct } : {}),
          ...(progress.lastResult.points !== undefined ? { points: progress.lastResult.points } : {}),
        },
      }));
      setReward(progress.gamification);
      setState({
        status: progress.status,
        currentBlockIndex: progress.currentBlockIndex,
        score: progress.score,
      });
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // "Dalej" po wyniku bloku: autoodtwarzanie następnego bloku tylko gdy poprzedni miał nagranie i lektor jest włączony.
  function continueAfterFeedback() {
    const answeredIndex = feedback?.blockIndex ?? state.currentBlockIndex - 1;
    setAutoPlayFor(hasAudio(answeredIndex) ? keyOf(state.currentBlockIndex) : null);
    setFeedback(null);
  }

  function goBack() {
    if (displayedIndex <= 0) return;
    setAutoPlayFor(null);
    setViewIndex(displayedIndex - 1);
  }

  function goForward() {
    if (viewIndex === null) return;
    const next = viewIndex + 1;
    setAutoPlayFor(hasAudio(viewIndex) ? keyOf(next) : null);
    setViewIndex(next >= state.currentBlockIndex ? null : next);
  }

  const reviewing = viewIndex !== null;
  const currentBlock = blocks[displayedIndex];
  const showingFeedback = feedback !== null;

  let stage: React.ReactNode;
  if (showingFeedback) {
    stage = (
      <FeedbackPanel
        feedback={feedback}
        onContinue={continueAfterFeedback}
        continueLabel={state.status === 'COMPLETED' ? 'Zobacz podsumowanie' : 'Dalej'}
      />
    );
  } else if (!currentBlock) {
    stage = <p className="text-slate-500">Nie znaleziono treści tego bloku.</p>;
  } else if (reviewing) {
    stage = <ReviewBlock key={keyOf(displayedIndex)} block={currentBlock} result={results[keyOf(displayedIndex)]} contentBase={contentBase} />;
  } else {
    stage = renderBlock(currentBlock, handleAnswer, submitting, contentBase);
  }

  const narrationBlock = showingFeedback ? blocks[feedback.blockIndex] : currentBlock;

  return (
    <NotesProvider initial={initial.progress?.notes ?? []}>
      <ShellWithNotes
        title={initial.title}
        blockNumber={Math.min(displayedIndex + 1, blocks.length)}
        totalBlocks={blocks.length}
        completedBlocks={state.currentBlockIndex}
        headingRef={headingRef}
        mascot={currentBlock?.mascot && !showingFeedback ? <MascotSays pose={currentBlock.mascot.pose} text={currentBlock.mascot.text} /> : undefined}
        stage={
          <>
            {error && (
              <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {stage}
          </>
        }
        narration={
          <NarrationPlayer
            key={`${keyOf(showingFeedback ? feedback.blockIndex : displayedIndex)}-${showingFeedback ? 'w' : 'b'}`}
            narration={narrationBlock?.narration}
            contentBase={contentBase}
            enabled={preference.enabled}
            onToggleEnabled={preference.toggle}
            togglePending={preference.pending}
            toggleError={preference.error}
            autoPlay={!showingFeedback && autoPlayFor === keyOf(displayedIndex)}
          />
        }
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((open) => !open)}
        onBack={goBack}
        onForward={goForward}
        canBack={displayedIndex > 0 && !showingFeedback && !submitting}
        canForward={reviewing && !showingFeedback}
        forwardHint={
          showingFeedback
            ? 'Użyj przycisku pod wynikiem.'
            : !reviewing
              ? 'Ukończ ten blok, aby przejść dalej.'
              : undefined
        }
      />
    </NotesProvider>
  );
}
