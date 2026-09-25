'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookPen, X } from 'lucide-react';
import { useFullscreen } from './useFullscreen';
import { OverlayStackProvider, useCloseTopOverlay, useOverlayLayer } from './overlay-stack';
import MascotOverlay from './MascotOverlay';
import NotesDrawer from './NotesDrawer';

// Ramka odtwarzacza kursu (feat/player-stage) - zastępuje PlayerShell.tsx. Trasa /courses/[courseId] NIE ma już
// Topbara (usunięty focusMode z Topbar.tsx) - ta ramka jest CAŁYM chromem strony. Trzy tryby dopasowania do ekranu,
// przełączane WYŁĄCZNIE media queries w globals.css (.player-frame itd.), nie JS/matchMedia - unika migotania przy
// starcie i przy obrocie ekranu:
//  - desktop/tablet/telefon w poziomie: karta 16:9, wyśrodkowana, szerokość liczona w stylu inline poniżej
//    (min(100vw-32px, (100dvh-32px)*16/9, 1280px), aspect-ratio robi resztę - bez JS).
//  - telefon w poziomie, niska wysokość (max-height:500px i orientation:landscape): pełny ekran bez marginesów i
//    zaokrągleń, paski ściśnięte (globals.css nadpisuje inline style przez !important - jedyne takie miejsce).
//  - telefon w pionie (max-width:767px i orientation:portrait): pełny ekran (100dvh) bez 16:9, te same 3 strefy;
//    licznik dowodów/Notatnik zwijają się do ikon (.player-compact-label). Scena SCENE_HOTSPOTS w tym trybie w PR A
//    zostaje object-contain (dopasowana szerokością do ekranu) - panorama i bottom sheet to PR B.
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
  /** 'scene' (SCENE_HOTSPOTS - wypełnia całą dostępną przestrzeń) albo 'slide' (domyślny - wyśrodkowany panel max-w-3xl). */
  contentLayout?: 'scene' | 'slide';
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
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Ukrywa "Dalej" i jego podpowiedź (blok ma własne, jedyne wyjście, np. "Zakończ sprawę"). */
  hideForward?: boolean;
  forwardHint?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  /** Etykiety Wstecz/Dalej - domyślne "Wstecz"/"Dalej", na SUMMARY podmienione na "Rozpocznij od nowa"/"Wróć do biblioteki". */
  backLabel?: string;
  forwardLabel?: string;
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
  backLabel = 'Wstecz',
  forwardLabel = 'Dalej',
}: PlayerStageProps) {
  const percent = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;
  const hintId = 'forward-hint';
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(frameRef);
  const closeTop = useCloseTopOverlay();

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

  // Jedyny nasłuch Escape w całej ramce: zamyka WYŁĄCZNIE najwyższą priorytetowo otwartą warstwę (karta hotspotu
  // rejestruje się sama z bloku SCENE_HOTSPOTS; transkrypcja i notatnik - niżej w tym komponencie). Strzałki
  // celowo NIE zmieniają bloków (decyzja produktu - "Dalej"/"Wstecz" tylko przyciskiem albo klikiem w scenie).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTop();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeTop]);

  useOverlayLayer('notebook', notesOpen, onToggleNotes);

  // Dolny pasek jest zawsze widoczny (nie sticky jak w dawnym PlayerShell - ramka ma stałą wysokość, grid ją
  // pilnuje), ale mierzymy go i tak: TranscriptPanel pozycjonuje się względem niego (bottom-full), a obszar treści
  // (środkowy wiersz grid, NIE document.documentElement jak w dawnym PlayerShell - ramka jest teraz jedynym
  // przewijanym obszarem, nie cała strona) ma własny scroll-padding-bottom na wypadek elementu z fokusem tuż nad
  // paskiem.
  useEffect(() => {
    const bar = bottomBarRef.current;
    const content = contentRef.current;
    if (!bar || !content) return undefined;
    const apply = () => {
      content.style.setProperty('scroll-padding-bottom', `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`);
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      content.style.removeProperty('scroll-padding-bottom');
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
      <div
        ref={frameRef}
        role="region"
        aria-label={title}
        style={{ width: 'min(calc(100vw - 32px), calc((100dvh - 32px) * 16 / 9), 1280px)', aspectRatio: '16 / 9' }}
        className="player-frame relative isolate flex max-h-[calc(100dvh-32px)] w-full flex-col overflow-hidden rounded-card bg-white shadow-card"
      >
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
              <h1 className="truncate text-xs font-medium text-slate-500">{title}</h1>
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

        {/* Obszar bloku (wiersz 1fr): jedyne miejsce, które się przewija, gdy treść nie mieści się w ramce. Nagłówek
            dla czytników/fokusu (sr-only) - bez duplikowania treści widocznej w scenie. Dwa układy: 'scene'
            (SCENE_HOTSPOTS - blok sam wypełnia całą dostępną przestrzeń, object-contain) i 'slide' (reszta bloków -
            wyśrodkowany panel max-w-3xl, jak slajd). */}
        <div ref={contentRef} onFocusCapture={keepFocusAboveBar} className="relative min-h-0 flex-1 overflow-y-auto">
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            Blok {blockNumber} z {totalBlocks}
          </h2>
          {contentLayout === 'scene' ? (
            <div className="flex h-full min-h-full items-center justify-center p-3">{stage}</div>
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
            {!hideForward && (
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
            )}
          </nav>
        </div>

        <NotesDrawer id={notesId} open={notesOpen} onClose={onToggleNotes} />
      </div>
    </div>
  );
}
