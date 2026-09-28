'use client';

import { ClosedCaption, Pause, Play, Volume2, VolumeOff } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import type { NarrationBarState } from './useNarrationBar';

export const TRANSCRIPT_TOGGLE_ID = 'narration-transcript-toggle';

// Pasek narracji, jeden komponent dla WSZYSTKICH breakpointów (D-078: bez osobnego pliku na telefon w pionie) -
// jeden rząd: sam przycisk play/pause (lewo - fix/dialogue-polish/D-080: bez paska postępu/czasu i bez pierścienia
// dekoracyjnego na telefonie w pionie z D-078 - usunięte jako zbędna złożoność), bieżąca linijka
// napisów w jednej linii z ellipsis + przycisk "Transkrypcja" (środek, flex-1 - sama treść panelu renderuje
// TranscriptPanel.tsx NAD paskiem, nie tutaj), przełącznik "Lektor" (prawo - Wstecz/Dalej dokłada PlayerStage, nie
// ten komponent, bo działają niezależnie od tego, czy blok ma w ogóle narrację).
// Pasek węższy niż 640 px (fix/mobile-player-bar, container query `pbar` w globals.css - szerokość sceny, nie viewportu): korzeń i
// środkowa grupa mają `display: contents` (klasa pbar-contents), więc przyciski stają się elementami rzędu paska PlayerStage:
// [Odtwórz] [Transkrypcja - ikona CC] [Lektor - ikona głośnika] ... [Wstecz] [Dalej]; linijka napisów (pbar-caption) przechodzi
// na osobny wiersz NAD przyciskami, a przy otwartej transkrypcji znika. Etykiety tekstowe (pbar-label) są wtedy tylko dla czytnika.
export default function NarrationBar({
  narration,
  state,
  enabled,
  onToggleEnabled,
  togglePending = false,
  toggleError = null,
  transcriptButtonRef,
}: {
  narration?: Narration;
  state: NarrationBarState;
  enabled: boolean;
  onToggleEnabled: () => void;
  togglePending?: boolean;
  toggleError?: string | null;
  /** CoursePlayer.tsx dzieli ten sam ref z TranscriptPanel.tsx - fokus wraca tutaj przy zamknięciu panelu. */
  transcriptButtonRef?: React.RefObject<HTMLButtonElement>;
}) {
  const { audioRef, audioUrl, playing, hasAudio, loadFailed, autoplayBlocked, showCaption, active, transcriptOpen, toggleTranscript, togglePlay, onPlay, onPause, onEnded, onTimeUpdate, onError } = state;

  if (!narration) return null;

  const hasMessage = Boolean(toggleError) || autoplayBlocked || (enabled && loadFailed);

  return (
    <div data-transcript-open={transcriptOpen ? '' : undefined} className="pbar-contents pbar-narration flex min-w-0 flex-1 items-center gap-3">
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
            className="pbar-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700"
          >
            {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5" />}
          </button>
        </>
      )}

      <div className="pbar-contents flex min-w-0 flex-1 items-center gap-2">
        <div data-testid="narration-caption" className="pbar-caption min-w-0 flex-1">
          {toggleError && (
            <p role="alert" className="truncate text-xs text-red-700">
              {toggleError}
            </p>
          )}
          {!toggleError && autoplayBlocked && <p className="truncate text-xs text-slate-600">Przeglądarka zablokowała autoodtwarzanie.</p>}
          {!toggleError && !autoplayBlocked && enabled && loadFailed && (
            <p className="truncate text-xs text-amber-700">Nie udało się załadować nagrania. Zobacz transkrypcję.</p>
          )}
          {!hasMessage && showCaption && (
            <p className="pbar-caption-text truncate text-sm text-slate-800" title={active?.text}>
              {active?.text}
            </p>
          )}
        </div>
        <button
          ref={transcriptButtonRef}
          type="button"
          onClick={toggleTranscript}
          aria-expanded={transcriptOpen}
          aria-controls={transcriptOpen ? TRANSCRIPT_TOGGLE_ID : undefined}
          title="Transkrypcja"
          className="pbar-transcript shrink-0 text-xs font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
        >
          {/* Ikona CC tylko w wąskim pasku (pbar-compact-only); nazwa dostępna zawsze z tekstu. */}
          <ClosedCaption aria-hidden="true" className="pbar-compact-only h-5 w-5" />
          <span className="pbar-label">Transkrypcja</span>
        </button>
      </div>

      <button
        type="button"
        // Przełącznik jako przycisk z aria-pressed (fix/mobile-player-bar): stan widać też na ikonie - przekreślony głośnik, gdy wyłączony.
        aria-pressed={enabled}
        onClick={onToggleEnabled}
        disabled={togglePending}
        title={enabled ? 'Lektor włączony' : 'Lektor wyłączony'}
        className={`pbar-icon ml-auto inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium disabled:opacity-60 ${
          enabled ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-600'
        }`}
      >
        {enabled ? <Volume2 aria-hidden="true" className="h-4 w-4" /> : <VolumeOff aria-hidden="true" className="h-4 w-4" />}
        <span className="pbar-label">Lektor</span>
      </button>
    </div>
  );
}
