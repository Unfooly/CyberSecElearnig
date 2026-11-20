'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BarActionProvider, type BarAction } from './player/bar-action';
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
  SceneExploration,
} from '@/lib/courses-types';
import { LOCAL_CONTENT_BASE, contentAssetUrl } from '@/lib/content-assets';
import { initialsFromEmail } from '@/lib/avatar';
import { useMyAvatar } from '@/lib/use-my-avatar';
import { playerIdentity, reportSigner, useMyDisplayName, type PlayerIdentity } from '@/lib/use-my-display-name';
import VideoBlock from './blocks/VideoBlock';
import QuizBlock from './blocks/QuizBlock';
import SimpleChoiceBlock from './blocks/SimpleChoiceBlock';
import SimpleMultiChoiceBlock from './blocks/SimpleMultiChoiceBlock';
import SwipeSortBlock from './blocks/SwipeSortBlock';
import BranchingScenarioBlock from './blocks/BranchingScenarioBlock';
import DragAndDropBlock from './blocks/DragAndDropBlock';
import EmbeddedHtmlBlock from './blocks/EmbeddedHtmlBlock';
import ExploratoryBlock, { isExploratory } from './blocks/ExploratoryBlock';
import ScoredBlock, { BOARD_TYPES, hasInlineResult, isScored } from './blocks/ScoredBlock';
import FeedbackPanel from './FeedbackPanel';
import CaseClosedScreen from './CaseClosedScreen';
import ModuleStartScreen from './ModuleStartScreen';
import ModuleEndScreen from './ModuleEndScreen';
import { summaryRules } from './simple-markdown';
import PlayerStage from './player/PlayerStage';
import NarrationBar from './player/NarrationBar';
import { NarrationPauseProvider } from './player/narration-pause';
import { useNarrationBar } from './player/useNarrationBar';
import ReviewBlock from './player/ReviewBlock';
import { NotesProvider, notebookTasks, useNotes, type NotebookTask } from './player/notes';
import { EvidenceProvider, hasEvidence } from './player/evidence';
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
  /** Ustawienie konta „Bez limitów czasu” (D-124) - rozmowa na żywo bez limitu i bez przełącznika. */
  noTimeLimits: boolean;
  /** Ostatni zapis bieżącego bloku się nie udał (B-137): rozmowa na żywo pokazuje „Zadzwoń ponownie”. */
  submitFailed: boolean;
  /** Blok zaczyna od nowa po nieudanym zapisie (B-137, „Zadzwoń ponownie”) - komunikat o błędzie znika. */
  onRetry: () => void;
  /** Tryb prosty (D-132): wybór (QUIZ) oceniany przy każdym kliknięciu (/check). */
  simpleMode: boolean;
  /** Scena (D-128): zapis stanu częściowego (obejrzane, zabrane) - po powrocie do modułu scena wraca w tym samym stanie. */
  onExplore: (blockId: string, state: SceneExploration) => void;
  /** Blok pojawił się po geście gracza (Start na ekranie startu, „Dalej”) - film (VIDEO) startuje od razu. */
  autoPlay?: boolean;
}

/** Etykieta „Dalej” ostatniego kroku odprawy (D-160) albo undefined (zwykłe „Dalej”). */
function briefingNextLabel(block: ContentBlock): string | undefined {
  const last = block.steps?.[block.steps.length - 1];
  return last?.kind === 'typewriter' ? last.nextLabel : undefined;
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
        moduleBlocks={ctx.blocks}
        exploration={ctx.progress?.exploration}
        onExplore={block.id ? (state) => ctx.onExplore(block.id ?? '', state) : undefined}
        simpleMode={ctx.simpleMode}
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
        noTimeLimits={ctx.noTimeLimits}
        submitFailed={ctx.submitFailed}
        onRetry={ctx.onRetry}
      />
    );
  }
  // VIDEO, DRAG_AND_DROP, EMBEDDED_HTML: po akcji w bloku (obejrzenie, posegregowanie, „Ukończyłem”) blok zgłasza gotowość,
  // a zapis rusza „Dalej” w pasku (D-106).
  switch (block.type) {
    case 'VIDEO':
      return (
        <VideoBlock
          key={block.id}
          block={block}
          contentBase={contentBase}
          autoPlay={ctx.autoPlay}
          suspended={ctx.suspended}
          onReady={(ready) => ctx.onReady(ready ? () => onSubmit(undefined) : null)}
        />
      );
    case 'QUIZ': {
      // „Pytanie N z M” nad pytaniem na ekranie monitora (D-164): numer wśród pytań QUIZ modułu.
      const quizzes = (ctx.blocks ?? []).filter((item) => item.type === 'QUIZ');
      const position = quizzes.findIndex((item) => item.id === block.id);
      const questionLabel = position >= 0 ? `Pytanie ${position + 1} z ${quizzes.length}` : undefined;
      if (ctx.simpleMode && block.multiple === true) {
        // Wielokrotny wybór (D-158): zbiór przez /check, zapis po trafieniu bez odpowiedzi (wynik z prób w postępie).
        return (
          <SimpleMultiChoiceBlock
            key={block.id}
            block={block}
            courseId={ctx.courseId}
            progress={ctx.progress}
            onSubmit={() => onSubmit(undefined)}
            onReady={ctx.onReady}
            onProgress={(patch) => ctx.onProgress(block.id ?? '', { type: block.type, ...patch })}
            disabled={disabled}
            questionLabel={questionLabel}
          />
        );
      }
      if (ctx.simpleMode) {
        return (
          <SimpleChoiceBlock
            key={block.id}
            block={block}
            courseId={ctx.courseId}
            progress={ctx.progress}
            onSubmit={onSubmit}
            onReady={ctx.onReady}
            onProgress={(patch) => ctx.onProgress(block.id ?? '', { type: block.type, ...patch })}
            disabled={disabled}
            questionLabel={questionLabel}
          />
        );
      }
      return <QuizBlock block={block} onSubmit={onSubmit} disabled={disabled} />;
    }
    case 'SWIPE_SORT':
      // D-132: każda karta przez /check; „Dalej” po ocenie wszystkich - zapis bez odpowiedzi (werdykty są już w postępie).
      return (
        <SwipeSortBlock
          key={block.id}
          block={block}
          courseId={ctx.courseId}
          progress={ctx.progress}
          onSubmit={() => onSubmit(undefined)}
          onReady={ctx.onReady}
          onProgress={(patch) => ctx.onProgress(block.id ?? '', { type: block.type, ...patch })}
          disabled={disabled}
        />
      );
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

// Ile najwyżej „Dalej” czeka na trwający zapis stanu częściowego sceny (D-128), zanim wyśle zapis bloku.
/** Podgląd „Wstecz” nie rejestruje akcji paska (D-187). */
const ignoreBarAction = () => {};

const EXPLORE_WAIT_MS = 4000;
// Najdłuższe czekanie X na zapisy w toku (D-142) - potem wyjście i tak następuje. Obejmuje też czekanie samego „Dalej” na zapis stanu
// sceny (do EXPLORE_WAIT_MS), więc w najgorszym razie na /progress zostaje ~1 s: celem jest „wyjście nigdy nie wisi”, nie pewność zapisu.
const EXIT_SAVE_WAIT_MS = 5000;
// „Wstecz”/„Dalej” przeglądarki (D-142): Next 14 przywraca wtedy odtwarzacz z drzewa w pamięci routera (props z pierwszego wejścia,
// także przy staleTimes.dynamic = 0). Flaga ustawiana przez popstate i zużywana przez pierwszy montaż odtwarzacza - ten pobiera świeży
// postęp (router.refresh). Flaga, nie okno czasowe: montaż ciężkiego bloku na słabym telefonie bywa dłuższy niż sekunda (code review).
// Fałszywe trafienie (np. „Wstecz” na liście, potem „Kontynuuj naukę”) kosztuje jedno zbędne odświeżenie bez przemontowania (postęp,
// czyli klucz, się nie zmienia). Powrót z bfcache (inna witryna, `pageshow`) nie jest objęty - zostaje stan na żywo.
let restoredFromHistory = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => (restoredFromHistory = true));

// Woła hook, który MUSI być dzieckiem HintProvider (useHints) - bieżącą podpowiedź PlayerStage dostaje jako zwykły prop.
function StageWithContext({
  idleHint,
  showHint,
  ...props
}: Omit<React.ComponentProps<typeof PlayerStage>, 'hint'> & {
  /** Stała podpowiedź bieżącego bloku (z treści albo domyślna dla typu); podpowiedź zdarzenia (np. nowy dowód) ją chwilowo zastępuje. */
  idleHint?: string;
  /** false w trybie podsumowania - podpowiedź nie nakłada się na ekran zamknięcia sprawy. */
  showHint: boolean;
}) {
  const { hint } = useHints();
  const shown = showHint ? (hint ?? idleHint) : undefined;
  return <PlayerStage {...props} hint={shown} />;
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

/**
 * Narracja kroku odprawy jest dosłownie na ekranie (maszyna do pisania, dymek rozmowy) - wtedy pasek nie dubluje jej tekstem zastępczym
 * przy wyciszonym lektorze (D-162; dubel zabierałby scenie wysokość na telefonie). Krok z narracją, której nie widać (np. teczka,
 * legitymacja) - tekst w pasku zostaje.
 */
function briefingNarrationOnScreen(block: ContentBlock | undefined, index: number): boolean {
  if (block?.type !== 'BRIEFING') return false;
  const step = block.steps?.[index] as { text?: string; narration?: Narration } | undefined;
  const spoken = step?.narration?.text;
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim();
  return typeof spoken === 'string' && typeof step?.text === 'string' && norm(step.text).includes(norm(spoken));
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
  noTimeLimits = false,
  contentBase = LOCAL_CONTENT_BASE,
  userEmail = null,
  nextCourse = null,
  persistExploration = true,
  previewReward = null,
  showStartScreen = true,
}: {
  // Zapis stanu częściowego sceny (D-128); strona deweloperska (player-harness) nie ma backendu, więc go wyłącza.
  persistExploration?: boolean;
  /** Tylko podgląd (player-harness `?backdrop=1`): dane modułu (tło, D-178) bez ekranu startu przed blokiem. Produkcja - zawsze true. */
  showStartScreen?: boolean;
  /** Tylko podgląd (player-harness `?reward=1`): nagroda jak po świeżym ukończeniu - karta poziomu na ekranie końca (D-165). Produkcja
      dostaje nagrodę wyłącznie z odpowiedzi /progress. */
  previewReward?: CourseCompletionReward | null;
  courseId: string;
  initial: CoursePlayerInitialState;
  // true tylko, gdy user wrócił do JUŻ ukończonego kursu, a pobranie
  // wyniku z GET /courses/my (page.tsx) się nie powiodło - odróżnia to od
  // "kurs naprawdę nie miał ocenianych bloków" (score === null poprawnie).
  scoreUnavailable?: boolean;
  // Ustawienie konta (users.narrationEnabled), czytane server-side w page.tsx.
  narrationEnabled?: boolean;
  // Ustawienie konta „Bez limitów czasu” (users.noTimeLimits, D-124), czytane server-side w page.tsx.
  noTimeLimits?: boolean;
  // Baza adresów zasobów (CONTENT_BASE_URL albo /content lokalnie), z page.tsx.
  contentBase?: string;
  userEmail?: string | null;
  /** Następny nieukończony przypisany kurs (page.tsx, D-130) - „Następna sprawa” na ekranie zamknięcia; null - „wkrótce”. */
  nextCourse?: { courseId: string; title: string } | null;
}) {
  const router = useRouter();
  // Odtwarzacz przywrócony z historii (D-142): świeży postęp z serwera; zmieniony postęp zmienia klucz w page.tsx i przemontowuje odtwarzacz.
  useEffect(() => {
    if (restoredFromHistory) {
      restoredFromHistory = false;
      router.refresh();
    }
    // Jednorazowo przy montowaniu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tryb prosty wersji treści (D-132) - z /start; starsze odpowiedzi bez pola = zwykły odtwarzacz.
  const simpleMode = initial.simpleMode === true;
  const { avatarUrl: myAvatarUrl } = useMyAvatar(userEmail);
  const myInitials = userEmail ? initialsFromEmail(userEmail) : undefined;
  // Legitymacja w odprawie (BRIEFING, D-081): imię z profilu pobierane tylko, gdy moduł ma odprawę; fallback z e-maila.
  const hasBriefing = initial.contentBlocks.some((block) => block.type === 'BRIEFING');
  // Zamknięcie sprawy (SUMMARY.closing, D-089): raport z podpisem gracza - też potrzebuje imienia z profilu.
  const closingBlock = initial.contentBlocks.find((block) => block.type === 'SUMMARY' && block.closing);
  const displayName = useMyDisplayName(userEmail, hasBriefing || !!closingBlock);
  const identity = useMemo(() => playerIdentity(displayName, userEmail), [displayName, userEmail]);
  // Podpis raportu (poprawki m3): „Imię I.”, a bez imienia w profilu część e-maila przed @, ostatecznie „Pracownik”.
  const signer = useMemo(() => reportSigner(displayName, userEmail), [displayName, userEmail]);
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
  const [reward, setReward] = useState<CourseCompletionReward | null>(previewReward);
  // Ukończenie w TEJ sesji (ceremonia ekranu zamknięcia sprawy, D-089) i moment ukończenia (czas śledztwa).
  const [completedNow, setCompletedNow] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(initial.completedAt ?? null);
  const [submitting, setSubmitting] = useState(false);
  // X czeka na zapis w toku (D-142) - aria-busy na X, żeby czekanie nie wyglądało na martwy przycisk.
  const [exitPending, setExitPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Podgląd wcześniejszego bloku ("Wstecz"): tylko klient, bez skutku na serwerze; null = bieżący blok z serwera.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
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
  // Akcja bloku w miejscu „Dalej” (D-187, player/bar-action.tsx): „Sprawdź”, „Wybierz odpowiedź”… - przed odpowiedzią na blok oceniany.
  const [barAction, setBarAction] = useState<BarAction | null>(null);
  const handleBarAction = useCallback((action: BarAction | null) => setBarAction(action), []);
  const preference = useNarrationPreference(narrationEnabled);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Fokus po przejściu na ekran zamknięcia (CaseClosedScreen, D-089) ląduje na JEGO WŁASNYM, widocznym nagłówku "Sprawa zamknięta" (h2), nie na
  // sr-only nagłówku PlayerStage.tsx (ten drugi zostaje wyłącznie dla zmiany bloku - D-076, poprawka po code review:
  // wcześniejszy `headingOverride` dublował ten sam tekst w dwóch miejscach, jednym ukrytym).
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
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

  // Ekran startu modułu (szablon, D-163): kurs jeszcze na pierwszym bloku, z danymi modułu z API (odpowiedź bez `moduleInfo` - starsze API,
  // testy - prosto do bloku). Każde wejście na blok 0 (także po odświeżeniu) zaczyna od niego; „Start” to gest, więc lektor pierwszego bloku
  // gra od razu (autoPlayFor), a fokus idzie na nagłówek bloku, jak przy każdej zmianie bloku.
  const [showStart, setShowStart] = useState(
    () => showStartScreen && Boolean(initial.moduleInfo) && initial.status !== 'COMPLETED' && initial.currentBlockIndex === 0,
  );
  const startDismissed = useRef(false);
  const startModule = () => {
    startDismissed.current = true;
    setAutoPlayFor(keyOf(0));
    setShowStart(false);
  };
  useEffect(() => {
    if (!showStart && startDismissed.current) headingRef.current?.focus();
  }, [showStart]);

  // Stan częściowy sceny (D-128): zapis w tle, po kolei (jedno żądanie naraz, w kolejce tylko NAJNOWSZY stan - każde żądanie niesie
  // pełny stan, a serwer i tak scala go z zapisanym). Błędy pomijamy: to tylko wygoda powrotu, pełny stan niesie i tak zapis bloku
  // (/progress). Licznika dowodów nie ruszamy (dowody niezapisanego bloku dolicza EvidenceProvider). `keepalive`: żądanie dochodzi
  // także wtedy, gdy gracz zaraz po kliknięciu opuszcza stronę.
  const exploreQueue = useRef<{
    inFlight: Promise<void> | null;
    next: { blockId: string; state: SceneExploration } | null;
    abort: AbortController | null;
  }>({ inFlight: null, next: null, abort: null });
  function saveExploration(blockId: string, exploration: SceneExploration) {
    if (!persistExploration || (exploration.visited.length === 0 && exploration.noted.length === 0)) return;
    const queue = exploreQueue.current;
    queue.next = { blockId, state: exploration };
    if (queue.inFlight) return;
    queue.inFlight = (async () => {
      while (queue.next) {
        const { blockId: id, state: body } = queue.next;
        queue.next = null;
        const abort = typeof AbortController === 'undefined' ? null : new AbortController();
        queue.abort = abort;
        try {
          await fetch(`/api/courses/${courseId}/blocks/${id}/explore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
            ...(abort ? { signal: abort.signal } : {}),
          });
        } catch {
          // Brak sieci albo przerwane po limicie czekania (handleAnswer): stan doniesie kolejny zapis częściowy albo zapis bloku.
        }
      }
      queue.abort = null;
      queue.inFlight = null;
    })();
  }

  // Zapis bloku w toku (fix/resume-po-wyjsciu): X czeka na niego i na zapis stanu sceny, najwyżej EXIT_SAVE_WAIT_MS (wyjście nigdy nie
  // wisi na zerwanym połączeniu), żeby lista kursów i „Kontynuuj naukę” widziały ostatni zapisany blok.
  // Bez zapisów w toku X działa jak zwykły link (także nowa karta: kliknięcie z modyfikatorem nie jest wstrzymywane). Kolejne kliknięcia
  // w trakcie czekania nic nie dokładają; odmontowanie (gracz sam przeszedł gdzie indziej) i sesja wygasła (401 -> /login) - bez push.
  const progressSave = useRef<Promise<void> | null>(null);
  const exiting = useRef(false);
  const unmounted = useRef(false);
  const sessionExpired = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);
  const handleExitClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (exiting.current) {
        event.preventDefault();
        return;
      }
      const pending = [progressSave.current, exploreQueue.current.inFlight].filter((p): p is Promise<void> => p !== null);
      if (pending.length === 0) return;
      event.preventDefault();
      exiting.current = true;
      setExitPending(true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, EXIT_SAVE_WAIT_MS))),
      ]).then(() => {
        clearTimeout(timer);
        if (unmounted.current || sessionExpired.current) return;
        router.push('/courses');
        // Nawigacja, która się nie odbyła (przerwana) - X nie zostaje zablokowany na stałe.
        setTimeout(() => {
          if (unmounted.current) return;
          exiting.current = false;
          setExitPending(false);
        }, EXIT_SAVE_WAIT_MS);
      });
    },
    [router],
  );

  async function handleAnswer(answer?: unknown) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    let releaseSave: () => void = () => {};
    progressSave.current = new Promise<void>((resolve) => (releaseSave = resolve));
    setSubmitting(true);
    setError(null);
    // Zapis bloku niesie pełny stan sceny: oczekujący zapis częściowy jest zbędny (wraca do kolejki tylko, gdy zapis bloku się nie
    // powiedzie), a trwający ma dojść PRZED zapisem bloku (po nim blok nie jest już bieżący i serwer odrzuciłby go kodem 400) - czekamy
    // na niego najwyżej EXPLORE_WAIT_MS, żeby wiszące żądanie w tle nie blokowało „Dalej” - po limicie jest przerywane (kolejka się zwalnia
    // i nie trzyma zapisów częściowych następnej sceny).
    const droppedExploration = exploreQueue.current.next;
    exploreQueue.current.next = null;
    let blockSaved = false;
    // Sesja wygasła (401 - przejście do logowania): zdjęty stan częściowy nie wraca do kolejki (poleciałby w próżnię).
    let requeue = true;
    try {
      const pendingExploration = exploreQueue.current.inFlight;
      if (pendingExploration) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([
          pendingExploration.then(() => false),
          new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), EXPLORE_WAIT_MS))),
        ]);
        clearTimeout(timer);
        if (timedOut) exploreQueue.current.abort?.abort();
      }
      const response = await fetch(`/api/courses/${courseId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // blockId (D-177): serwer odrzuca zapis (409), gdy pod tym indeksem jest już inny blok - treść zmieniła się pod otwartą kartą.
        body: JSON.stringify({
          blockIndex: state.currentBlockIndex,
          ...(blocks[state.currentBlockIndex]?.id ? { blockId: blocks[state.currentBlockIndex].id } : {}),
          ...(answer === undefined ? {} : { answer }),
        }),
      });

      if (response.status === 401) {
        requeue = false;
        sessionExpired.current = true;
        router.push('/login');
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się zapisać odpowiedzi.');
        // 400 (np. „Bloki trzeba ukończyć po kolei”): odtwarzacz mógł mieć nieaktualny postęp (D-142: drzewo z pamięci routera, nieudane
        // odświeżenie po „Wstecz”) - świeży postęp z serwera; inny currentBlockIndex zmienia klucz w page.tsx i przemontowuje odtwarzacz.
        // 409 (D-177): treść kursu zmieniła się pod otwartą kartą - świeże /start pokazuje nową wersję.
        if (response.status === 400 || response.status === 409) router.refresh();
        return;
      }

      const progress = data as CourseProgressResponse;
      blockSaved = true;
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
      // Blok bez oceny (D-129, np. przesłuchanie bez sprzeczności - waga 0): serwer nie zwraca ani wyniku, ani komentarza, ani
      // rozstrzygnięcia z treścią - ekran wyniku byłby pusty („Blok ukończony.”), więc też od razu dalej. Przesłuchanie ze sprzecznościami,
      // ale z wagą 0 (bez punktów) zwraca w rozstrzygnięciu kłamstwa - ten wynik zostaje (code review D-129).
      const last = progress.lastResult;
      const detailToShow = !!last.detail && (last.type !== 'INTERROGATION' || (last.detail.contradictions?.length ?? 0) > 0);
      const nothingToShow = last.correct === undefined && last.points === undefined && !last.reaction?.text && !detailToShow;
      // Tryb prosty i SWIPE_SORT (D-132): werdykt i zdanie gracz widział przy każdym kliknięciu, a wyniku w blokach nie pokazujemy.
      const skipsFeedbackScreen =
        isExploratory(last.type) || last.type === 'TEXT_INPUT_GUIDED' || last.type === 'SWIPE_SORT' || simpleMode || nothingToShow;
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
      progressSave.current = null;
      releaseSave();
      // Zapis bloku się nie powiódł: zdjęty z kolejki stan częściowy wraca do zapisu (chyba że scena zgłosiła w międzyczasie nowszy).
      if (requeue && !blockSaved && droppedExploration && !exploreQueue.current.next) saveExploration(droppedExploration.blockId, droppedExploration.state);
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
      // Akcja bloku w miejscu „Dalej” (D-187): „Sprawdź” itp. przed odpowiedzią.
      if (barAction) {
        if (barAction.enabled) barAction.run();
        return;
      }
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

  // Bez ekranu podsumowania przed wynikiem (decyzja właściciela 2026-11-17, D-169): z danymi modułu (ekran końca, D-165) blok SUMMARY nie
  // jest pokazywany - odtwarzacz zapisuje go sam, gdy stanie się bieżącym blokiem (po ostatnim pytaniu), i od razu przechodzi do ekranu
  // wyniku. Treść SUMMARY zostaje źródłem nagłówka i zasad ekranu końca. Nieudany zapis (`error`) - podsumowanie pokazuje się jak dotąd,
  // z „Dalej” (bez pętli ponawiania).
  const autoCloseSummary =
    Boolean(initial.moduleInfo) &&
    !showStart &&
    state.status !== 'COMPLETED' &&
    !showingFeedback &&
    !reviewing &&
    error === null &&
    blocks[state.currentBlockIndex]?.type === 'SUMMARY';
  // Jedna próba na blok (np. wygasła sesja -> przejście do logowania bez `error` nie może zapętlić zapisów).
  const autoClosedFor = useRef<number | null>(null);
  useEffect(() => {
    // Po zakończeniu poprzedniego zapisu (`submitting`), inaczej blokada podwójnego wysłania w handleAnswer zjadłaby ten zapis.
    if (!autoCloseSummary || submitting || autoClosedFor.current === state.currentBlockIndex) return;
    autoClosedFor.current = state.currentBlockIndex;
    void handleAnswer(undefined);
    // handleAnswer czyta bieżący stan; wystarczy moment, w którym SUMMARY staje się bieżącym blokiem i nic się nie zapisuje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCloseSummary, submitting]);

  // SCENE_HOTSPOTS wypełnia całą dostępną przestrzeń ramki (object-contain); DIALOGUE, BRIEFING i DOSSIER też wypełniają (własny,
  // wewnętrzny scroll wątku/odprawy zamiast przewijania całego panelu - fix/dialogue-sticky-questions, D-081), ale to NIE jest
  // "scena" (stąd osobna wartość 'fill', ten sam CSS co 'scene' w PlayerStage.tsx); reszta bloków (i FeedbackPanel/
  // prosty ekran zamknięcia/wynik ScoredBlock) to wyśrodkowany panel jak slajd (PlayerStage.tsx, contentLayout).
  // Ekran zamknięcia sprawy z raportem (D-089) wypełnia ramkę jak scena; bez `closing` - panel jak slajd.
  // ORDERING (tablica śledcza, D-088) też 'fill' - także jej wynik zaraz po zapisie (wynik jest na tej samej tablicy); w 'fill'
  // PlayerStage nie dokłada paska podpowiedzi, zdanie informacji zwrotnej jest pod tablicą.
  // Odsłuch nagrania (D-115) pokazuje wynik na tej samej transkrypcji - też 'fill', jak tablica.
  // OSINT (D-121) i rozmowa na żywo (D-123) - wynik na tym samym ekranie, też 'fill' (BOARD_TYPES).
  // Akcja bloku w pasku tylko przy bieżącym bloku przed odpowiedzią - nie w podglądzie „Wstecz” (ukryty blok bieżący zostaje zamontowany)
  // ani przy wyniku.
  const activeBarAction = barAction && !reviewing && !showingFeedback && !isSummaryMode ? barAction : null;
  const boardFeedback = showingFeedback && BOARD_TYPES.includes(blocks[feedback.blockIndex]?.type ?? '') && !!feedback.detail;
  // Wynik poczty w monitorze (D-184): zostaje w tym samym monitorze - układ jak przy zadaniu ('scene').
  const answeredBlock = showingFeedback ? blocks[feedback.blockIndex] : undefined;
  const monitorFeedback = answeredBlock?.type === 'EMAIL_ANALYSIS' && answeredBlock.frame === 'monitor' && !!feedback?.detail;
  const contentLayout: 'scene' | 'slide' | 'fill' =
    isSummaryMode && closingBlock
      ? 'fill'
      : monitorFeedback
        ? 'scene'
        : isSummaryMode || (showingFeedback && !boardFeedback)
      ? 'slide'
      : boardFeedback
        ? 'fill'
        : currentBlock?.type === 'SCENE_HOTSPOTS' ||
            // Quiz w monitorze (D-164, tryb prosty): monitor wypełnia obszar bloku, treść przewija się w ekranie; 'scene', nie 'fill', bo
            // 'fill' nie pokazuje stałej podpowiedzi bloku (`tip`), a 'scene' kładzie ją w rogu. Podgląd „Wstecz” - zwykły podgląd ('slide').
            (simpleMode && !reviewing && currentBlock?.type === 'QUIZ') ||
            // Poczta w monitorze (D-178): jak quiz w monitorze - monitor wypełnia obszar, mail i lista przewijają się w ekranie.
            (!reviewing && currentBlock?.type === 'EMAIL_ANALYSIS' && currentBlock.frame === 'monitor') ||
            // Teczka na biurku (D-178): tło wypełnia obszar bloku; 'scene', nie 'fill' - podpowiedź bloku (`tip`) zostaje w rogu.
            // Podgląd „Wstecz” - zwykły slajd bez tła (TabsBlock: review).
            (!reviewing && currentBlock?.type === 'TABS' && currentBlock.look === 'folder' && !!currentBlock.background) ||
            // Rozmowa na ekranie telefonu ze sceny (D-181): jak monitor - telefon wypełnia obszar bloku, `tip` w rogu.
            (!reviewing && currentBlock?.type === 'DOSSIER' && !!currentBlock.phone) ||
            // Rozmowa z postacią na ekranie telefonu (D-184): jak komunikator.
            (!reviewing && currentBlock?.type === 'DIALOGUE' && !!currentBlock.phone) ||
            // Strona z domeną w monitorze (D-181): jak poczta w monitorze.
            (!reviewing && currentBlock?.type === 'TEXT_INPUT_GUIDED' && currentBlock.frame === 'monitor')
          ? 'scene'
          : currentBlock?.type === 'DIALOGUE' ||
              // Wideo (D-159): ramka 16:9 wpisana w wysokość obszaru - bez przewijania (decyzja właściciela po podglądzie modułu 5).
              currentBlock?.type === 'VIDEO' ||
              currentBlock?.type === 'BRIEFING' ||
              currentBlock?.type === 'DOSSIER' ||
              currentBlock?.type === 'ORDERING' ||
              currentBlock?.type === 'CALL_RECORDING' ||
              currentBlock?.type === 'ANNOTATED_REPLAY' ||
              // Przesłuchanie (D-118): wątek jak rozmowa (własne przewijanie wątku, stopka z pytaniami) - 'fill'.
              currentBlock?.type === 'INTERROGATION' ||
              // OSINT (D-121): strona wypełnia ramkę (w pionie przewijana w bloku).
              currentBlock?.type === 'OSINT_SPOT' ||
              // Rozmowa na żywo (D-123): ekran połączenia z własnym przewijaniem transkrypcji i odpowiedziami w stopce.
              currentBlock?.type === 'LIVE_CALL'
            ? 'fill'
            : 'slide';
  const onProgress = (blockId: string, patch: Partial<ClientProgressBlock>) =>
    setResults((current) => ({ ...current, [blockId]: { ...(current[blockId] ?? { type: patch.type ?? '', done: false }), ...patch } as ClientProgressBlock }));

  let stage: React.ReactNode;
  // Z danymi modułu tryb podsumowania renderuje ekran końca (wczesny return niżej) - raport w teczce tylko bez nich.
  if (isSummaryMode && !initial.moduleInfo) {
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
        signer={signer}
        contentBase={contentBase}
        fresh={completedNow}
        nextCourse={nextCourse}
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
    stage = autoCloseSummary ? (
      // Chwila zapisu podsumowania (D-169) - zamiast jego treści krótki, neutralny komunikat (także moduły bez śledztwa), za moment wynik.
      <p role="status" data-testid="closing-pending" className="m-auto text-base text-muted">
        Za chwilę wynik…
      </p>
    ) : (
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
              myAvatarUrl,
              myInitials,
              tasks,
              identity,
              onBriefingStep: trackBriefingStep(`l-${keyOf(state.currentBlockIndex)}`),
              caseNo,
              noTimeLimits,
              submitFailed: error !== null,
              onRetry: () => setError(null),
              simpleMode,
              blocks,
              onEvidence: setEvidence,
              onExplore: saveExploration,
              // Ten sam gest co autostart lektora (Start na ekranie startu, „Dalej” z bloku z nagraniem) - film po Start gra od razu
              // (uwaga właściciela 2026-11-17, moduł 5 zaczyna się od filmu).
              autoPlay: autoPlayFor === keyOf(state.currentBlockIndex),
            })}
          </div>
        )}
        {reviewing && (
          // Podgląd „Wstecz” nie rejestruje akcji paska (D-187) - jego zdjęcie przy wyjściu z podglądu zdjęłoby akcję bieżącego bloku.
          <BarActionProvider onChange={ignoreBarAction}>
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
            simpleMode={simpleMode}
          />
          </BarActionProvider>
        )}
      </>
    );
  }

  // Narracja: bloku podsumowania (tryb summary), bloku z wyniku (feedback) albo bieżącego/podglądanego bloku - JEDNO
  // wywołanie hooka niezależnie od trybu (zasady hooków), NarrationBar sam nic nie pokazuje bez
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
      // Film startuje sam po tym samym geście (D-166) - narracja bloku VIDEO (jeśli treść ją ma) nie gra razem z nim; gracz uruchomi ją ręcznie.
      currentBlock?.type !== 'VIDEO' &&
      // Podsumowanie zamykane od razu (D-169) - lektor go nie zaczyna.
      !autoCloseSummary &&
      (briefingStep && briefingStep.index > 0 ? briefingStep.gesture : autoPlayFor === keyOf(displayedIndex)),
    resetKey: isSummaryMode
      ? 'summary'
      : `${keyOf(showingFeedback ? feedback.blockIndex : displayedIndex)}-${showingFeedback ? 'w' : 'b'}${briefingStep ? `-s${briefingStep.index}` : ''}`,
  });
  // Blok z głosem postaci (przesłuchanie, B-135) wstrzymuje lektora, gdy postać zaczyna mówić - bez dwóch głosów naraz. Stabilna funkcja
  // (ref na bieżący stan paska), żeby nie zmieniać kontekstu przy każdym renderze.
  const narrationBarRef = useRef(narrationBarState);
  narrationBarRef.current = narrationBarState;
  const pauseNarration = useCallback(() => {
    if (narrationBarRef.current.playing) narrationBarRef.current.togglePlay();
  }, []);

  // Ostatni krok odprawy - etykieta „Dalej” (D-160) tylko na nim.
  const briefingLast = (currentBlock?.steps?.length ?? 1) - 1;

  // Język treści (D-133) - nadal z konta i przeglądarki (API), tylko bez plakietki i przełącznika w odtwarzaczu (D-162, decyzja właściciela).
  const contentLocale = initial.locale ?? 'pl';

  // Ogłoszenie aria-live (PlayerStage.tsx, region persystentny przez cały kurs - D-076) wypełnione WYŁĄCZNIE w
  // trybie podsumowania ze świeżym `reward` z TEJ sesji (patrz komentarz przy `reward` wyżej) - puste poza tym, w
  // tym gdy user wraca do już dawno ukończonego kursu (reward null, raport pokazuje wtedy XP jako "—").
  const resultAnnouncement =
    isSummaryMode && reward
      ? reward.xpGained > 0
        ? `Kurs ukończony. Zdobyto ${reward.xpGained} punktów doświadczenia.`
        : 'Kurs ukończony ponownie. Punkty doświadczenia naliczone przy pierwszym ukończeniu.'
      : '';

  // Region ogłoszenia wyniku dla ekranu końca (D-165): PIERWSZE dziecko fragmentu w KAŻDEJ gałęzi renderu poniżej (ekran końca, startu,
  // ramka odtwarzacza) - React zachowuje go przy przejściu ramka -> ekran końca (ten sam typ na tej samej pozycji), więc region istnieje
  // od wejścia na kurs i czytnik ogłasza zmianę jego treści (D-076), a nie region wstawiony już z treścią. Odpowiedź bez danych modułu
  // (raport w teczce w ramce) - ogłasza region PlayerStage, a tego nie ma (null na tej samej pozycji w każdej gałęzi).
  const liveRegion = initial.moduleInfo ? (
    <p role="status" aria-live="polite" data-testid="result-announcement" className="sr-only">
      {resultAnnouncement}
    </p>
  ) : null;

  // Ekran końca modułu (szablon, D-165): po ukończeniu, w odpowiedziach z danymi modułu. Bez nich (starsze API, testy) - raport w teczce
  // (CaseClosedScreen) w ramce odtwarzacza, jak dotąd.
  if (isSummaryMode && initial.moduleInfo) {
    return (
      <>
      {liveRegion}
      <ModuleEndScreen
        moduleTitle={initial.title}
        headline={summaryBlock?.title}
        info={initial.moduleInfo}
        contentBase={contentBase}
        lang={contentLocale}
        score={state.score}
        scoreUnavailable={scoreUnavailable}
        reward={reward}
        startedAt={initial.startedAt}
        completedAt={completedAt}
        rules={summaryRules(summaryBlock)}
        nextCourse={nextCourse}
        onRestart={restartCourse}
        restarting={restarting}
        restartError={restartError}
        headingRef={summaryHeadingRef}
        fresh={completedNow}
      />
      </>
    );
  }

  if (showStart && initial.moduleInfo) {
    return (
      <>
      {liveRegion}
      <ModuleStartScreen
        title={initial.title}
        info={initial.moduleInfo}
        contentBase={contentBase}
        lang={contentLocale}
        onStart={startModule}
        narration={narrationBarState}
        narrationEnabled={preference.enabled}
        onToggleNarration={preference.toggle}
        togglePending={preference.pending}
        toggleError={preference.error}
      />
      </>
    );
  }

  return (
    <>
    {liveRegion}
    {/* Dźwięki interfejsu (czat, zamknięcie sprawy) grają tylko przy włączonym Lektorze - jedno ustawienie dźwięku gracza (D-087/D-089). */}
    <SfxProvider enabled={preference.enabled}>
    <NarrationPauseProvider pause={pauseNarration}>
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
            // Z danymi modułu wynik ogłasza region `liveRegion` (ekran końca bez ramki) - tu pusto, bez podwójnego ogłoszenia.
            resultAnnouncement={initial.moduleInfo ? '' : resultAnnouncement}
            showHint={!isSummaryMode}
            lang={contentLocale}
            // Stała podpowiedź: `tip` (D-096), dla starszych wersji treści `mascot.text` (poza ignorowana, D-093); bez niej - domyślna dla typu.
            idleHint={
              currentBlock && !showingFeedback && !isSummaryMode
                ? (currentBlock.tip ?? currentBlock.mascot?.text ?? DEFAULT_HINT[currentBlock.type])
                : undefined
            }
            contentLayout={contentLayout}
            simpleMode={simpleMode}
            stage={
              <>
                {error && (
                  <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <BarActionProvider onChange={handleBarAction}>{stage}</BarActionProvider>
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
                textOnScreen={
                  // Raport zamknięcia (SUMMARY) pokazuje wnioski i liczby, które lektor streszcza; na telefonie raport 9:16 nie ma
                  // zapasu wysokości na dodatkowy wiersz tekstu w pasku (360x740: wnioski wychodziły poza slot) - D-162.
                  // Po ukończeniu kursu API ustawia currentBlockIndex = liczba bloków (currentBlock = undefined) - stąd isSummaryMode.
                  isSummaryMode ||
                  currentBlock?.type === 'SUMMARY' ||
                  (briefingStep !== null && briefingNarrationOnScreen(currentBlock, briefingStep.index))
                }
              />
            }
            onBack={isSummaryMode ? restartCourse : goBack}
            onForward={isSummaryMode ? undefined : goForward}
            canBack={isSummaryMode ? !restarting : displayedIndex > 0 && !showingFeedback && !submitting}
            // Jeden „Dalej” (D-106): pasek jest JEDYNYM przejściem dalej w całym odtwarzaczu - bloki nie mają własnych przycisków
            // dalej, tylko zgłaszają gotowość (onReady) po akcji w bloku (sprawdzenie, obejrzenie, podejście do drzwi, ostatni krok
            // odprawy); wynik bloku ocenianego (feedback) - „Dalej” od razu aktywny.
            canForward={
              (reviewing || showingFeedback || (activeBarAction ? activeBarAction.enabled : readySubmit !== null)) && !submitting
            }
            // Puls i ogłoszenie „możesz przejść dalej” tylko przy gotowości i wyniku - nie w podglądzie „Wstecz” (B-126).
            announceForward={!reviewing}
            // Akcja bloku w pasku (D-187): bez skrótu Enter/→, pulsu i ogłoszenia „możesz przejść dalej” - odpowiedź wysyła tylko klik.
            forwardShortcut={!activeBarAction}
            backLabel={isSummaryMode ? (restarting ? 'Uruchamianie od nowa…' : 'Rozpocznij od nowa') : undefined}
            // Etykieta zmienia się tylko tam, gdzie „Dalej” kończy sprawę (SUMMARY) albo jest wyjściem z modułu (ekran zamknięcia -
            // prawdziwy link do biblioteki; pod raportem zostaje tylko „Następna sprawa”).
            forwardLabel={
              isSummaryMode
                ? 'Wróć do biblioteki'
                : activeBarAction
                  ? activeBarAction.label
                : !showingFeedback && !reviewing && currentBlock?.type === 'SUMMARY' && !autoCloseSummary
                  ? hasEvidence(evidence)
                    ? 'Zakończ sprawę'
                    : 'Zakończ szkolenie'
                  : !showingFeedback && !reviewing && currentBlock?.type === 'BRIEFING' && briefingStep?.index === briefingLast
                    ? // Własna etykieta ostatniego kroku odprawy (D-160, np. „Zaczynamy”); bez niej - „Dalej”.
                      briefingNextLabel(currentBlock)
                    : undefined
            }
            forwardHref={isSummaryMode ? '/courses' : undefined}
            onExitClick={handleExitClick}
            exitPending={exitPending}
            backdropUrl={contentAssetUrl(contentBase, initial.moduleInfo?.cover?.backdrop ?? undefined, 'image')}
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
    </NarrationPauseProvider>
    </SfxProvider>
    </>
  );
}
