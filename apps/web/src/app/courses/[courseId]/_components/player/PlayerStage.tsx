'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookPen, X } from 'lucide-react';
import { useFullscreen } from './useFullscreen';
import { OverlayStackProvider, useCloseTopOverlay, useOverlayLayer } from './overlay-stack';
import MascotOverlay from './MascotOverlay';
import NotesDrawer from './NotesDrawer';

// Ramka odtwarzacza kursu (feat/player-stage) - zastępuje PlayerShell.tsx. Trasa /courses/[courseId] NIE ma już
// Topbara (usunięty focusMode z Topbar.tsx) - ta ramka jest CAŁYM chromem strony (dlatego to <main>, nie
// role="region" - jedyny landmark "treść główna" na tej trasie, kod review PR #44). Trzy tryby dopasowania do
// ekranu, przełączane WYŁĄCZNIE media queries w globals.css (.player-frame itd., formuła rozmiaru w ZWYKŁEJ klasie
// CSS, nie stylu inline - dzięki temu @media wygrywają zwykłą specyficznością, bez !important), nie JS/matchMedia -
// unika migotania przy starcie i przy obrocie ekranu:
//  - desktop/tablet/telefon w poziomie: karta 16:9, wyśrodkowana, szerokość min(100vw-32px, (100dvh-32px)*16/9,
//    1280px), aspect-ratio robi resztę - bez JS.
//  - telefon w poziomie, niska wysokość (max-height:500px, orientation:landscape, pointer:coarse - to ostatnie, żeby
//    nie łapać wąskiego okna na desktopie): pełny ekran bez marginesów i zaokrągleń, paski ściśnięte.
//  - telefon w pionie (max-width:767px, orientation:portrait, pointer:coarse): pełny ekran (100dvh) bez 16:9, te
//    same 3 strefy; licznik dowodów/Notatnik zwijają się do ikon (.player-compact-label). Scena SCENE_HOTSPOTS w tym
//    trybie panuje w poziomie (ScenePanContainer.tsx), karta hotspotu jest bottom sheetem (feat/player-portrait).
//
// Strona NIGDY się nie przewija: <html>/<body> owija page.tsx w overflow-hidden h-dvh, ramka ma fixed grid rows
// (auto 1fr auto) i TYLKO obszar treści (środkowy wiersz) przewija się w środku, gdy blok się nie mieści.
export default function PlayerStage(props: PlayerStageProps) {
  return (
    <OverlayStackProvider>
      <PlayerStageInner {...props} />
    </OverlayStackProvider>
  );
}

export interface PlayerStageProps {
  title: string;
  blockNumber: number;
  totalBlocks: number;
  completedBlocks: number;
  stage: ReactNode;
  /** 'scene' (SCENE_HOTSPOTS - wypełnia całą dostępną przestrzeń), 'fill' (DIALOGUE - to samo CSS co 'scene', osobna
      nazwa: czat nie jest "sceną", fix/dialogue-sticky-questions) albo 'slide' (domyślny - wyśrodkowany panel max-w-3xl). */
  contentLayout?: 'scene' | 'slide' | 'fill';
  mascot?: { pose: string; text?: string };
  /** Licznik dowodów w pasku górnym (sam decyduje, czy się pokazać - hasEvidence w evidence.tsx). */
  evidence?: ReactNode;
  /** <NarrationBar .../> (CoursePlayer woła useNarrationBar i przekazuje wynik jemu ORAZ transcriptPanel poniżej - jedno źródło stanu). */
  narrationBar: ReactNode;
  /** <TranscriptPanel .../> - renderuje się NAD dolnym paskiem (bottom-full), rejestruje się sama w overlay-stack. */
  transcriptPanel: ReactNode;
  notesCount: number;
  notesOpen: boolean;
  onToggleNotes: () => void;
  notesId: string;
  onBack: () => void;
  /** Ignorowane, gdy forwardHref jest podane (patrz niżej). */
  onForward?: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Ukrywa "Dalej" i jego podpowiedź (blok ma własne, jedyne wyjście, np. "Zakończ sprawę"). */
  hideForward?: boolean;
  forwardHint?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  /** Ogłoszenie aria-live wyniku ukończenia kursu (XP), jedno zdanie (fix/course-finish-flow, D-076 poprawka po code
      review) - region PUSTY od zamontowania ramki (przez CAŁY kurs, nie tylko ekran podsumowania) i wypełniany
      dopiero przy ukończeniu, bez setTimeout: skoro sam region istnieje w DOM od dawna, wypełnienie go treścią przy
      zmianie propa to zwykła aktualizacja aria-live, nie "wstawienie już wypełnionego" - ten problem (czytnik często
      nie ogłasza regionu wstawionego do DOM już z treścią) dotyczyłby regionu montowanego od zera RAZ, w chwili
      ukończenia (pierwsza wersja tej poprawki, w samym SummaryScreen.tsx, właśnie to robiła i wymagała hacka z
      setTimeout). Puste (undefined/'') poza tym momentem. */
  resultAnnouncement?: string;
  /** Etykiety Wstecz/Dalej - domyślne "Wstecz"/"Dalej", na SUMMARY podmienione na "Rozpocznij od nowa"/"Wróć do biblioteki". */
  backLabel?: string;
  forwardLabel?: string;
  /** Gdy podane, "Dalej" renderuje się jako <Link href={forwardHref}> zamiast <button onClick={onForward}> - SUMMARY
      ("Wróć do biblioteki" to prawdziwa nawigacja, kod review PR #44: button+router.push tracił otwieranie w nowej
      karcie/semantykę linku). onForward/canForward są wtedy ignorowane. */
  forwardHref?: string;
}

function PlayerStageInner({
  title,
  blockNumber,
  totalBlocks,
  completedBlocks,
  stage,
  contentLayout = 'slide',
  mascot,
  evidence,
  narrationBar,
  transcriptPanel,
  notesCount,
  notesOpen,
  onToggleNotes,
  notesId,
  onBack,
  onForward,
  canBack,
  canForward,
  hideForward = false,
  forwardHint,
  headingRef,
  resultAnnouncement,
  backLabel = 'Wstecz',
  forwardLabel = 'Dalej',
  forwardHref,
}: PlayerStageProps) {
  const percent = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;
  const hintId = 'forward-hint';
  const titleId = 'player-stage-title';
  const frameRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const notesButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreen = useFullscreen(frameRef);
  const closeTop = useCloseTopOverlay();

  // Reszta ramki (wszystko poza NotesDrawer) jest inert, dopóki notatnik jest otwarty (kod review PR #44: prawdziwy
  // modal, nie tylko wizualne przyciemnienie) - blokuje interakcję I kolejność Tab dla WSZYSTKIEGO poza szufladą,
  // niezależnie od pułapki fokusu w samej szufladzie. `.inert` ustawiane imperatywnie (nie jako prop JSX) - React 18
  // (ten projekt) nie typuje jeszcze `inert` jako atrybutu JSX (dodane dopiero w React 19), ale DOM lib TypeScriptu
  // zna `HTMLElement.inert` od dawna, więc przypisanie przez ref jest w pełni typowane.
  //
  // useLayoutEffect, NIE useEffect (drugi kod review PR #44, znaleziony jako martwy fokus w prawdziwej przeglądarce
  // mimo zielonych testów - jsdom nie wspiera `inert` w ogóle, więc test tego nie łapał): NotesDrawer.tsx ma WŁASNY
  // useEffect, który przy zamknięciu woła triggerRef.current.focus() na tym samym przycisku "Notatnik", który leży
  // WEWNĄTRZ restRef. React commit'uje wszystkie useLayoutEffect (rodzica i dzieci) PRZED jakimkolwiek useEffect
  // (pasywne efekty dziecka i tak biegną przed pasywnymi efektami rodzica, więc zwykły useEffect tutaj czyściłby
  // .inert PO tym, jak NotesDrawer już próbował .focus() na wciąż-inertnym przycisku - przeglądarki ignorują focus()
  // na elemencie inert, więc fokus zostawał na (teraz ukrytym, aria-hidden) X zamiast wrócić na "Notatnik").
  useLayoutEffect(() => {
    if (restRef.current) restRef.current.inert = notesOpen;
  }, [notesOpen]);

  // Fullscreen jako najniższy priorytet kaskady (D-075: w praktyce Escape w fullscreenie i tak wychodzi z niego
  // przez samą przeglądarkę PRZED tym kodem - to wyłącznie dopełnienie rejestru, nie próba obejścia tamtego
  // zachowania).
  useOverlayLayer(
    'fullscreen',
    fullscreen.active,
    () => {
      document.exitFullscreen().catch(() => {});
    },
  );

  // Jedyny nasłuch Escape w całej ramce: zamyka WYŁĄCZNIE najpóźniej otwartą, wciąż otwartą warstwę (LIFO wg
  // overlay-stack.tsx - karta hotspotu rejestruje się sama z bloku SCENE_HOTSPOTS; transkrypcja i notatnik - niżej
  // w tym komponencie/w NotesDrawer). Strzałki celowo NIE zmieniają bloków (decyzja produktu - "Dalej"/"Wstecz"
  // tylko przyciskiem albo klikiem w scenie).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTop();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeTop]);

  // Warstwa 'notebook' rejestruje się WYŁĄCZNIE w NotesDrawer.tsx (kod review PR #44: podwójna rejestracja pod tym
  // samym kluczem tutaj i tam była krucha - unregister jednej instancji kasował wpis drugiej).

  // Dolny pasek jest zawsze widoczny (nie sticky jak w dawnym PlayerShell - ramka ma stałą wysokość, grid ją
  // pilnuje), ale mierzymy go i tak: TranscriptPanel pozycjonuje się względem niego (bottom-full), a obszar treści
  // (środkowy wiersz grid, NIE document.documentElement jak w dawnym PlayerShell - ramka jest teraz jedynym
  // przewijanym obszarem, nie cała strona) ma własny scroll-padding-bottom na wypadek elementu z fokusem tuż nad
  // paskiem. --player-bottombar-height (feat/player-portrait, na ramce - custom property dziedziczy w dół DOM) -
  // bottom sheet karty hotspotu (SceneHotspotsBlock.tsx, globals.css) jest position:fixed WZGLĘDEM CAŁEGO
  // viewportu (musi być - scena pod nim bywa przescrollowana panoramą), więc bottom:0 nachodziłby na TEN pasek
  // (który zajmuje dolne piksele TEGO SAMEGO viewportu, position:relative w normalnym przepływie ramki, nie
  // fixed) - zweryfikowane empirycznie (scratch, nie w repo): bez tego przyciski karty (.hotspot-card-buttons)
  // nakładały się na "Transkrypcja"/"Lektor"/"Wstecz". Fallback 56px w CSS (var(...,56px)) na wypadek renderu
  // przed pierwszym pomiarem (min-h-[56px] paska - ta sama wartość).
  useEffect(() => {
    const bar = bottomBarRef.current;
    const content = contentRef.current;
    const frame = frameRef.current;
    if (!bar || !content) return undefined;
    const apply = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      content.style.setProperty('scroll-padding-bottom', `${height + 8}px`);
      frame?.style.setProperty('--player-bottombar-height', `${height}px`);
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      content.style.removeProperty('scroll-padding-bottom');
      frame?.style.removeProperty('--player-bottombar-height');
    };
  }, []);

  // Przeglądarka nie przewija elementu z fokusem, gdy mieści się w oknie (tu: w obszarze treści), choć leży POD
  // dolnym paskiem (Chromium na telefonie: scroll-padding nie działa dla focus()). Robimy to sami: element z
  // fokusem spoza paska, którego dół zachodzi na pasek, przewijamy nad pasek - WEWNĄTRZ obszaru treści
  // (content.scrollBy), nie window.scrollBy jak w dawnym PlayerShell (strona już się nie przewija).
  function keepFocusAboveBar(event: React.FocusEvent<HTMLDivElement>) {
    const bar = bottomBarRef.current;
    const content = contentRef.current;
    const target = event.target as HTMLElement;
    if (!bar || !content || bar.contains(target)) return;
    const overlap = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
    if (overlap > 0) content.scrollBy({ top: overlap + 8 });
  }

  return (
    <div className="player-outer flex h-full w-full items-center justify-center p-4">
      <main ref={frameRef} aria-labelledby={titleId} className="player-frame relative isolate flex w-full flex-col overflow-hidden rounded-card bg-white shadow-card">
        {/* Reszta ramki (wszystko poza NotesDrawer, wyżej) jest inert, dopóki notatnik jest otwarty - patrz efekt
            na restRef. h-full: NotesDrawer jest position:absolute (poza przepływem), więc to jedyne "prawdziwe"
            dziecko flex kolumny ramki i musi samo wypełnić jej wysokość. */}
        <div ref={restRef} className="flex h-full flex-col">
          {/* Pasek górny (~48px, ściśnięty do 40px w telefonie w poziomie - globals.css): X (wyjście, zapis postępu
              jest już serwerowy po każdej odpowiedzi - nic dodatkowego do zrobienia tutaj), pełny ekran (tylko gdy
              wspierany), tytuł + cienki pasek postępu, licznik dowodów, Notatnik. */}
          <div className="player-topbar flex min-h-[48px] shrink-0 items-center gap-3 border-b border-slate-200 px-3">
            <Link
              href="/courses"
              aria-label="Zakończ i wróć do listy kursów"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Link>
            {fullscreen.enabled && (
              <button
                type="button"
                onClick={fullscreen.toggle}
                aria-label={fullscreen.active ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                {fullscreen.active ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
              </button>
            )}

            <div className="ml-auto flex min-w-0 items-center gap-3">
              <div className="min-w-0 text-right">
                <h1 id={titleId} className="truncate text-xs font-medium text-slate-500">
                  {title}
                </h1>
                <div
                  role="progressbar"
                  aria-label="Postęp szkolenia"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-valuetext={`Ukończono ${completedBlocks} z ${totalBlocks} bloków`}
                  className="h-1.5 w-[140px] overflow-hidden rounded-full bg-slate-200 sm:w-[220px]"
                >
                  <div className="h-full rounded-full bg-indigo-600 motion-safe:transition-all" style={{ width: `${percent}%` }} />
                </div>
              </div>
              {evidence}
              <button
                ref={notesButtonRef}
                type="button"
                onClick={onToggleNotes}
                aria-expanded={notesOpen}
                aria-controls={notesOpen ? notesId : undefined}
                aria-label={`Notatnik (${notesCount})`}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 sm:px-3"
              >
                <NotebookPen aria-hidden="true" className="h-4 w-4" />
                <span className="player-compact-label" aria-hidden="true">
                  Notatnik ({notesCount})
                </span>
              </button>
            </div>
          </div>

          <p className="sr-only" aria-live="polite">
            Blok {blockNumber} z {totalBlocks}
          </p>
          <p className="sr-only" aria-live="polite">
            {resultAnnouncement}
          </p>

          {/* Obszar bloku (wiersz 1fr). Nagłówek dla czytników/fokusu (sr-only) - bez duplikowania treści widocznej
              w scenie. Trzy układy ('scene' i 'fill' dzielą DOKŁADNIE ten sam CSS - patrz warunki niżej - osobna
              nazwa dla DIALOGUE, fix/dialogue-sticky-questions, bo czat nie jest "sceną", tylko potrzebuje tego
              samego traktowania: brak przewijania panelu, blok wypełnia dostępną wysokość, sam sobie zarządza
              wewnętrznym scrollem wątku):
              'scene' (SCENE_HOTSPOTS, hotfix fix/player-scene-fit/B-100): scena ma się ZAWSZE zmieścić w całości,
              bez przewijania obszaru bloku - overflow-clip, NIE overflow-hidden (druga runda code review tego
              hotfixu): `hidden` ucina WIDOK, ale zostaje scroll containerem - `content.scrollBy` z efektu
              keepFocusAboveBar niżej (odziedziczony po layoucie 'slide', gdzie faktycznie przewija) mógłby wtedy
              przesunąć scrollport sceny programowo, bez żadnego widocznego paska, którym dałoby się to cofnąć.
              `clip` blokuje też przewijanie programowe - scena naprawdę NIGDY się nie przesuwa. Bez ResizeObservera/
              max-h-full, które nie radziły sobie z przypadkami z produkcji - pasek przewijania w obszarze bloku, bo
              scena była wyższa niż dostępne miejsce. [container-type:size] NIE tutaj (ta sama runda) - nic w tym
              poddrzewie nie czyta cqw/cqh względem TEJ komórki (najbliższy kontener zapytań dla kwadratu
              aspect-ratio to WŁASNY, zagnieżdżony [container-type:size] SceneHotspotsBlock.tsx, PO odjęciu
              wysokości jego nagłówka przez flexbox), a "size containment" ma cichy koszt na przyszłość: robi z tej
              komórki containing block dla potomków position:fixed. Kontener sceny sam liczy swój rozmiar formułą
              "contain" (min(100cqw, 100cqh*proporcja)); treść karty hotspotu (nakładka NA scenie) nadal przewija
              się WEWNĄTRZ siebie, niezależnie od tego.
              'slide' (reszta bloków - wyśrodkowany panel max-w-3xl, jak slajd): przewijanie zostaje, ale cienkie i
              bez przeskoku treści przy pojawieniu się paska (scrollbar-gutter: stable). */}
          <div
            ref={contentRef}
            onFocusCapture={keepFocusAboveBar}
            data-testid="player-content-area"
            className={`relative min-h-0 flex-1 ${
              contentLayout === 'scene' || contentLayout === 'fill'
                ? 'overflow-clip'
                : 'overflow-y-auto [scrollbar-width:thin] [scrollbar-gutter:stable]'
            }`}
          >
            <h2 ref={headingRef} tabIndex={-1} className="sr-only">
              Blok {blockNumber} z {totalBlocks}
            </h2>
            {contentLayout === 'scene' || contentLayout === 'fill' ? (
              <div className="flex h-full min-h-full flex-col items-center justify-center p-3">{stage}</div>
            ) : (
              <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">{stage}</div>
            )}
            {mascot && <MascotOverlay pose={mascot.pose} text={mascot.text} />}
          </div>

          {/* Pasek dolny (~56px, ściśnięty do 48px w telefonie w poziomie): narracja (lewo+środek, NarrationBar samo
              zwraca null bez narracji bloku), Wstecz/Dalej (prawo). relative: TranscriptPanel pozycjonuje się
              względem niego (bottom-full). */}
          <div
            ref={bottomBarRef}
            className="player-bottombar relative flex min-h-[56px] shrink-0 items-center gap-3 border-t border-slate-200 px-3"
          >
            {transcriptPanel}
            {narrationBar}
            <nav aria-label="Nawigacja po blokach" className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onBack}
                disabled={!canBack}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 sm:px-4"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                {backLabel}
              </button>
              {!hideForward && !canForward && forwardHint && (
                <span id={hintId} className="hidden max-w-[160px] truncate text-xs text-slate-500 sm:inline" title={forwardHint}>
                  {forwardHint}
                </span>
              )}
              {!hideForward && forwardHref ? (
                <Link
                  href={forwardHref}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:px-4"
                >
                  {forwardLabel}
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              ) : (
                !hideForward && (
                  <button
                    type="button"
                    onClick={onForward}
                    disabled={!canForward}
                    aria-describedby={!canForward && forwardHint ? hintId : undefined}
                    title={!canForward ? forwardHint : undefined}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 sm:px-4"
                  >
                    {forwardLabel}
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                )
              )}
            </nav>
          </div>
        </div>

        <NotesDrawer id={notesId} open={notesOpen} onClose={onToggleNotes} triggerRef={notesButtonRef} />
      </main>
    </div>
  );
}
