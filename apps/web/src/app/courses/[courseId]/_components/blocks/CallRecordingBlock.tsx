'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, Flag, Pause, Play, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { MAX_RECORDING_TAPS, recordingTimeline, segmentAt } from '@cyberszkolo/content';
import type { ContentBlock, ContentReaction, RecordingFlagCategory, RecordingTap, ResultDetail } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

// Odsłuch nagrania rozmowy (CALL_RECORDING, D-115). Gracz słucha (fala z pozycją, odtwórz/pauza, ±5 s) i stuka „Czerwona flaga” w chwili
// manipulacji (`{ atMs }`), albo zaznacza kwestie w transkrypcji (`{ segmentId }`) - alternatywa dostępności i jedyny tryb, gdy nagranie
// nie ma jeszcze plików (przed potokiem TTS) albo się nie wczytało. Klient NIE zna flag: wysyła same tapnięcia, ocena i rozstrzygnięcie
// (które kwestie były flagami, kategorie) przychodzą z serwera (ResultDetail.flags). Chrome (paski, notatnik, narracja) daje PlayerStage.
// Klawiatura: Spacja - odtwórz/pauza, strzałki - ±5 s, F - czerwona flaga (Enter na przycisku flagi).

export const FLAG_CATEGORY_LABEL: Record<RecordingFlagCategory, string> = {
  urgency: 'Pośpiech',
  authority: 'Autorytet',
  fear: 'Strach',
  code_request: 'Prośba o kod',
  install_request: 'Prośba o instalację',
};

const SEEK_MS = 5000;
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const BAR_COUNT = 72;

export interface CallRecordingResult {
  answer?: { taps: RecordingTap[] };
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  reaction?: ContentReaction;
}

type Mode = 'listen' | 'transcript';

/** Deterministyczne wysokości słupków fali (bez prawdziwej analizy dźwięku - wizualizacja pozycji, nie treść). */
function barHeights(seed: string): number[] {
  let state = 0;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: BAR_COUNT }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return 0.25 + ((state >>> 8) % 1000) / 1333;
  });
}

const formatTime = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function CallRecordingBlock({
  block,
  contentBase,
  onSubmit,
  disabled = false,
  result,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit?: (answer: { taps: RecordingTap[] }) => void;
  disabled?: boolean;
  /** Ustawione = widok wyniku (zaraz po zapisie albo podgląd „Wstecz”). */
  result?: CallRecordingResult;
}) {
  const segments = useMemo(() => block.segments ?? [], [block.segments]);
  const timeline = useMemo(() => recordingTimeline(segments), [segments]);
  const urls = useMemo(() => segments.map((segment) => contentAssetUrl(contentBase, segment.narration.audioUrl, 'audio')), [segments, contentBase]);
  const canListen = timeline !== null && urls.every((url) => url !== null);
  const reducedMotion = usePrefersReducedMotion();

  const [audioFailed, setAudioFailed] = useState(false);
  const listenAvailable = canListen && !audioFailed;
  const [mode, setMode] = useState<Mode>(listenAvailable ? 'listen' : 'transcript');
  const [taps, setTaps] = useState<RecordingTap[]>([]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [announce, setAnnounce] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentIndexRef = useRef<number | null>(null);
  const gapRef = useRef<{ timer: number; startedAt: number; from: number } | null>(null);
  const positionRef = useRef(0);
  const playingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const totalMs = timeline?.totalMs ?? 0;
  const bars = useMemo(() => barHeights(block.id ?? 'nagranie'), [block.id]);

  useEffect(() => {
    if (!listenAvailable && mode === 'listen') setMode('transcript');
  }, [listenAvailable, mode]);

  const setPos = useCallback((ms: number) => {
    positionRef.current = ms;
    setPosition(ms);
  }, []);

  const clearGap = () => {
    if (gapRef.current) window.clearTimeout(gapRef.current.timer);
    gapRef.current = null;
  };

  const stop = useCallback((atEnd: boolean) => {
    clearGap();
    audioRef.current?.pause();
    playingRef.current = false;
    setPlaying(false);
    if (atEnd) {
      setReachedEnd(true);
      setPos(totalMs);
    }
  }, [setPos, totalMs]);

  // Nagranie się nie wczytało (brak pliku, błąd sieci): stop (bez pętli pozycji i timerów ciszy) i tryb transkrypcji.
  const fail = useCallback(() => {
    stop(false);
    setAudioFailed(true);
  }, [stop]);

  // Odtwarzanie od pozycji `ms`: segment -> jego plik od przesunięcia; cisza po segmencie -> odliczanie do następnego segmentu.
  const playFrom = useCallback(
    (ms: number) => {
      if (!timeline) return;
      clearGap();
      const segment = segmentAt(timeline, ms);
      if (!segment) {
        stop(true);
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      if (ms <= segment.endMs) {
        const url = urls[segment.index];
        if (!url) return;
        if (segmentIndexRef.current !== segment.index || !audio.src.endsWith(url)) {
          audio.src = url;
          segmentIndexRef.current = segment.index;
        }
        const offset = Math.max(0, (ms - segment.startMs) / 1000);
        // Przed wczytaniem metadanych (preload="none", nowy plik) część przeglądarek ignoruje currentTime - ustawiamy go po loadedmetadata.
        if (audio.readyState < 1) pendingSeekRef.current = offset;
        else audio.currentTime = offset;
        // AbortError = play() przerwane pauzą, przewinięciem na inny segment albo zmianą trybu - to nie awaria nagrania.
        audio.play().catch((error: unknown) => {
          if ((error as { name?: string } | null)?.name !== 'AbortError') fail();
        });
      } else {
        audio.pause();
        const next = timeline.segments[segment.index + 1];
        if (!next) {
          stop(true);
          return;
        }
        gapRef.current = { startedAt: performance.now(), from: ms, timer: window.setTimeout(() => playFrom(next.startMs), next.startMs - ms) };
      }
      playingRef.current = true;
      setPlaying(true);
      setPos(ms);
    },
    [timeline, urls, stop, fail, setPos],
  );

  // Pozycja w czasie odtwarzania: z pliku bieżącego segmentu albo z zegara w ciszy między segmentami.
  useEffect(() => {
    if (!playing || !timeline) return undefined;
    const tick = () => {
      const gap = gapRef.current;
      const audio = audioRef.current;
      const index = segmentIndexRef.current;
      if (gap) setPos(Math.min(totalMs, gap.from + (performance.now() - gap.startedAt)));
      // Przewinięcie czeka na metadane (currentTime jeszcze 0) - pozycja zostaje, bez skoku suwaka na początek segmentu.
      else if (audio && index !== null && pendingSeekRef.current === null) {
        const segment = timeline.segments[index];
        setPos(Math.min(segment.endMs, segment.startMs + audio.currentTime * 1000));
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [playing, timeline, totalMs, setPos]);

  useEffect(
    () => () => {
      clearGap();
      audioRef.current?.pause();
    },
    [],
  );

  function onEnded() {
    const index = segmentIndexRef.current;
    if (!timeline || index === null) return;
    const segment = timeline.segments[index];
    const next = timeline.segments[index + 1];
    if (!next) {
      stop(true);
      return;
    }
    // Koniec pliku = koniec segmentu (długość z potoku); cisza po nim odliczana zegarem.
    playFrom(Math.max(segment.endMs + 1, positionRef.current));
  }

  function togglePlay() {
    if (!listenAvailable) return;
    if (playingRef.current) {
      stop(false);
      return;
    }
    playFrom(positionRef.current >= totalMs ? 0 : positionRef.current);
  }

  function seek(ms: number) {
    const target = Math.max(0, Math.min(totalMs, ms));
    if (playingRef.current) playFrom(target);
    else setPos(target);
  }

  function flagNow() {
    if (!listenAvailable || disabled) return;
    if (taps.length >= MAX_RECORDING_TAPS) {
      setAnnounce('Osiągnięto limit flag - cofnij którąś albo sprawdź flagi.');
      return;
    }
    const atMs = Math.round(positionRef.current);
    setTaps((current) => (current.length >= MAX_RECORDING_TAPS ? current : [...current, { atMs }]));
    setAnnounce(`Czerwona flaga w ${formatTime(atMs)}.`);
  }

  function toggleSegmentFlag(segmentId: string) {
    const exists = taps.some((tap) => 'segmentId' in tap && tap.segmentId === segmentId);
    if (!exists && taps.length >= MAX_RECORDING_TAPS) {
      setAnnounce('Osiągnięto limit flag - cofnij którąś albo sprawdź flagi.');
      return;
    }
    setTaps((current) => (exists ? current.filter((tap) => !('segmentId' in tap && tap.segmentId === segmentId)) : [...current, { segmentId }]));
    setAnnounce(exists ? 'Flaga zdjęta.' : 'Czerwona flaga przy kwestii.');
  }

  function undoLast() {
    setTaps((current) => current.slice(0, -1));
    setAnnounce('Ostatnia flaga cofnięta.');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (result || mode !== 'listen') return;
    const target = event.target as HTMLElement;
    // Zakładki trybu mają własną obsługę strzałek (przełączanie), pola tekstowe - własną klawiaturę.
    if (target.closest('input, textarea, select, [role="tab"]')) return;
    const onButton = target.closest('button') !== null;
    const onSlider = target.closest('[role="slider"]') !== null;
    if (event.key === ' ' && !onButton) {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seek(positionRef.current + (event.key === 'ArrowLeft' ? -SEEK_MS : SEEK_MS));
    } else if (onSlider && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      seek(event.key === 'Home' ? 0 : totalMs);
    } else if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      // Przytrzymany klawisz (autorepetycja) nie sypie serią flag.
      if (!event.repeat) flagNow();
    }
  }

  function onWavePointer(event: PointerEvent<HTMLDivElement>) {
    if (!listenAvailable || result) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seek(((event.clientX - rect.left) / rect.width) * totalMs);
  }

  const currentSegment = timeline ? segmentAt(timeline, position) : null;
  const caption = currentSegment ? segments[currentSegment.index] : null;
  const segmentFlagged = (id: string) => taps.some((tap) => 'segmentId' in tap && tap.segmentId === id);
  const timeTaps = taps.filter((tap): tap is { atMs: number } => 'atMs' in tap);
  const canSubmit = !disabled && !result && (taps.length > 0 || reachedEnd);

  if (result) return <RecordingResult block={block} result={result} />;

  return (
    <div data-testid="call-recording" onKeyDown={onKeyDown} className="flex min-h-0 w-full flex-1 flex-col">
      {/* Transkrypcja i napisy są w bloku (tryb transkrypcji, napis bieżącej kwestii). */}
      <audio
        ref={audioRef}
        preload="none"
        hidden
        onEnded={onEnded}
        onLoadedMetadata={(event) => {
          if (pendingSeekRef.current !== null) event.currentTarget.currentTime = pendingSeekRef.current;
          pendingSeekRef.current = null;
        }}
        onError={() => {
          if (segmentIndexRef.current !== null) fail();
        }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <div className="mx-auto mb-3 flex w-full max-w-[760px] shrink-0 gap-2" role="tablist" aria-label="Tryb odsłuchu">
        <ModeTab active={mode === 'listen'} disabled={!listenAvailable} onClick={() => setMode('listen')} label="Odsłuch" />
        <ModeTab
          active={mode === 'transcript'}
          onClick={() => {
            stop(false);
            setMode('transcript');
          }}
          label="Transkrypcja"
        />
      </div>

      {mode === 'listen' ? (
        <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-3 overflow-y-auto">
          <div className="rounded-card border border-border bg-surface p-4 shadow-card">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Pozycja w nagraniu"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalMs / 1000)}
              aria-valuenow={Math.round(position / 1000)}
              aria-valuetext={`${formatTime(position)} z ${formatTime(totalMs)}`}
              data-testid="recording-wave"
              onPointerDown={onWavePointer}
              className={`relative flex h-16 cursor-pointer items-center gap-[2px] rounded ${FOCUS_RING}`}
            >
              {bars.map((height, index) => {
                const played = totalMs > 0 && (index + 0.5) / BAR_COUNT <= position / totalMs;
                return (
                  <span
                    key={index}
                    aria-hidden="true"
                    className={`flex-1 rounded-sm ${played ? 'bg-accent' : 'bg-slate-300'}`}
                    style={{ height: `${Math.round(height * 100)}%` }}
                  />
                );
              })}
              {timeTaps.map((tap, index) => (
                <span
                  key={`${tap.atMs}-${index}`}
                  aria-hidden="true"
                  data-testid="recording-tap-marker"
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-600"
                  style={{ left: `${totalMs > 0 ? (tap.atMs / totalMs) * 100 : 0}%` }}
                />
              ))}
              {!reducedMotion && playing && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-ink/70" style={{ left: `${totalMs > 0 ? (position / totalMs) * 100 : 0}%` }} />
              )}
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{formatTime(position)}</span>
              <span>{formatTime(totalMs)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <IconButton label="Cofnij o 5 sekund" onClick={() => seek(position - SEEK_MS)}>
                <RotateCcw aria-hidden="true" className="h-5 w-5" />
              </IconButton>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Wstrzymaj nagranie' : 'Odtwórz nagranie'}
                data-testid="recording-play"
                className={`flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-card hover:bg-accent-hover ${FOCUS_RING}`}
              >
                {playing ? <Pause aria-hidden="true" className="h-6 w-6" /> : <Play aria-hidden="true" className="h-6 w-6 translate-x-0.5" />}
              </button>
              <IconButton label="Przewiń o 5 sekund" onClick={() => seek(position + SEEK_MS)}>
                <RotateCw aria-hidden="true" className="h-5 w-5" />
              </IconButton>
            </div>
          </div>

          <div aria-hidden="true" data-testid="recording-caption" className="min-h-[3.5rem] rounded-card border border-border bg-paper px-4 py-2 text-ink">
            {caption ? (
              <>
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{caption.speaker}</span>
                <span>{caption.narration.text}</span>
              </>
            ) : (
              <span className="text-sm text-muted">Odtwórz nagranie. Napisy bieżącej kwestii pojawią się tutaj.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={flagNow}
              disabled={disabled || taps.length >= MAX_RECORDING_TAPS}
              data-testid="recording-flag"
              aria-keyshortcuts="F"
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-btn bg-red-600 px-4 font-bold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS_RING}`}
            >
              <Flag aria-hidden="true" className="h-5 w-5" />
              Czerwona flaga
            </button>
            <button
              type="button"
              onClick={undoLast}
              disabled={taps.length === 0 || disabled}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-btn border border-border bg-surface px-3 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40 ${FOCUS_RING}`}
            >
              <Undo2 aria-hidden="true" className="h-4 w-4" />
              Cofnij flagę
            </button>
          </div>
          <p className="text-sm text-muted">
            Flagi: <span className="font-semibold text-ink">{taps.length}</span>. Spacja - odtwórz/pauza, strzałki - ±5 s, F - czerwona flaga.
          </p>
        </div>
      ) : (
        <div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-y-auto" data-testid="recording-transcript">
          {!listenAvailable && (
            <p className="mb-3 rounded-card border border-border bg-paper px-3 py-2 text-sm text-muted">
              {canListen ? 'Nagranie nie wczytało się - zaznacz manipulacje w transkrypcji.' : 'Zaznacz w transkrypcji kwestie, w których rozmówca manipuluje.'}
            </p>
          )}
          {timeTaps.length > 0 && (
            <p data-testid="recording-time-taps" className="mb-3 text-sm text-muted">
              Flagi z odsłuchu: <span className="font-semibold text-ink">{timeTaps.length}</span> - zostaną sprawdzone razem z zaznaczonymi tutaj.
            </p>
          )}
          <ol className="flex flex-col gap-2 pb-1">
            {segments.map((segment) => {
              const flagged = segmentFlagged(segment.id);
              return (
                <li key={segment.id} className="flex items-start gap-2">
                  <p className={`min-w-0 flex-1 break-words rounded-card border px-3 py-2 text-ink shadow-card ${flagged ? 'border-red-400 bg-red-50' : 'border-border bg-surface'}`}>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{segment.speaker}</span>
                    {segment.narration.text}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleSegmentFlag(segment.id)}
                    disabled={disabled}
                    aria-pressed={flagged}
                    aria-label={`Czerwona flaga: ${segment.speaker}, ${segment.narration.text}`}
                    data-testid={`recording-segment-flag-${segment.id}`}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-btn border ${flagged ? 'border-red-600 bg-red-600 text-white' : 'border-border bg-surface text-red-600 hover:bg-red-50'} ${FOCUS_RING}`}
                  >
                    <Flag aria-hidden="true" className="h-5 w-5" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mx-auto mt-3 w-full max-w-[760px] shrink-0">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit?.({ taps })}
          data-testid="recording-submit"
          className={`min-h-[44px] w-full rounded-btn bg-accent px-4 font-bold text-white hover:bg-accent-hover disabled:opacity-50 ${FOCUS_RING}`}
        >
          Sprawdź flagi
        </button>
      </div>
    </div>
  );
}

function ModeTab({ active, disabled = false, onClick, label }: { active: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] flex-1 rounded-btn border px-4 text-sm font-semibold disabled:opacity-40 ${FOCUS_RING} ${
        active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-border bg-surface text-ink hover:bg-paper'
      }`}
    >
      {label}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-ink hover:bg-paper ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}

/** Rozstrzygnięcie z serwera: każda kwestia, przy flagach - kategoria i czy gracz ją trafił; liczba fałszywych alarmów i wynik. */
function RecordingResult({ block, result }: { block: ContentBlock; result: CallRecordingResult }) {
  const flags = new Map((result.detail?.flags ?? []).map((flag) => [flag.segmentId, flag]));
  const total = result.detail?.flags?.length ?? 0;
  const hits = (result.detail?.flags ?? []).filter((flag) => flag.hit).length;
  const falseTaps = result.detail?.falseTaps ?? 0;
  return (
    <div data-testid="call-recording-result" className="flex min-h-0 w-full flex-1 flex-col">
      <div className="mx-auto mb-3 w-full max-w-[760px] shrink-0 rounded-card border border-border bg-surface px-4 py-3 shadow-card" role="status">
        <p className="font-semibold text-ink">
          Trafione flagi: {hits}/{total} · Fałszywe alarmy: {falseTaps}
          {typeof result.points === 'number' && <> · Wynik: {Math.round(result.points * 100)}%</>}
        </p>
        {result.reaction?.text && <p className="mt-1 text-sm text-muted">{result.reaction.text}</p>}
      </div>
      <ol className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-2 overflow-y-auto pb-1">
        {(block.segments ?? []).map((segment) => {
          const flag = flags.get(segment.id);
          return (
            <li
              key={segment.id}
              data-testid={`recording-result-${segment.id}`}
              data-flag={flag ? (flag.hit ? 'hit' : 'missed') : 'none'}
              className={`rounded-card border px-3 py-2 text-ink shadow-card ${
                flag ? (flag.hit ? 'border-green-600 bg-green-50' : 'border-amber-500 bg-amber-50') : 'border-border bg-surface'
              }`}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{segment.speaker}</span>
              <span className="break-words">{segment.narration.text}</span>
              {flag && (
                <span className={`mt-1 flex items-center gap-1 text-sm font-semibold ${flag.hit ? 'text-green-800' : 'text-amber-800'}`}>
                  {flag.hit ? <Check aria-hidden="true" className="h-4 w-4" /> : <Flag aria-hidden="true" className="h-4 w-4" />}
                  {flag.hit ? 'Wyłapana manipulacja' : 'Przeoczona manipulacja'}: {FLAG_CATEGORY_LABEL[flag.category] ?? flag.category}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
