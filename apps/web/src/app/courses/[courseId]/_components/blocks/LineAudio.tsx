'use client';

import { useEffect, useRef } from 'react';

// Nagranie, które ani się nie skończyło, ani nie zgłosiło błędu (zawieszone ładowanie): koniec kwestii po jej długości + zapas.
const STALL_FALLBACK_MS = 3000;
const STALL_FALLBACK_NO_DURATION_MS = 20000;

/**
 * Nagranie jednej kwestii postaci (rozmowa na żywo, przesłuchanie - B-135): koniec (albo błąd, albo przeglądarka zablokowała
 * odtwarzanie, albo nagranie utknęło dłużej niż kwestia + zapas) = kwestia wysłuchana. Bez nagrania - od razu. `onDone` najwyżej raz;
 * po odmontowaniu (następna kwestia) - wcale, żeby spóźnione zdarzenie nie ruszyło NOWEJ kwestii.
 */
export default function LineAudio({
  src,
  muted = false,
  durationMs,
  onDone,
  testId,
}: {
  src: string | null;
  muted?: boolean;
  durationMs?: number;
  onDone?: () => void;
  testId: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current?.();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  // Zapas na zawieszone nagranie liczony od montażu i od nowa od startu odtwarzania (`playing`) - wolne ładowanie nie może skończyć
  // kwestii, gdy postać jeszcze mówi.
  const restartFallback = useRef<() => void>(() => {});

  useEffect(() => {
    const audio = audioRef.current;
    if (!src || !audio) {
      finishRef.current();
      return undefined;
    }
    let cancelled = false;
    let fallback = 0;
    const guarded = () => !cancelled && finishRef.current();
    restartFallback.current = () => {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(guarded, (durationMs ?? STALL_FALLBACK_NO_DURATION_MS) + STALL_FALLBACK_MS);
    };
    restartFallback.current();
    const played = audio.play();
    if (played && typeof played.catch === 'function') played.catch(guarded);
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      restartFallback.current = () => {};
      audio.pause();
    };
  }, [src, durationMs]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  if (!src) return null;
  return <audio ref={audioRef} data-testid={testId} src={src} preload="auto" hidden onPlaying={() => restartFallback.current()} onEnded={() => finish()} onError={() => finish()} />;
}
