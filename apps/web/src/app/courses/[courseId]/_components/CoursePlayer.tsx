'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Narration } from '@cyberszkolo/content';
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
import { initialsFromEmail } from '@/lib/avatar';
import { useMyAvatar } from '@/lib/use-my-avatar';
import { playerIdentity, useMyDisplayName, type PlayerIdentity } from '@/lib/use-my-display-name';
import VideoBlock from './blocks/VideoBlock';
import QuizBlock from './blocks/QuizBlock';
import BranchingScenarioBlock from './blocks/BranchingScenarioBlock';
import DragAndDropBlock from './blocks/DragAndDropBlock';
import EmbeddedHtmlBlock from './blocks/EmbeddedHtmlBlock';
import ExploratoryBlock, { isExploratory } from './blocks/ExploratoryBlock';
import ScoredBlock, { hasInlineResult, isScored } from './blocks/ScoredBlock';
import FeedbackPanel from './FeedbackPanel';
import CaseClosedScreen from './CaseClosedScreen';
import PlayerStage from './player/PlayerStage';
import NarrationBar from './player/NarrationBar';
import TranscriptPanel from './player/TranscriptPanel';
import { useNarrationBar } from './player/useNarrationBar';
import ReviewBlock from './player/ReviewBlock';
import { NotesProvider, notebookTasks, useNotes, type NotebookTask } from './player/notes';
import { EvidenceCounter, EvidenceProvider, hasEvidence } from './player/evidence';
import { DEFAULT_HINT, HintProvider, useHints } from './player/hints';
import { useNarrationPreference } from './player/useNarrationPreference';
import { SfxProvider } from '@/lib/sfx';

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
  /** Zgłasza gotowość do "Dalej" w pasku powłoki - jedynego przejścia dalej (D-106); bloki nie mają własnych przycisków dalej. */
  onReady: (submit: (() => void) | null) => void;
  /** „Pomiń odprawę” (D-106): zmiana licznika = żywy BRIEFING przeskakuje na ostatni krok. */
  briefingSkip: number;
  myAvatarUrl?: string | null;
  myInitials?: string;
  /** BRIEFING (D-081): zadania pod kartą sprawy, tożsamość gracza (z sesji) i zmiana kroku odprawy. */
  tasks: NotebookTask[];
  identity: PlayerIdentity;
  onBriefingStep: (index: number, byGesture: boolean) => void;
  /** Numer sprawy z odprawy - tabliczka tablicy śledczej (ORDERING, D-088). */
  caseNo?: string;
  /** Bloki modułu (omówienie ANNOTATED_REPLAY czyta transkrypcję z bloku CALL_RECORDING, D-115). */
  blocks: ContentBlock[];
  /** Przesłuchanie (D-118): liczby dowodów z serwera po trafionym podważeniu (przed zapisem bloku). */
  onEvidence: (summary: EvidenceSummary) => void;
}

function renderBlock(block: ContentBlock, ctx: RenderContext) {
  const { onSubmit, disabled, contentBase } = ctx;
  if (isExploratory(block.type)) {
    // key: stan wewnętrzny (odwiedzone elementy) nie może przechodzić między kolejnymi blokami tego samego typu.
    return (
      <ExploratoryBlock
        key={block.id}
        block={block}
        contentBase={contentBase}
        onSubmit={onSubmit}
        onReady={ctx.onReady}
        disabled={disabled}
        myAvatarUrl={ctx.myAvatarUrl}
        myInitials={ctx.myInitials}
        tasks={ctx.tasks}
        identity={ctx.identity}
        onBriefingStep={ctx.onBriefingStep}
        briefingSkip={ctx.briefingSkip}
        moduleBlocks={ctx.blocks}
      />
    );
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
        onReady={ctx.onReady}
        onProgress={(patch) => ctx.onProgress(block.id ?? '', patch)}
        caseNo={ctx.caseNo}
        contentBase={contentBase}
        onEvidence={ctx.onEvidence}
        myAvatarUrl={ctx.myAvatarUrl}
        myInitials={ctx.myInitials}
      />
    );
  }
  // VIDEO, DRAG_AND_DROP, EMBEDDED_HTML: po akcji w bloku (obejrzenie, posegregowanie, „Ukończyłem”) blok zgłasza gotowość,
  // a zapis rusza „Dalej” w pasku (D-106).
  switch (block.type) {
    case 'VIDEO':
      return <VideoBlock key={block.id} block={block} onReady={(ready) => ctx.onReady(ready ? () => onSubmit(undefined) : null)} />;
    case 'QUIZ':
      return <QuizBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'BRANCHING_SCENARIO':
      return <BranchingScenarioBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    case 'DRAG_AND_DROP':
      return <DragAndDropBlock key={block.id} block={block} disabled={disabled} onReady={(ready) => ctx.onReady(ready ? () => onSubmit(undefined) : null)} />;
    case 'EMBEDDED_HTML':
      return (
        <EmbeddedHtmlBlock
          key={block.id}
          block={block}
          courseId={ctx.courseId}
          onReady={(ready) => ctx.onReady(ready ? () => onSubmit(undefined) : null)}
          disabled={disabled}
          suspended={ctx.suspended}
        />
      );
    default:
      // Nieznany typ bloku (np. backend dodał nowy typ, front się jeszcze
      // nie zaktualizował) - jawny komunikat zamiast pustego <div>.
      return <p className="text-slate-500">Ten typ treści nie jest jeszcze obsługiwany.</p>;
  }
}

const NOTES_ID = 'notes-panel';

// Woła hooki, które MUSZĄ być dziećmi NotesProvider/HintProvider (useNotes, useHints) - liczbę notatek i bieżącą podpowiedź
// PlayerStage dostaje jako zwykłe propsy, nie renderuje ich samo.
function StageWithContext({
  idleHint,
  showHint,
  ...props
}: Omit<React.ComponentProps<typeof PlayerStage>, 'notesCount' | 'hint'> & {
  /** Stała podpowiedź bieżącego bloku (z treści albo domyślna dla typu); podpowiedź zdarzenia (np. nowy dowód) ją chwilowo zastępuje. */
  idleHint?: string;
  /** false w trybie podsumowania - podpowiedź nie nakłada się na ekran zamknięcia sprawy. */
  showHint: boolean;
}) {
  const { notes } = useNotes();
  const { hint } = useHints();
  const shown = showHint ? (hint ?? idleHint) : undefined;
  return <PlayerStage {...props} notesCount={notes.length} hint={shown} />;
}

const blockIdOf = (blocks: ContentBlock[], index: number) => blocks[index]?.id ?? `b${index}`;


/** Czy blok ma jakiekolwiek nagranie - dla BRIEFING także w krokach (narracja odprawy jest per krok, D-081), dla omówienia - w znacznikach. */
const blockNarrations = (block: ContentBlock | undefined): (Narration | undefined)[] =>
  block
    ? [block.narration, ...(block.steps ?? []).map((step) => step.narration), ...(block.markers ?? []).map((marker) => marker.narration)]
    : [];

/** Bloki z narracją per krok w pasku powłoki: odprawa (kroki, D-081) i omówienie (znaczniki, D-115). */
const STEPPED_TYPES = new Set(['BRIEFING', 'ANNOTATED_REPLAY']);

/** Narracja kroku: krok odprawy albo znacznik omówienia (pierwszy znacznik bez własnej - narracja bloku, wprowadzenie). */
function stepNarration(block: ContentBlock | undefined, index: number): Narration | undefined {
  if (!block) return undefined;
  if (block.type === 'BRIEFING') return block.steps?.[index]?.narration;
  return block.markers?.[index]?.narration ?? (index === 0 ? block.narration : undefined);
}

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
  userEmail = null,
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
  userEmail?: string | null;
}) {
  const router = useRouter();
  const { avatarUrl: myAvatarUrl } = useMyAvatar(userEmail);
  const myInitials = userEmail ? initialsFromEmail(userEmail) : undefined;
  // Legitymacja w odprawie (BRIEFING, D-081): imię z profilu pobierane tylko, gdy moduł ma odprawę; fallback z e-maila.
  const hasBriefing = initial.contentBlocks.some((block) => block.type === 'BRIEFING');
  // Zamknięcie sprawy (SUMMARY.closing, D-089): raport z podpisem gracza - też potrzebuje imienia z profilu.
  const closingBlock = initial.contentBlocks.find((block) => block.type === 'SUMMARY' && block.closing);
  const displayName = useMyDisplayName(userEmail, hasBriefing || !!closingBlock);
  const identity = useMemo(() => playerIdentity(displayName, userEmail), [displayName, userEmail]);
  // Bieżący krok odprawy per zamontowana instancja bloku ("l-<id>" żywy, "r-<id>" podgląd "Wstecz") - narracja w pasku
  // powłoki idzie za krokiem; gesture = krok zmieniony kliknięciem gracza (wolno wtedy autoodtworzyć jego narrację).
  const [briefingSteps, setBriefingSteps] = useState<Record<string, { index: number; gesture: boolean }>>({});
  const trackBriefingStep = (instance: string) => (index: number, gesture: boolean) =>
    setBriefingSteps((current) => ({ ...current, [instance]: { index, gesture } }));
  // "Wstecz"/"Dalej" (przejście między podglądem a żywym blokiem) to nie gest na KROKU odprawy: bez tego po powrocie do żywej
  // odprawy na kroku >= 1 jej narracja ruszałaby od nowa sama, a wpis z poprzedniego podglądu ("r-") mógłby na jedną klatkę
  // podsunąć narrację starego kroku nowo zamontowanemu podglądowi (code review PR 1).
  const quietBriefingSteps = () =>
    setBriefingSteps((current) =>
      Object.fromEntries(
        Object.entries(current)
          .filter(([instance]) => instance.startsWith('l-'))
          .map(([instance, step]) => [instance, { ...step, gesture: false }]),
      ),
    );
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
  // wrócił do wcześniej ukończonego kursu (ekran zamknięcia bez ceremonii i bez XP).
  const [reward, setReward] = useState<CourseCompletionReward | null>(null);
  // Ukończenie w TEJ sesji (ceremonia ekranu zamknięcia sprawy, D-089) i moment ukończenia (czas śledztwa).
  const [completedNow, setCompletedNow] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(initial.completedAt ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Podgląd wcześniejszego bloku ("Wstecz"): tylko klient, bez skutku na serwerze; null = bieżący blok z serwera.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  // „Pomiń odprawę” (D-106): licznik kliknięć - żywy blok BRIEFING przeskakuje na ostatni krok przy każdej zmianie.
  const [briefingSkip, setBriefingSkip] = useState(0);
  // Klucz bloku, dla którego wolno rozpocząć narrację automatycznie (po geście "Dalej", gdy poprzedni blok miał nagranie).
  const [autoPlayFor, setAutoPlayFor] = useState<string | null>(null);
  // Wyniki bloków po id: początkowe z /start, uzupełniane po każdej odpowiedzi w tej sesji (dla podglądu "Wstecz").
  const [results, setResults] = useState<Record<string, ClientProgressBlock>>(initial.progress?.blocks ?? {});
  // Zadania sprawy (BRIEFING, krok caseFile, D-081) z treści TEJ wersji: jeden stan dla notatnika i karty sprawy w odprawie.
  const tasks = useMemo(() => notebookTasks(initial.contentBlocks, results), [initial.contentBlocks, results]);
  // Numer sprawy z karty sprawy w odprawie (tabliczka tablicy śledczej, D-088); moduł bez odprawy - brak numeru.
  const caseNo = useMemo(() => {
    for (const block of initial.contentBlocks) for (const step of block.steps ?? []) if (step.kind === 'caseFile') return step.caseNo;
    return undefined;
  }, [initial.contentBlocks]);
  // Dowody śledztwa: liczby z serwera (start i każda odpowiedź /progress); dowody z niezapisanego bloku dolicza EvidenceProvider.
  const [evidence, setEvidence] = useState<EvidenceSummary | undefined>(initial.progress?.evidence);
  // Notatki dopisane przez serwer ostatnim zapisem (ApplyServerNotes przenosi je do notatnika).
  const [serverNotes, setServerNotes] = useState<ClientNote[]>([]);
  // "Rozpocznij od nowa" na ekranie podsumowania (D-069, B-091) - przycisk jest teraz dolnym paskiem PlayerStage
  // (miejsce "Wstecz"), logika zostaje tu (feat/player-stage: przeniesiona z dawnego SummaryScreen.tsx).
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState(false);
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
  // Fokus po przejściu na ekran zamknięcia (CaseClosedScreen, D-089) ląduje na JEGO WŁASNYM, widocznym nagłówku "Sprawa zamknięta" (h2), nie na
  // sr-only nagłówku PlayerStage.tsx (ten drugi zostaje wyłącznie dla zmiany bloku - D-076, poprawka po code review:
  // wcześniejszy `headingOverride` dublował ten sam tekst w dwóch miejscach, jednym ukrytym).
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  // Dzielony z TranscriptPanel.tsx: fokus wraca na przycisk "Transkrypcja" (NarrationBar) po zamknięciu panelu.
  const transcriptButtonRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  // Synchroniczna blokada podwójnego wysłania (stan `submitting` aktualizuje się asynchronicznie, więc dwa kliknięcia w tym samym ticku
  // by go ominęły): każdy blok oceniany korzysta z handleAnswer, więc wzorzec jest w powłoce.
  const submittingRef = useRef(false);

  // Bloki z /start; blok wstrzymany przez API (omówienie nagrania, D-115) podmieniany pełną treścią z /progress (revealedBlock).
  const [blocks, setBlocks] = useState<ContentBlock[]>(initial.contentBlocks);
  const displayedIndex = viewIndex ?? state.currentBlockIndex;
  const isSummaryMode = state.status === 'COMPLETED' && !feedback;
  // Nagłówki grup w notatniku i podsumowaniu sprawy: tytuł bloku (albo opis obrazu sceny, albo numer).
  const blockTitles = useMemo(
    () => Object.fromEntries(blocks.map((block, index) => [block.id ?? `b${index}`, block.title ?? block.imageAlt ?? `Blok ${index + 1}`])),
    [blocks],
  );

  // Po zmianie bloku (albo przejściu na ekran zamknięcia) fokus na nagłówek nowej treści (czytniki ekranu i klawiatura
  // zaczynają od niej); nie przy pierwszym renderze. W trybie podsumowania cel to WIDOCZNY nagłówek CaseClosedScreen
  // (summaryHeadingRef; w ceremonii fokus przejmuje potem przycisk podpisu), poza nim - sr-only nagłówek PlayerStage.tsx (headingRef).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (isSummaryMode) {
      summaryHeadingRef.current?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [displayedIndex, feedback, isSummaryMode]);

  const hasAudio = (index: number) =>
    preference.enabled && blockNarrations(blocks[index]).some((narration) => contentAssetUrl(contentBase, narration?.audioUrl, 'audio') !== null);
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
      // Bloki eksploracyjne (SCENE_HOTSPOTS/DIALOGUE/NOTEPAD/TABS/NARRATIVE/SUMMARY/BRIEFING) i TEXT_INPUT_GUIDED pokazują swój
      // wynik/reakcję WEWNĄTRZ siebie, zanim ten zapis w ogóle ruszy (player/hints.tsx: useCompleteHint;
      // TextInputBlock: stan `done`) - osobny ekran "Blok ukończony." z jeszcze jednym "Dalej" byłby powtórzeniem
      // tego, co user już widział (raport z pierwszego przejścia modułu 1). Dla nich ZOSTAJE feedback=null: state
      // niżej sam przenosi na kolejny blok ALBO (gdy to była TA odpowiedź, co kończy kurs - `state.status` już
      // 'COMPLETED') na ekran zamknięcia wprost (isSummaryMode liczy się z samego `state.status` i `feedback`, niżej) -
      // BEZ pośredniego ekranu "Blok ukończony."/"Zobacz podsumowanie" (fix/course-finish-flow).
      //
      // Blok OCENIANY (QUIZ, EMAIL_ANALYSIS, ORDERING...), gdy TO ON kończy kurs: decyzja produktu D-076 (poprawka
      // po code review) - zostaje normalny ekran feedbacku z wyjaśnieniem odpowiedzi (bez niego user by je stracił -
      // ekran zamknięcia ma tylko zagregowany wynik procentowy). "Dalej" na tym ekranie (continueAfterFeedback czyści
      // `feedback`) samo przechodzi na ekran zamknięcia, bo `state.status` jest już 'COMPLETED' z TEGO zapisu -
      // isSummaryMode przejmuje bez dodatkowej logiki tutaj. Ekran zamknięcia nie ma podpowiedzi ani reakcji (D-089, D-093).
      const skipsFeedbackScreen = isExploratory(progress.lastResult.type) || progress.lastResult.type === 'TEXT_INPUT_GUIDED';
      if (skipsFeedbackScreen) {
        setFeedback(null);
        setAutoPlayFor(hasAudio(progress.lastResult.blockIndex) ? keyOf(progress.currentBlockIndex) : null);
      } else {
        setFeedback(progress.lastResult);
      }
      if (progress.status === 'COMPLETED') {
        setCompletedNow(true);
        setCompletedAt(progress.completedAt);
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
      const revealed = progress.revealedBlock;
      if (revealed && revealed.blockIndex >= 0 && revealed.blockIndex < blocks.length) {
        setBlocks((current) => current.map((block, index) => (index === revealed.blockIndex ? revealed.block : block)));
      }
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
    quietBriefingSteps();
    setViewIndex(displayedIndex - 1);
  }

  function goForward() {
    // Wynik bloku ocenianego (D-106): „Dalej” w pasku zamiast przycisku pod wynikiem.
    if (feedback) {
      continueAfterFeedback();
      return;
    }
    if (viewIndex === null) {
      // Nie podglądamy historii: "Dalej" tu znaczy "zgłoś gotowość bieżącego bloku eksploracyjnego" (patrz onReady) -
      // ten sam zapis, który wcześniej uruchamiał wewnętrzny przycisk "Kontynuuj" bloku.
      readySubmit?.();
      return;
    }
    const next = viewIndex + 1;
    quietBriefingSteps();
    setAutoPlayFor(hasAudio(viewIndex) ? keyOf(next) : null);
    setViewIndex(next >= state.currentBlockIndex ? null : next);
  }

  // "Rozpocznij od nowa" (D-069, B-091): archiwizuje to przypisanie i tworzy nowe (POST .../restart), potem
  // router.refresh() - strona jest już pod /courses/[courseId], więc to NIE nawigacja, tylko ponowne pobranie
  // danych servera (nowe /start w page.tsx). page.tsx nadaje <CoursePlayer key={assignmentId}>, więc zmiana
  // assignmentId po restarcie wymusza pełny remount i czysty stan klienta - stąd brak dodatkowej logiki resetu tutaj.
  async function restartCourse() {
    if (!window.confirm('Twój wynik zostanie zachowany w historii, kurs zacznie się od początku. Kontynuować?')) {
      return;
    }
    setRestarting(true);
    setRestartError(false);
    try {
      const response = await fetch(`/api/courses/${courseId}/restart`, { method: 'POST' });
      if (!response.ok) {
        setRestartError(true);
        setRestarting(false);
        return;
      }
      router.refresh();
    } catch {
      setRestartError(true);
      setRestarting(false);
    }
  }

  const reviewing = viewIndex !== null;
  const currentBlock = blocks[displayedIndex];
  const showingFeedback = feedback !== null;

  // SCENE_HOTSPOTS wypełnia całą dostępną przestrzeń ramki (object-contain); DIALOGUE, BRIEFING i DOSSIER też wypełniają (własny,
  // wewnętrzny scroll wątku/odprawy zamiast przewijania całego panelu - fix/dialogue-sticky-questions, D-081), ale to NIE jest
  // "scena" (stąd osobna wartość 'fill', ten sam CSS co 'scene' w PlayerStage.tsx); reszta bloków (i FeedbackPanel/
  // prosty ekran zamknięcia/wynik ScoredBlock) to wyśrodkowany panel jak slajd (PlayerStage.tsx, contentLayout).
  // Ekran zamknięcia sprawy z raportem (D-089) wypełnia ramkę jak scena; bez `closing` - panel jak slajd.
  // ORDERING (tablica śledcza, D-088) też 'fill' - także jej wynik zaraz po zapisie (wynik jest na tej samej tablicy); w 'fill'
  // PlayerStage nie dokłada paska podpowiedzi, zdanie informacji zwrotnej jest pod tablicą.
  // Odsłuch nagrania (D-115) pokazuje wynik na tej samej transkrypcji - też 'fill', jak tablica.
  const boardFeedback =
    showingFeedback && (blocks[feedback.blockIndex]?.type === 'ORDERING' || blocks[feedback.blockIndex]?.type === 'CALL_RECORDING') && !!feedback.detail;
  const contentLayout: 'scene' | 'slide' | 'fill' =
    isSummaryMode && closingBlock
      ? 'fill'
      : isSummaryMode || (showingFeedback && !boardFeedback)
      ? 'slide'
      : boardFeedback
        ? 'fill'
        : currentBlock?.type === 'SCENE_HOTSPOTS'
          ? 'scene'
          : currentBlock?.type === 'DIALOGUE' ||
              currentBlock?.type === 'BRIEFING' ||
              currentBlock?.type === 'DOSSIER' ||
              currentBlock?.type === 'ORDERING' ||
              currentBlock?.type === 'CALL_RECORDING' ||
              currentBlock?.type === 'ANNOTATED_REPLAY' ||
              // Przesłuchanie (D-118): wątek jak rozmowa (własne przewijanie wątku, stopka z pytaniami) - 'fill'.
              currentBlock?.type === 'INTERROGATION'
            ? 'fill'
            : 'slide';
  const onProgress = (blockId: string, patch: Partial<ClientProgressBlock>) =>
    setResults((current) => ({ ...current, [blockId]: { ...(current[blockId] ?? { type: patch.type ?? '', done: false }), ...patch } as ClientProgressBlock }));

  let stage: React.ReactNode;
  if (isSummaryMode) {
    stage = (
      <CaseClosedScreen
        title={initial.title}
        score={state.score}
        scoreUnavailable={scoreUnavailable}
        reward={reward}
        restartError={restartError}
        headingRef={summaryHeadingRef}
        closing={closingBlock?.closing}
        lessons={closingBlock?.lessons}
        evidence={evidence}
        startedAt={initial.startedAt}
        completedAt={completedAt}
        signer={identity.label}
        contentBase={contentBase}
        fresh={completedNow}
      />
    );
  } else if (showingFeedback) {
    const answered = blocks[feedback.blockIndex];
    const answeredResult = results[feedback.blockId ?? blockIdOf(blocks, feedback.blockIndex)];
    // Mail i kolejność pokazują wynik w samym bloku (wybór gracza, trafienia, wyjaśnienia); reszta ogólny komunikat.
    // Dalej jest WYŁĄCZNIE w dolnym pasku (D-106, goForward -> continueAfterFeedback): gdy TA odpowiedź kończy kurs (blok oceniany
    // jako ostatni, D-076), state.status jest już 'COMPLETED', więc „Dalej” samo przechodzi na ekran zamknięcia.
    stage =
      answered && hasInlineResult(answered.type) && feedback.detail ? (
        <ScoredBlock
          key={`result-${answered.id}`}
          block={answered}
          courseId={courseId}
          result={{
            answer: answeredResult?.answer,
            detail: feedback.detail,
            correct: feedback.correct,
            points: feedback.points,
            reaction: feedback.reaction,
            challenges: answeredResult?.challenges,
          }}
          live
          caseNo={caseNo}
          contentBase={contentBase}
        />
      ) : (
        <FeedbackPanel feedback={feedback} />
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
          // Łańcuch wysokości dla contentLayout='scene'/'fill' (hotfix fix/player-scene-fit/B-100, druga runda code
          // review; 'fill'/DIALOGUE dołączone w fix/dialogue-sticky-questions, ten sam powód): ten div siedzi
          // MIĘDZY PlayerStage.tsx (flex-col wrapper) a SceneHotspotsBlock.tsx/DialogueBlock.tsx (flex-1 min-h-0
          // na WŁASNYM korzeniu obu) - bez własnych flex-1/min-h-0/w-full byłby zwykłym blokowym divem,
          // przerywającym łańcuch: blok dostawałby wysokość auto zamiast realnej wysokości obszaru bloku, a
          // z [container-type:size] (size containment, SceneHotspotsBlock.tsx) zapadałby się do WYSOKOŚCI 0 zamiast
          // (jak przed tym hotfixem) rosnąć ponad dostępne miejsce. className TYLKO gdy !reviewing (nie tylko
          // warunek contentLayout==='scene'/'fill'): Tailwind [hidden]{display:none} z preflightu i .flex z warstwy
          // utilities mają RÓWNĄ specyficzność, a utilities ładują się PO base w wygenerowanym CSS - .flex by
          // WYGRAŁ z [hidden] i ukryty (podczas Wstecz) blok zostałby widoczny, gdyby klasa flex była tu bezwarunkowa.
          <div
            key={keyOf(state.currentBlockIndex)}
            hidden={reviewing}
            className={!reviewing && (contentLayout === 'scene' || contentLayout === 'fill') ? 'flex min-h-0 w-full flex-1 flex-col' : undefined}
          >
            {renderBlock(liveBlock, {
              courseId,
              contentBase,
              onSubmit: handleAnswer,
              disabled: submitting,
              progress: results[keyOf(state.currentBlockIndex)],
              onProgress,
              suspended: reviewing,
              onReady: handleReady,
              briefingSkip,
              myAvatarUrl,
              myInitials,
              tasks,
              identity,
              onBriefingStep: trackBriefingStep(`l-${keyOf(state.currentBlockIndex)}`),
              caseNo,
              blocks,
              onEvidence: setEvidence,
            })}
          </div>
        )}
        {reviewing && (
          <ReviewBlock
            key={keyOf(displayedIndex)}
            block={currentBlock}
            result={results[keyOf(displayedIndex)]}
            contentBase={contentBase}
            courseId={courseId}
            myAvatarUrl={myAvatarUrl}
            myInitials={myInitials}
            tasks={tasks}
            identity={identity}
            onBriefingStep={trackBriefingStep(`r-${keyOf(displayedIndex)}`)}
            caseNo={caseNo}
            moduleBlocks={blocks}
          />
        )}
      </>
    );
  }

  // Narracja: bloku podsumowania (tryb summary), bloku z wyniku (feedback) albo bieżącego/podglądanego bloku - JEDNO
  // wywołanie hooka niezależnie od trybu (zasady hooków), NarrationBar/TranscriptPanel same nic nie pokazują bez
  // narration.
  const summaryBlock = useMemo(() => blocks.find((block) => block.type === 'SUMMARY'), [blocks]);
  const narrationBlock = isSummaryMode ? summaryBlock : showingFeedback ? blocks[feedback.blockIndex] : currentBlock;
  // BRIEFING (D-081): narracja BIEŻĄCEGO KROKU odprawy (steps[].narration), nie bloku - pasek, napisy i transkrypcja idą za
  // krokiem. Krok >= 1 odtwarza się sam wyłącznie wtedy, gdy gracz przeszedł na niego przyciskiem kroku (gest w tej samej
  // instancji bloku); powrót z podglądu "Wstecz"/"Dalej" gest zeruje (quietBriefingSteps). Krok 0 jak każdy blok (autoPlayFor).
  // Omówienie (ANNOTATED_REPLAY, D-115) - ten sam mechanizm dla znaczników: narracja bieżącego znacznika, kolejne tylko po geście.
  const briefingStep =
    !isSummaryMode && !showingFeedback && currentBlock && STEPPED_TYPES.has(currentBlock.type)
      ? (briefingSteps[`${reviewing ? 'r' : 'l'}-${keyOf(displayedIndex)}`] ?? { index: 0, gesture: false })
      : null;
  const narration = briefingStep ? stepNarration(currentBlock, briefingStep.index) : narrationBlock?.narration;
  const narrationBarState = useNarrationBar({
    narration,
    contentBase,
    enabled: preference.enabled,
    autoPlay:
      !isSummaryMode &&
      !showingFeedback &&
      (briefingStep && briefingStep.index > 0 ? briefingStep.gesture : autoPlayFor === keyOf(displayedIndex)),
    resetKey: isSummaryMode
      ? 'summary'
      : `${keyOf(showingFeedback ? feedback.blockIndex : displayedIndex)}-${showingFeedback ? 'w' : 'b'}${briefingStep ? `-s${briefingStep.index}` : ''}`,
  });

  // "Pomiń odprawę" (D-081, D-106): przeskakuje na ostatni krok odprawy (ekran startu) - odprawa jest wtedy gotowa, a dalej prowadzi
  // wyłącznie „Dalej” w dolnym pasku (jeden przycisk dalej). Tylko na żywym bloku i przed ostatnim krokiem; w podglądzie „Wstecz”
  // „Dalej” w pasku jest i tak aktywny.
  const briefingLast = (currentBlock?.steps?.length ?? 1) - 1;
  const skipBriefing =
    briefingStep !== null && currentBlock?.type === 'BRIEFING' && !reviewing && briefingStep.index < briefingLast ? (
      <button
        type="button"
        onClick={() => setBriefingSkip((count) => count + 1)}
        disabled={submitting}
        className="inline-flex h-10 shrink-0 items-center rounded border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 sm:px-3"
      >
        Pomiń odprawę
      </button>
    ) : undefined;

  // Ogłoszenie aria-live (PlayerStage.tsx, region persystentny przez cały kurs - D-076) wypełnione WYŁĄCZNIE w
  // trybie podsumowania ze świeżym `reward` z TEJ sesji (patrz komentarz przy `reward` wyżej) - puste poza tym, w
  // tym gdy user wraca do już dawno ukończonego kursu (reward null, raport pokazuje wtedy XP jako "—").
  const resultAnnouncement =
    isSummaryMode && reward
      ? reward.xpGained > 0
        ? `Kurs ukończony. Zdobyto ${reward.xpGained} punktów doświadczenia.`
        : 'Kurs ukończony ponownie. Punkty doświadczenia naliczone przy pierwszym ukończeniu.'
      : '';

  return (
    // Dźwięki interfejsu (czat, zamknięcie sprawy) grają tylko przy włączonym Lektorze - jedno ustawienie dźwięku gracza (D-087/D-089).
    <SfxProvider enabled={preference.enabled}>
    <NotesProvider initial={initial.progress?.notes ?? []} initialDistinctions={initial.progress?.distinctions} blockTitles={blockTitles} tasks={tasks}>
      <EvidenceProvider summary={evidence}>
        <HintProvider resetKey={`${isSummaryMode ? 'summary' : displayedIndex}-${showingFeedback ? 'f' : 'b'}`}>
          <ApplyServerNotes notes={serverNotes} />
          <StageWithContext
            title={initial.title}
            blockNumber={isSummaryMode ? blocks.length : Math.min(displayedIndex + 1, blocks.length)}
            totalBlocks={blocks.length}
            completedBlocks={isSummaryMode ? blocks.length : state.currentBlockIndex}
            headingRef={headingRef}
            resultAnnouncement={resultAnnouncement}
            showHint={!isSummaryMode}
            evidence={<EvidenceCounter />}
            topAction={skipBriefing}
            // Stała podpowiedź: `tip` (D-096), dla starszych wersji treści `mascot.text` (poza ignorowana, D-093); bez niej - domyślna dla typu.
            idleHint={
              currentBlock && !showingFeedback && !isSummaryMode
                ? (currentBlock.tip ?? currentBlock.mascot?.text ?? DEFAULT_HINT[currentBlock.type])
                : undefined
            }
            contentLayout={contentLayout}
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
            narrationBar={
              <NarrationBar
                narration={narration}
                state={narrationBarState}
                enabled={preference.enabled}
                onToggleEnabled={preference.toggle}
                togglePending={preference.pending}
                toggleError={preference.error}
                transcriptButtonRef={transcriptButtonRef}
              />
            }
            transcriptPanel={
              <TranscriptPanel
                text={narration?.text ?? ''}
                open={narrationBarState.transcriptOpen}
                onClose={narrationBarState.toggleTranscript}
                triggerRef={transcriptButtonRef}
              />
            }
            notesOpen={notesOpen}
            onToggleNotes={() => setNotesOpen((open) => !open)}
            notesId={NOTES_ID}
            onBack={isSummaryMode ? restartCourse : goBack}
            onForward={isSummaryMode ? undefined : goForward}
            canBack={isSummaryMode ? !restarting : displayedIndex > 0 && !showingFeedback && !submitting}
            // Jeden „Dalej” (D-106): pasek jest JEDYNYM przejściem dalej w całym odtwarzaczu - bloki nie mają własnych przycisków
            // dalej, tylko zgłaszają gotowość (onReady) po akcji w bloku (sprawdzenie, obejrzenie, podejście do drzwi, ostatni krok
            // odprawy); wynik bloku ocenianego (feedback) - „Dalej” od razu aktywny.
            canForward={(reviewing || showingFeedback || readySubmit !== null) && !submitting}
            // Puls i ogłoszenie „możesz przejść dalej” tylko przy gotowości i wyniku - nie w podglądzie „Wstecz” (B-126).
            announceForward={!reviewing}
            backLabel={isSummaryMode ? (restarting ? 'Uruchamianie od nowa…' : 'Rozpocznij od nowa') : undefined}
            // Etykieta zmienia się tylko tam, gdzie „Dalej” kończy sprawę (SUMMARY) albo jest wyjściem z modułu (ekran zamknięcia -
            // prawdziwy link do biblioteki; pod raportem zostaje tylko „Następna sprawa”).
            forwardLabel={
              isSummaryMode
                ? 'Wróć do biblioteki'
                : !showingFeedback && !reviewing && currentBlock?.type === 'SUMMARY'
                  ? hasEvidence(evidence)
                    ? 'Zakończ sprawę'
                    : 'Zakończ szkolenie'
                  : undefined
            }
            forwardHref={isSummaryMode ? '/courses' : undefined}
            // Scena z drzwiami (D-106): wyjściem jest podejście do drzwi - podpowiedź mówi to wprost (samo „Ukończ blok” myliło, gdy
            // wymagane przedmioty były już obejrzane).
            forwardHint={
              showingFeedback || reviewing || isSummaryMode
                ? undefined
                : currentBlock?.type === 'SCENE_HOTSPOTS' && currentBlock.hotspots?.some((hotspot) => hotspot.action === 'next')
                  ? 'Zbadaj scenę i podejdź do drzwi, aby przejść dalej.'
                  : 'Ukończ ten blok, aby przejść dalej.'
            }
          />
        </HintProvider>
      </EvidenceProvider>
    </NotesProvider>
    </SfxProvider>
  );
}
