'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { Narration } from '@cyberszkolo/content';
import { contentAssetUrl } from '@/lib/content-assets';
import { activeCaptionIndex, buildCaptions } from '@/lib/narration-captions';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

// Odtwarzacz narracji bloku (dół powłoki), maksymalnie DWA rzędy:
//  rząd 1: play, suwak, czas i przełącznik "Lektor" (role="switch": stała nazwa, stan w aria-checked);
//  rząd 2: bieżące zdanie w jednej linii (długie przewija się w czasie razem z nagraniem) i link "Transkrypcja".
// Blok bez narracji nie renderuje nic (znika cały rząd, zostaje tylko nawigacja). Wybór lektora zapisuje się na koncie
// (useNarrationPreference). Adres nagrania powstaje z bazy i ścieżki względnej z treści (contentAssetUrl); niepoprawna ścieżka = brak
// nagrania, tylko tekst.
export default function NarrationPlayer({
  narration,
  contentBase,
  enabled,
  onToggleEnabled,
  togglePending = false,
  toggleError = null,
  autoPlay = false,
}: {
  narration?: Narration;
  contentBase: string;
  enabled: boolean;
  onToggleEnabled: () => void;
  togglePending?: boolean;
  toggleError?: string | null;
  /** Rozpocznij odtwarzanie po pojawieniu się bloku (tylko po geście użytkownika; decyzja o tym jest w CoursePlayer). */
  autoPlay?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const captionBoxRef = useRef<HTMLDivElement>(null);
  const captionTextRef = useRef<HTMLSpanElement>(null);
  // Autostart tylko RAZ dla danego bloku (komponent jest montowany per blok): ponowne włączenie lektora nie restartuje nagrania.
  const autoStarted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [captionShift, setCaptionShift] = useState(0);

  const audioUrl = useMemo(() => contentAssetUrl(contentBase, narration?.audioUrl, 'audio'), [contentBase, narration?.audioUrl]);
  const captions = useMemo(() => (narration ? buildCaptions(narration) : []), [narration]);
  const durationMs = narration?.durationMs ?? 0;
  const hasAudio = enabled && audioUrl !== null && !loadFailed;
  const activeIndex = activeCaptionIndex(captions, positionMs);
  const showCaption = hasAudio && activeIndex >= 0;

  // Odrzucone play(): AbortError (pause() przerwało oczekujące play(), np. szybkie Odtwórz i Wstrzymaj) to nie błąd; NotAllowedError to
  // blokada autoodtwarzania przez przeglądarkę (zostaje przycisk); reszta (np. NotSupportedError) to nagranie nie do odtworzenia.
  function handlePlayError(error: unknown) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'AbortError') return;
    if (name === 'NotAllowedError') setAutoplayBlocked(true);
    else setLoadFailed(true);
  }

  useEffect(() => {
    if (!autoPlay || !hasAudio || autoStarted.current || !audioRef.current) return;
    autoStarted.current = true;
    setAutoplayBlocked(false);
    audioRef.current.play().catch(handlePlayError);
  }, [autoPlay, hasAudio]);

  // Wyłączenie lektora w trakcie odtwarzania zatrzymuje nagranie (element audio znika z DOM, a stan wraca do "wstrzymane"). Pozycję zerujemy:
  // po ponownym włączeniu powstaje nowy element audio od 0 s, więc suwak i napis nie mogą pokazywać starej pozycji.
  useEffect(() => {
    if (!enabled) {
      audioRef.current?.pause();
      setPlaying(false);
      setPositionMs(0);
    }
  }, [enabled]);

  // Długie zdanie w jednej linii przesuwa się w czasie: wysunięcie proporcjonalne do postępu w obrębie bieżącego napisu. Mierzymy element
  // z overflow-hidden BEZ paddingu (padding jest na zewnętrznym kontenerze), więc scrollWidth - clientWidth to dokładna nadwyżka tekstu.
  const active = activeIndex >= 0 ? captions[activeIndex] : null;
  const activeStart = active?.startMs ?? null;
  const nextStart = activeIndex >= 0 && activeIndex + 1 < captions.length ? captions[activeIndex + 1].startMs : durationMs;
  const measureCaption = useCallback(() => {
    const box = captionBoxRef.current;
    const text = captionTextRef.current;
    if (!box || !text || activeStart === null || nextStart === null) {
      setCaptionShift(0);
      return;
    }
    const overflow = Math.max(0, text.scrollWidth - box.clientWidth);
    const span = Math.max(1, nextStart - activeStart);
    const progress = Math.min(1, Math.max(0, (positionMs - activeStart) / span));
    setCaptionShift(overflow * progress);
  }, [positionMs, activeStart, nextStart]);
  useLayoutEffect(() => {
    measureCaption();
  }, [measureCaption, showCaption, active?.text]);

  // Zmiana szerokości (obrót telefonu, zmiana okna) przelicza przesunięcie także przy zatrzymanym nagraniu. Guard: brak ResizeObserver (jsdom).
  useEffect(() => {
    const box = captionBoxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureCaption());
    observer.observe(box);
    return () => observer.disconnect();
  }, [measureCaption, showCaption]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setAutoplayBlocked(false);
      audio.play().catch(handlePlayError);
    } else {
      audio.pause();
    }
  }

  function seek(value: number) {
    if (audioRef.current) audioRef.current.currentTime = value / 1000;
    setPositionMs(value);
  }

  if (!narration) return null;

  const transcriptId = 'narration-transcript';
  const transcriptButton = (
    <button
      type="button"
      onClick={() => setTranscriptOpen((open) => !open)}
      aria-expanded={transcriptOpen}
      aria-controls={transcriptOpen ? transcriptId : undefined}
      className="inline-flex min-h-[44px] shrink-0 items-center px-2 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
    >
      Transkrypcja
    </button>
  );

  return (
    <section aria-label="Narracja" className="space-y-1">
      <div className="flex items-center gap-2 sm:gap-3">
        {hasAudio && (
          <>
            <audio
              ref={audioRef}
              src={audioUrl ?? undefined}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setPositionMs(durationMs);
              }}
              onTimeUpdate={(event) => setPositionMs(Math.round(event.currentTarget.currentTime * 1000))}
              onError={() => setLoadFailed(true)}
            />
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację'}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700"
            >
              {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5" />}
            </button>
            <input
              type="range"
              aria-label="Postęp nagrania"
              aria-valuetext={`${formatTime(positionMs)} z ${formatTime(durationMs)}`}
              min={0}
              max={Math.max(durationMs, 1)}
              step={1000}
              value={Math.min(positionMs, Math.max(durationMs, 1))}
              onChange={(event) => seek(Number(event.target.value))}
              className="h-11 min-w-[64px] flex-1 accent-slate-900"
            />
            <span className="shrink-0 text-xs tabular-nums text-slate-600" aria-hidden="true">
              {formatTime(positionMs)} / {formatTime(durationMs)}
            </span>
          </>
        )}
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
        {!showCaption && transcriptButton}
      </div>

      {toggleError && (
        <p role="alert" className="text-xs text-red-700">
          {toggleError}
        </p>
      )}
      {autoplayBlocked && <p className="text-xs text-slate-600">Przeglądarka zablokowała autoodtwarzanie. Naciśnij „Odtwórz narrację”.</p>}
      {enabled && loadFailed && <p className="text-xs text-amber-700">Nie udało się załadować nagrania. Tekst narracji jest w transkrypcji.</p>}

      {showCaption && (
        <div className="flex items-center gap-1">
          {/* Padding na zewnętrznym kontenerze; element mierzony (overflow-hidden) go NIE ma, inaczej clientWidth liczyłby padding i tekst
              o szerokości tuż poniżej clientWidth byłby obcięty bez przewijania. */}
          <div className="min-w-0 flex-1 rounded bg-slate-100 px-3 py-2 text-sm text-slate-900">
            <div ref={captionBoxRef} data-testid="caption-box" className="overflow-hidden" aria-live="off">
              <span
                ref={captionTextRef}
                data-testid="caption"
                title={active?.text}
                className="inline-block whitespace-nowrap"
                style={{ transform: `translateX(-${captionShift}px)` }}
              >
                {active?.text}
              </span>
            </div>
          </div>
          {transcriptButton}
        </div>
      )}

      {transcriptOpen && (
        <div id={transcriptId} className="max-h-40 overflow-y-auto rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p className="whitespace-pre-line">{narration.text}</p>
        </div>
      )}
    </section>
  );
}
