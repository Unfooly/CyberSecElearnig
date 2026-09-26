'use client';

import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import { formatNarrationTime } from './useNarrationBar';
import type { NarrationBarState } from './useNarrationBar';

export const TRANSCRIPT_TOGGLE_ID = 'narration-transcript-toggle';

// Pasek narracji dla desktopu/tabletu/telefonu w poziomie - jeden rząd: play/pause + cienki postęp + czas
// (lewo), bieżąca linijka napisów w jednej linii z ellipsis + przycisk "Transkrypcja" (środek, flex-1 - sama treść
// panelu renderuje TranscriptPanel.tsx NAD paskiem, nie tutaj), przełącznik "Lektor" (prawo - Wstecz/Dalej dokłada
// PlayerStage, nie ten komponent, bo działają niezależnie od tego, czy blok ma w ogóle narrację).
// Telefon w pionie (feat/player-portrait): TA SAMA logika (useNarrationBar w CoursePlayer, przekazana tu jako
// `state`) - BEZ osobnego pliku/komponentu (ustalone z właścicielem produktu, patrz decyzja niżej). Play/pause,
// przełącznik "Lektor", <audio>, przycisk "Transkrypcja" - WSPÓLNE, renderowane RAZ (tylko przestawiane CSS-em w
// wąskim pasku). Jedyna różnica: `.narration-progress-linear` (ten `<input type="range">` + czas) chowany,
// `.narration-progress-ring` (dekoracyjny pierścień SVG, aria-hidden) pokazywany - globals.css, breakpoint
// max-width:767px/orientation:portrait/pointer:coarse. Pierścień jest CZYSTO dekoracyjny (bez interakcji) -
// przewijanie nagrania zostaje na JEDNYM, współdzielonym <input type="range"> (ustalone z właścicielem produktu:
// zero zduplikowanych elementów dostępności, istniejące testy getByRole('slider'/'switch') - dokładnie jeden
// wynik - nie wymagają zmian w zapytaniach).
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
          <div className="narration-progress-linear w-28 shrink-0 sm:w-40">
            <input
              type="range"
              aria-label="Postęp nagrania"
              aria-valuetext={`${formatNarrationTime(positionMs)} z ${formatNarrationTime(durationMs)}`}
              min={0}
              max={Math.max(durationMs, 1)}
              step={1000}
              value={Math.min(positionMs, Math.max(durationMs, 1))}
              onChange={(event) => seek(Number(event.target.value))}
              className="h-2 w-full accent-slate-900"
            />
            <span className="block text-[11px] tabular-nums text-slate-600" aria-hidden="true">
              {formatNarrationTime(positionMs)} / {formatNarrationTime(durationMs)}
            </span>
          </div>
          <NarrationProgressRing positionMs={positionMs} durationMs={durationMs} />
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
          ref={transcriptButtonRef}
          type="button"
          onClick={toggleTranscript}
          aria-expanded={transcriptOpen}
          aria-controls={transcriptOpen ? TRANSCRIPT_TOGGLE_ID : undefined}
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

const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Dekoracyjny pierścień postępu (feat/player-portrait, telefon w pionie) - aria-hidden, BEZ interakcji (przewijanie
// zostaje na współdzielonym <input type="range"> wyżej, patrz komentarz nad komponentem). Chowany/pokazywany
// wyłącznie CSS-em (.narration-progress-ring, globals.css) - renderuje się ZAWSZE, żeby przełączenie nie było
// zależne od JS matchMedia (ten sam wzorzec co .player-frame).
function NarrationProgressRing({ positionMs, durationMs }: { positionMs: number; durationMs: number }) {
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  return (
    <div className="narration-progress-ring shrink-0 items-center justify-center" aria-hidden="true" data-testid="narration-progress-ring">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={RING_RADIUS} fill="none" className="stroke-slate-200" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          className="stroke-indigo-700"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          transform="rotate(-90 20 20)"
        />
      </svg>
    </div>
  );
}
