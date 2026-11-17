'use client';

import { Pause, Play } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import type { NarrationBarState } from './useNarrationBar';
import NarrationControls from './NarrationControls';

// Pasek narracji, jeden komponent dla WSZYSTKICH breakpointów (D-078: bez osobnego pliku na telefon w pionie) - jeden rząd w kolejności
// z makiety szablonu (D-162): [Odtwórz] [CC] [głośnik] [napisy]. CC włącza i wyłącza linijkę napisów; głośnik otwiera okienko z suwakiem
// głośności i „Wycisz lektora” (decyzja właściciela: zamiast panelu „Transkrypcja” i przełącznika „Lektor”). Wstecz/Dalej dokłada
// PlayerStage. Pasek węższy niż 640 px (fix/mobile-player-bar, container query `pbar` w globals.css - szerokość sceny, nie viewportu):
// korzeń i grupa napisów mają `display: contents` (klasa pbar-contents), więc przyciski stają się elementami rzędu paska PlayerStage:
// [Odtwórz] [CC] [głośnik] ... [Wstecz] [Dalej]; linijka napisów (pbar-caption) przechodzi na osobny wiersz NAD przyciskami.
// CC i głośnik z okienkiem - NarrationControls (te same przyciski na ekranie startu modułu, D-163).

export default function NarrationBar({
  narration,
  state,
  enabled,
  onToggleEnabled,
  togglePending = false,
  toggleError = null,
  textOnScreen = false,
}: {
  narration?: Narration;
  state: NarrationBarState;
  enabled: boolean;
  onToggleEnabled: () => void;
  togglePending?: boolean;
  toggleError?: string | null;
  /** Tekst narracji jest już dosłownie na ekranie (krok odprawy) - bez tekstu zastępczego w pasku. */
  textOnScreen?: boolean;
}) {
  const { audioRef, audioUrl, playing, hasAudio, loadFailed, autoplayBlocked, showCaption, active, captionsOn, togglePlay, onPlay, onPause, onEnded, onTimeUpdate, onError } = state;

  if (!narration) return null;

  // Bez nagrania (lektor wyciszony, błąd ładowania, blok bez pliku) przy włączonych napisach - cały tekst narracji w miejscu napisów
  // (D-162, decyzja właściciela: tekstowa alternatywa nagrania, WCAG 1.2.1). Zawija się do 2 linijek (więcej zabierałoby wysokość scenie
  // na telefonie), dłuższy przewija się w środku - bez wielokropka (na telefonie `title` jest nieosiągalny, a ucięty tekst nie byłby
  // alternatywą).
  const fallbackText = !hasAudio && captionsOn && !textOnScreen ? narration.text : null;
  const hasMessage = Boolean(toggleError) || autoplayBlocked || (enabled && loadFailed && !fallbackText);

  return (
    <div className="pbar-contents pbar-narration flex min-w-0 flex-1 items-center gap-2">
      {hasAudio && (
        <>
          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            preload="metadata"
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onError={onError}
          />
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Wstrzymaj nagranie' : 'Odtwórz nagranie'}
            title={playing ? 'Wstrzymaj nagranie' : 'Odtwórz nagranie'}
            className="pbar-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-slate-700"
          >
            {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5" />}
          </button>
        </>
      )}

      <NarrationControls state={state} enabled={enabled} onToggleEnabled={onToggleEnabled} togglePending={togglePending} resetKey={narration} />

      <div className="pbar-contents flex min-w-0 flex-1 items-center">
        <div data-testid="narration-caption" className="pbar-caption min-w-0 flex-1 px-1">
          {toggleError && (
            <p role="alert" className="truncate text-xs text-red-700">
              {toggleError}
            </p>
          )}
          {!toggleError && autoplayBlocked && <p className="truncate text-xs text-slate-600">Przeglądarka zablokowała autoodtwarzanie.</p>}
          {!toggleError && !autoplayBlocked && enabled && loadFailed && !fallbackText && (
            <p className="truncate text-xs text-amber-700">Nie udało się załadować nagrania.</p>
          )}
          {!hasMessage && fallbackText && (
            <p
              data-testid="narration-text"
              tabIndex={0}
              className="pbar-caption-text pbar-narration-text max-h-[2.5rem] overflow-y-auto whitespace-normal text-[15px] leading-5 text-ink [scrollbar-width:thin]"
            >
              {fallbackText}
            </p>
          )}
          {!hasMessage && showCaption && (
            <p className="pbar-caption-text truncate text-[15px] text-ink" title={active?.text}>
              {active?.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
