'use client';

import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import type { NarrationBarState } from './useNarrationBar';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export const TRANSCRIPT_TOGGLE_ID = 'narration-transcript-toggle';

// Pasek narracji dla desktopu/tabletu/telefonu w poziomie (PR A) - jeden rząd: play/pause + cienki postęp + czas
// (lewo), bieżąca linijka napisów w jednej linii z ellipsis + przycisk "Transkrypcja" (środek, flex-1 - sama treść
// panelu renderuje TranscriptPanel.tsx NAD paskiem, nie tutaj), przełącznik "Lektor" (prawo - Wstecz/Dalej dokłada
// PlayerStage, nie ten komponent, bo działają niezależnie od tego, czy blok ma w ogóle narrację).
// NarrationBarPortrait.tsx (PR B) renderuje TĘ SAMĄ logikę (useNarrationBar w CoursePlayer, przekazaną tu jako
// `state`) z okrągłym wskaźnikiem postępu zamiast paska liniowego.
export default function NarrationBar({
  narration,
  state,
  enabled,
  onToggleEnabled,
  togglePending = false,
  toggleError = null,
}: {
  narration?: Narration;
  state: NarrationBarState;
  enabled: boolean;
  onToggleEnabled: () => void;
  togglePending?: boolean;
  toggleError?: string | null;
}) {
  const { audioRef, audioUrl, playing, positionMs, durationMs, hasAudio, loadFailed, autoplayBlocked, showCaption, active, transcriptOpen, toggleTranscript, togglePlay, seek, onPlay, onPause, onEnded, onTimeUpdate, onError } = state;

  if (!narration) return null;

  const hasMessage = Boolean(toggleError) || autoplayBlocked || (enabled && loadFailed);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
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
            aria-label={playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację'}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700"
          >
            {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5" />}
          </button>
          <div className="w-28 shrink-0 sm:w-40">
            <input
              type="range"
              aria-label="Postęp nagrania"
              aria-valuetext={`${formatTime(positionMs)} z ${formatTime(durationMs)}`}
              min={0}
              max={Math.max(durationMs, 1)}
              step={1000}
              value={Math.min(positionMs, Math.max(durationMs, 1))}
              onChange={(event) => seek(Number(event.target.value))}
              className="h-2 w-full accent-slate-900"
            />
            <span className="block text-[11px] tabular-nums text-slate-600" aria-hidden="true">
              {formatTime(positionMs)} / {formatTime(durationMs)}
            </span>
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 flex-1">
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
            <p className="truncate text-sm text-slate-800" title={active?.text}>
              {active?.text}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleTranscript}
          aria-expanded={transcriptOpen}
          aria-controls={TRANSCRIPT_TOGGLE_ID}
          className="shrink-0 text-xs font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
        >
          Transkrypcja
        </button>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggleEnabled}
        disabled={togglePending}
        className={`ml-auto inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium disabled:opacity-60 ${
          enabled ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-600'
        }`}
      >
        {enabled ? <Volume2 aria-hidden="true" className="h-4 w-4" /> : <VolumeX aria-hidden="true" className="h-4 w-4" />}
        Lektor
      </button>
    </div>
  );
}
