'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ClientNote,
  ClientProgressBlock,
  ContentBlock,
  CourseCompletionReward,
  CourseDetail,
  CourseProgressResponse,
  EvidenceSummary,
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
import ScoredBlock, { hasInlineResult, isScored } from './blocks/ScoredBlock';
import FeedbackPanel from './FeedbackPanel';
import SummaryScreen from './SummaryScreen';
import PlayerShell from './player/PlayerShell';
import NarrationPlayer from './player/NarrationPlayer';
import ReviewBlock from './player/ReviewBlock';
import { NotesPanel, NotesProvider, useNotes } from './player/notes';
import { EvidenceCounter, EvidenceProvider } from './player/evidence';
import { DEFAULT_IDLE, MascotReactionProvider, useMascotReaction } from './player/mascot-reaction';
import { useNarrationPreference } from './player/useNarrationPreference';

export interface CoursePlayerInitialState extends CourseDetail {
  // Wzbogacone server-side (page.tsx) o wynik z GET /courses/my, gdy user
  // wraca do kursu już ukończonego wcześniej - /start go nie zwraca.
  score: number | null;
}

type PlayerState = Pick<CoursePlayerInitialState, 'status' | 'currentBlockIndex' | 'score'>;

interface RenderContext {
  courseId: string;
  contentBase: string;
  onSubmit: (answer?: unknown) => void;
  disabled: boolean;
  /** Stan zadania tekstowego z serwera (próby, podpowiedzi) i zgłaszanie zmian do wyników sesji. */
  progress?: ClientProgressBlock;
  onProgress: (blockId: string, patch: Partial<ClientProgressBlock>) => void;
  /** Trwa podgląd wcześniejszego bloku: blok z kodem z zewnątrz (EMBEDDED_HTML) odmontowuje swój iframe zamiast go ukrywać. */
  suspended: boolean;
  /** Tylko bloki eksploracyjne: zgłasza gotowość do "Dalej" w pasku powłoki zamiast własnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
}

function renderBlock(block: ContentBlock, ctx: RenderContext) {
  const { onSubmit, disabled, contentBase } = ctx;
  if (isExploratory(block.type)) {
    // key: stan wewnętrzny (odwiedzone elementy) nie może przechodzić między kolejnymi blokami tego samego typu.
    return <ExploratoryBlock key={block.id} block={block} contentBase={contentBase} onSubmit={onSubmit} onReady={ctx.onReady} disabled={disabled} />;
  }
  if (isScored(block.type)) {
    return (
      <ScoredBlock
        key={block.id}
        block={block}
        courseId={ctx.courseId}
        onSubmit={onSubmit}
        disabled={disabled}
        progress={ctx.progress}
        onContinue={() => onSubmit()}
        onProgress={(patch) => ctx.onProgress(block.id ?? '', patch)}
      />
    );
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
      return <EmbeddedHtmlBlock block={block} courseId={ctx.courseId} onSubmit={() => onSubmit(undefined)} disabled={disabled} suspended={ctx.suspended} />;
    default:
      // Nieznany typ bloku (np. backend dodał nowy typ, front się jeszcze
      // nie zaktualizował) - jawny komunikat zamiast pustego <div>.
      return <p className="text-slate-500">Ten typ treści nie jest jeszcze obsługiwany.</p>;
  }
}

// Powłoka z licznikiem notatek (kontekst notatnika): osobny komponent, bo hook useNotes musi być pod NotesProvider.
const NOTES_ID = 'notes-panel';

function ShellWithNotes({
  idleMascot,
  ...props
}: Omit<React.ComponentProps<typeof PlayerShell>, 'notesCount' | 'notesPanel' | 'notesId' | 'mascot' | 'evidence'> & {
  /** Poza spoczynkowa maskotki bieżącego bloku (z treści albo domyślna dla typu); reakcja na zdarzenie (np. nowy dowód) ją chwilowo zastępuje. */
  idleMascot?: { pose: string; text?: string };
}) {
  const { notes } = useNotes();
  const { reaction } = useMascotReaction();
  const shown = reaction ?? idleMascot;
  return (
    <PlayerShell
      {...props}
      notesCount={notes.length}
      notesId={NOTES_ID}
      notesPanel={<NotesPanel id={NOTES_ID} />}
      mascot={shown ? <MascotSays pose={shown.pose} text={shown.text} /> : undefined}
      evidence={<EvidenceCounter />}
    />
  );
}

const blockIdOf = (blocks: ContentBlock[], index: number) => blocks[index]?.id ?? `b${index}`;

// Notatki dopisane przez serwer przy zapisie bloku (np. trafione kryteria maila) trafiają do notatnika od razu; dedup w addNote.
function ApplyServerNotes({ notes }: { notes: ClientNote[] }) {
  const { addNote } = useNotes();
  useEffect(() => {
    for (const note of notes) addNote(note);
  }, [notes, addNote]);
  return null;
}

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
  // Dowody śledztwa: liczby z serwera (start i każda odpowiedź /progress); dowody z niezapisanego bloku dolicza EvidenceProvider.
  const [evidence, setEvidence] = useState<EvidenceSummary | undefined>(initial.progress?.evidence);
  // Notatki dopisane przez serwer ostatnim zapisem (ApplyServerNotes przenosi je do notatnika).
  const [serverNotes, setServerNotes] = useState<ClientNote[]>([]);
  // Gotowość bieżącego bloku eksploracyjnego do "Dalej" w pasku powłoki (wymagane elementy pokryte) - funkcja, którą
  // "Dalej" wywoła zamiast osobnego "Kontynuuj" wewnątrz bloku (raport z pierwszego przejścia modułu 1). null = jeszcze
  // nie gotowy (albo bieżący blok w ogóle nie zgłasza gotowości - np. QUIZ, SUMMARY). Zerowane WPROST w handleAnswer
  // (nie osobnym useEffect na state.currentBlockIndex!): efekty dziecka (rejestracja gotowości NOWEGO bloku zaraz po
  // zamontowaniu, np. NARRATIVE/NOTEPAD - gotowe od razu) i efekt rodzica idący po tym samym zdarzeniu biegną w tym
  // samym commicie w kolejności dziecko-przed-rodzicem, więc reset w osobnym useEffect zawsze nadpisywałby świeżo
  // zarejestrowaną gotowość NOWEGO bloku z powrotem na null (znaleziono na żywym przebiegu, nie w testach jsdom -
  // te testowały blok i powłokę osobno, bez tego wyścigu).
  const [readySubmit, setReadySubmit] = useState<(() => void) | null>(null);
  const handleReady = (submit: (() => void) | null) => setReadySubmit(() => submit);
  const preference = useNarrationPreference(narrationEnabled);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  // Synchroniczna blokada podwójnego wysłania (stan `submitting` aktualizuje się asynchronicznie, więc dwa kliknięcia w tym samym ticku
  // by go ominęły): każdy blok oceniany korzysta z handleAnswer, więc wzorzec jest w powłoce.
  const submittingRef = useRef(false);

  const blocks = initial.contentBlocks;
  const displayedIndex = viewIndex ?? state.currentBlockIndex;
  // Nagłówki grup w notatniku i podsumowaniu sprawy: tytuł bloku (albo opis obrazu sceny, albo numer).
  const blockTitles = useMemo(
    () => Object.fromEntries(blocks.map((block, index) => [block.id ?? `b${index}`, block.title ?? block.imageAlt ?? `Blok ${index + 1}`])),
    [blocks],
  );

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
        courseId={courseId}
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
      // WPROST tutaj, nie w osobnym useEffect na state.currentBlockIndex (patrz komentarz przy readySubmit wyżej) -
      // gdy NOWY blok sam zgłosi gotowość w swoim efekcie montowania (onReady), zrobi to PO tym resecie w tym samym
      // commitcie, więc jego wynik się ostaje; gdy nie zgłosi (QUIZ, SUMMARY), zostaje poprawnie null.
      setReadySubmit(null);
      // Bloki eksploracyjne i TEXT_INPUT_GUIDED pokazują swój wynik/reakcję WEWNĄTRZ siebie, zanim ten zapis w ogóle
      // ruszy (mascot-reaction.tsx: useCompleteReaction; TextInputBlock: stan `done`) - osobny ekran "Blok ukończony."
      // z jeszcze jednym "Dalej" byłby powtórzeniem tego, co user już widział (raport z pierwszego przejścia modułu
      // 1). Dla nich ZOSTAJE feedback=null: state niżej sam przenosi na kolejny blok. SUMMARY WYŁĄCZONE mimo że
      // isExploratory() je obejmuje: to zawsze ostatni blok kursu, jego własny przycisk ("Zakończ sprawę"/"Zakończ
      // szkolenie") kończy kurs wprost - pośredni FeedbackPanel + "Zobacz podsumowanie" ma tu sens (inne niż w
      // trakcie kursu podsumowanie samego wyniku), więc zachowanie sprzed tego PR zostaje bez zmian.
      const skipsFeedbackScreen =
        (isExploratory(progress.lastResult.type) && progress.lastResult.type !== 'SUMMARY') ||
        progress.lastResult.type === 'TEXT_INPUT_GUIDED';
      if (skipsFeedbackScreen) {
        setFeedback(null);
        setAutoPlayFor(hasAudio(progress.lastResult.blockIndex) ? keyOf(progress.currentBlockIndex) : null);
      } else {
        setFeedback(progress.lastResult);
      }
      setResults((current) => {
        const blockId = progress.lastResult.blockId ?? blockIdOf(blocks, progress.lastResult.blockIndex);
        return {
          ...current,
          [blockId]: {
            // Zachowujemy to, co wiemy o bloku (np. próby i rozwiązanie zadania tekstowego zgłoszone przez blok).
            ...(current[blockId] ?? {}),
            type: progress.lastResult.type,
            done: true,
            ...(progress.lastResult.correct !== undefined ? { correct: progress.lastResult.correct } : {}),
            ...(progress.lastResult.points !== undefined ? { points: progress.lastResult.points } : {}),
            // Własny wybór gracza i rozstrzygnięcie: wynik zaraz po zapisie i podgląd "Wstecz" (id nieprzejrzyste, jak w /start).
            ...(answer !== undefined ? { answer: answer as ClientProgressBlock['answer'] } : {}),
            ...(progress.lastResult.detail ? { detail: progress.lastResult.detail } : {}),
            ...(progress.lastResult.reaction ? { reaction: progress.lastResult.reaction } : {}),
          },
        };
      });
      if (progress.notes && progress.notes.length > 0) setServerNotes(progress.notes);
      if (progress.evidence) setEvidence(progress.evidence);
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
    if (viewIndex === null) {
      // Nie podglądamy historii: "Dalej" tu znaczy "zgłoś gotowość bieżącego bloku eksploracyjnego" (patrz onReady) -
      // ten sam zapis, który wcześniej uruchamiał wewnętrzny przycisk "Kontynuuj" bloku.
      readySubmit?.();
      return;
    }
    const next = viewIndex + 1;
    setAutoPlayFor(hasAudio(viewIndex) ? keyOf(next) : null);
    setViewIndex(next >= state.currentBlockIndex ? null : next);
  }

  const reviewing = viewIndex !== null;
  const currentBlock = blocks[displayedIndex];
  const showingFeedback = feedback !== null;

  const continueLabel = state.status === 'COMPLETED' ? 'Zobacz podsumowanie' : 'Dalej';
  const onProgress = (blockId: string, patch: Partial<ClientProgressBlock>) =>
    setResults((current) => ({ ...current, [blockId]: { ...(current[blockId] ?? { type: patch.type ?? '', done: false }), ...patch } as ClientProgressBlock }));

  let stage: React.ReactNode;
  if (showingFeedback) {
    const answered = blocks[feedback.blockIndex];
    const answeredResult = results[feedback.blockId ?? blockIdOf(blocks, feedback.blockIndex)];
    // Mail i kolejność pokazują wynik w samym bloku (wybór gracza, trafienia, wyjaśnienia); reszta ogólny komunikat.
    stage =
      answered && hasInlineResult(answered.type) && feedback.detail ? (
        <ScoredBlock
          key={`result-${answered.id}`}
          block={answered}
          courseId={courseId}
          result={{ answer: answeredResult?.answer, detail: feedback.detail, correct: feedback.correct, points: feedback.points, reaction: feedback.reaction }}
          onContinue={continueAfterFeedback}
          continueLabel={continueLabel}
        />
      ) : (
        <FeedbackPanel feedback={feedback} onContinue={continueAfterFeedback} continueLabel={continueLabel} />
      );
  } else if (!currentBlock) {
    stage = <p className="text-slate-500">Nie znaleziono treści tego bloku.</p>;
  } else {
    // Bieżący blok z serwera zostaje ZAMONTOWANY (ukryty), gdy oglądamy podgląd wcześniejszego: jego stan (odwiedzone punkty, dodane do
    // notatnika dowody, rozmowa, zaznaczona opcja) przeżywa "Wstecz" i "Dalej", więc licznik dowodów i notatnik (stan ponad blokiem) nie
    // rozjeżdżają się ze stanem bloku. Ukryty blok jest poza drzewem dostępności i kolejnością Tab (atrybut hidden).
    const liveBlock = blocks[state.currentBlockIndex];
    stage = (
      <>
        {liveBlock && (
          <div key={keyOf(state.currentBlockIndex)} hidden={reviewing}>
            {renderBlock(liveBlock, {
              courseId,
              contentBase,
              onSubmit: handleAnswer,
              disabled: submitting,
              progress: results[keyOf(state.currentBlockIndex)],
              onProgress,
              suspended: reviewing,
              onReady: handleReady,
            })}
          </div>
        )}
        {reviewing && <ReviewBlock key={keyOf(displayedIndex)} block={currentBlock} result={results[keyOf(displayedIndex)]} contentBase={contentBase} courseId={courseId} />}
      </>
    );
  }

  const narrationBlock = showingFeedback ? blocks[feedback.blockIndex] : currentBlock;

  return (
    <NotesProvider initial={initial.progress?.notes ?? []} blockTitles={blockTitles}>
      <EvidenceProvider summary={evidence}>
        <MascotReactionProvider resetKey={`${displayedIndex}-${showingFeedback ? 'f' : 'b'}`}>
          <ApplyServerNotes notes={serverNotes} />
          <ShellWithNotes
            title={initial.title}
            blockNumber={Math.min(displayedIndex + 1, blocks.length)}
            totalBlocks={blocks.length}
            completedBlocks={state.currentBlockIndex}
            headingRef={headingRef}
            idleMascot={
              currentBlock && !showingFeedback
                ? currentBlock.mascot
                  ? { pose: currentBlock.mascot.pose, text: currentBlock.mascot.text }
                  : DEFAULT_IDLE[currentBlock.type]
                : undefined
            }
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
            // Na SUMMARY jedynym wyjściem jest "Zakończ sprawę" w bloku: "Dalej" z paska znika (jedno CTA zamiast dwóch).
            // TEXT_INPUT_GUIDED po rozstrzygnięciu (done) pokazuje własny, aktywny "Dalej" pod wynikiem (onReady go nie
            // dotyczy - patrz handleAnswer) - z tego samego powodu pasek chowa swój, zamiast trzymać drugi, nieaktywny
            // obok niego.
            hideForward={
              !showingFeedback &&
              !reviewing &&
              (currentBlock?.type === 'SUMMARY' ||
                (currentBlock?.type === 'TEXT_INPUT_GUIDED' && results[keyOf(displayedIndex)]?.done === true))
            }
            canForward={(reviewing || readySubmit !== null) && !showingFeedback && !submitting}
            forwardHint={
              showingFeedback
                ? 'Użyj przycisku pod wynikiem.'
                : !reviewing
                  ? 'Ukończ ten blok, aby przejść dalej.'
                  : undefined
            }
          />
        </MascotReactionProvider>
      </EvidenceProvider>
    </NotesProvider>
  );
}
