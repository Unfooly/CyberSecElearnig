'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ClosedCaption, Pause, Play, Volume1, Volume2, VolumeOff, VolumeX } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import type { NarrationBarState } from './useNarrationBar';
import { useOverlayLayer } from './overlay-stack';

// Pasek narracji, jeden komponent dla WSZYSTKICH breakpointów (D-078: bez osobnego pliku na telefon w pionie) - jeden rząd w kolejności
// z makiety szablonu (D-162): [Odtwórz] [CC] [głośnik] [napisy]. CC włącza i wyłącza linijkę napisów; głośnik otwiera okienko z suwakiem
// głośności i „Wycisz lektora” (decyzja właściciela: zamiast panelu „Transkrypcja” i przełącznika „Lektor”). Wstecz/Dalej dokłada
// PlayerStage. Pasek węższy niż 640 px (fix/mobile-player-bar, container query `pbar` w globals.css - szerokość sceny, nie viewportu):
// korzeń i grupa napisów mają `display: contents` (klasa pbar-contents), więc przyciski stają się elementami rzędu paska PlayerStage:
// [Odtwórz] [CC] [głośnik] ... [Wstecz] [Dalej]; linijka napisów (pbar-caption) przechodzi na osobny wiersz NAD przyciskami.

// Kolory przycisków CC i głośnika jak na makiecie szablonu: włączony - jasny fiolet, wyłączony - biały.
const ON = 'border-[#CFC9F5] bg-accent-soft text-accent-ink';
const OFF = 'border-border bg-white text-slate-600';

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
  const { audioRef, audioUrl, playing, hasAudio, loadFailed, autoplayBlocked, showCaption, active, captionsOn, toggleCaptions, volume, setVolume, togglePlay, onPlay, onPause, onEnded, onTimeUpdate, onError } = state;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Nowy blok (inna narracja albo jej brak) zamyka okienko - inaczej niewidoczna warstwa blokowałaby skróty i pierwszy Escape.
  useEffect(() => setVolumeOpen(false), [narration]);
  // Escape (jedyny nasłuch w PlayerStage, overlay-stack) zamyka okienko i oddaje fokus ikonie.
  useOverlayLayer('volume', volumeOpen && Boolean(narration), () => {
    setVolumeOpen(false);
    volumeButtonRef.current?.focus();
  });
  // iOS Safari: `volume` elementu audio jest tylko do odczytu (głośność - przyciskami telefonu), więc suwak by nic nie robił.
  const [volumeAdjustable, setVolumeAdjustable] = useState(true);
  useEffect(() => {
    try {
      const probe = document.createElement('audio');
      probe.volume = 0.5;
      setVolumeAdjustable(probe.volume === 0.5);
    } catch {
      setVolumeAdjustable(false);
    }
  }, []);

  // Klik poza okienkiem (i poza ikoną) zamyka je.
  useEffect(() => {
    if (!volumeOpen) return undefined;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || volumeButtonRef.current?.contains(target)) return;
      setVolumeOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [volumeOpen]);

  if (!narration) return null;

  // Bez nagrania (lektor wyciszony, błąd ładowania, blok bez pliku) przy włączonych napisach - cały tekst narracji w miejscu napisów
  // (D-162, decyzja właściciela: tekstowa alternatywa nagrania, WCAG 1.2.1). Zawija się do 2 linijek (więcej zabierałoby wysokość scenie
  // na telefonie), dłuższy przewija się w środku - bez wielokropka (na telefonie `title` jest nieosiągalny, a ucięty tekst nie byłby
  // alternatywą).
  const fallbackText = !hasAudio && captionsOn && !textOnScreen ? narration.text : null;
  const hasMessage = Boolean(toggleError) || autoplayBlocked || (enabled && loadFailed && !fallbackText);
  const percent = Math.round(volume * 100);
  const VolumeIcon = !enabled ? VolumeOff : volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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

      <button
        type="button"
        onClick={toggleCaptions}
        aria-pressed={captionsOn}
        aria-label="Napisy"
        title={captionsOn ? 'Napisy włączone' : 'Napisy wyłączone'}
        className={`pbar-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border ${captionsOn ? ON : OFF}`}
      >
        <ClosedCaption aria-hidden="true" className="h-5 w-5" />
      </button>

      <div className="pbar-volume relative shrink-0">
        <button
          ref={volumeButtonRef}
          type="button"
          onClick={() => setVolumeOpen((open) => !open)}
          aria-expanded={volumeOpen}
          aria-controls={volumeOpen ? panelId : undefined}
          aria-label={enabled ? `Głośność lektora: ${percent}%` : 'Lektor wyciszony'}
          title={enabled ? `Głośność lektora: ${percent}%` : 'Lektor wyciszony'}
          className={`pbar-icon inline-flex h-11 w-11 items-center justify-center rounded-[10px] border ${enabled ? ON : OFF}`}
        >
          <VolumeIcon aria-hidden="true" className="h-5 w-5" />
        </button>
        {volumeOpen && (
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label="Głośność lektora"
            data-testid="volume-panel"
            // Zaczepione o lewy brzeg głośnika (makieta: okienko nad nim, w prawo) - na wąskim pasku o lewy brzeg paska (globals.css).
            className="pbar-volume-panel absolute bottom-full left-0 z-30 mb-2 flex w-56 flex-col gap-3 rounded-xl border border-border bg-white p-3 shadow-lg"
          >
            {volumeAdjustable ? (
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                <span className="flex justify-between">
                  <span>Głośność</span>
                  {/* Wartość ogłasza aria-valuetext suwaka - tu tylko dla oka (inaczej nazwa suwaka zmieniałaby się z wartością). */}
                  <span aria-hidden="true" className="tabular-nums text-slate-500">
                    {percent}%
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={percent}
                  onChange={(event) => setVolume(Number(event.target.value) / 100)}
                  aria-valuetext={`${percent}%`}
                  disabled={!enabled}
                  className="h-11 w-full accent-accent disabled:opacity-50"
                />
              </label>
            ) : (
              <p className="text-sm text-slate-600">Głośność ustawisz przyciskami urządzenia.</p>
            )}
            {/* Stała etykieta + aria-pressed (wciśnięty = lektor wyciszony) - bez sprzeczności „Włącz…, wciśnięty”. */}
            <button
              type="button"
              aria-pressed={!enabled}
              onClick={onToggleEnabled}
              disabled={togglePending}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border px-3 text-sm font-semibold disabled:opacity-60 ${
                enabled ? 'border-border bg-white text-ink hover:bg-paper' : ON
              }`}
            >
              <VolumeOff aria-hidden="true" className="h-4 w-4" />
              Wycisz lektora
            </button>
          </div>
        )}
      </div>

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
