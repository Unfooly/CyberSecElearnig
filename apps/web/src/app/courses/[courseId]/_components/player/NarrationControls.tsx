'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ClosedCaption, Volume1, Volume2, VolumeOff, VolumeX } from 'lucide-react';
import type { NarrationBarState } from './useNarrationBar';
import { useOverlayLayer } from './overlay-stack';

// Przyciski CC i głośnika z okienkiem głośności (D-162) - wspólne dla dolnego paska (NarrationBar) i ekranu startu modułu (D-163), żeby
// oba miejsca zmieniały te same ustawienia gracza (napisy i głośność w przeglądarce, „Wycisz lektora” na koncie).

// Kolory przycisków CC i głośnika jak na makiecie szablonu: włączony - jasny fiolet, wyłączony - biały.
export const ON = 'border-[#CFC9F5] bg-accent-soft text-accent-ink';
const OFF = 'border-border bg-white text-slate-600';

export default function NarrationControls({
  state,
  enabled,
  onToggleEnabled,
  togglePending = false,
  resetKey,
  placement = 'up',
}: {
  state: Pick<NarrationBarState, 'captionsOn' | 'toggleCaptions' | 'volume' | 'setVolume'>;
  enabled: boolean;
  onToggleEnabled: () => void;
  togglePending?: boolean;
  /** Zmiana (np. narracja nowego bloku) zamyka okienko - inaczej niewidoczna warstwa blokowałaby skróty i pierwszy Escape. */
  resetKey?: unknown;
  /** Okienko nad przyciskiem (dolny pasek) albo `auto` - pod nim, gdy pod spodem jest miejsce (ekran startu: nad przyciskiem jest tekst),
      inaczej nad nim (niski ekran, karta na telefonie). */
  placement?: 'up' | 'auto';
}) {
  const { captionsOn, toggleCaptions, volume, setVolume } = state;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [openDown, setOpenDown] = useState(false);
  const toggleVolume = () => {
    if (!volumeOpen && placement === 'auto') {
      // Okienko ma ok. 150 px (suwak + „Wycisz lektora”) - z zapasem na odstęp i cień.
      const bottom = volumeButtonRef.current?.getBoundingClientRect().bottom ?? 0;
      setOpenDown(window.innerHeight - bottom >= 180);
    }
    setVolumeOpen((open) => !open);
  };
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => setVolumeOpen(false), [resetKey]);
  // Escape (jeden nasłuch w ramce, overlay-stack) zamyka okienko i oddaje fokus ikonie.
  useOverlayLayer('volume', volumeOpen, () => {
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

  const percent = Math.round(volume * 100);
  const VolumeIcon = !enabled ? VolumeOff : volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
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
          onClick={toggleVolume}
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
            className={`pbar-volume-panel absolute left-0 z-30 flex w-56 flex-col gap-3 rounded-xl border border-border bg-white p-3 shadow-lg ${
              openDown ? 'top-full mt-2' : 'bottom-full mb-2'
            }`}
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
    </>
  );
}
