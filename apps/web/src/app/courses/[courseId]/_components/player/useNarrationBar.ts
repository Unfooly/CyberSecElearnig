import { useEffect, useMemo, useRef, useState } from 'react';
import type { Narration } from '@cyberszkolo/content';
import { contentAssetUrl } from '@/lib/content-assets';
import { activeCaptionIndex, buildCaptions, type Caption } from '@/lib/narration-captions';

// Logika odtwarzania narracji bloku (bez prezentacji - to NarrationBar.tsx dla desktopu/tabletu/telefonu w poziomie
// i NarrationBarPortrait.tsx dla telefonu w pionie, PR B). Wydzielone z dawnego NarrationPlayer.tsx (usunięty w
// feat/player-stage), żeby DWIE różne prezentacje (liniowy pasek postępu vs okrągły wskaźnik) dzieliły JEDNĄ logikę
// audio/napisów/transkrypcji, zamiast duplikować ją albo trzymać w jednym komponencie z gałęziami na orientację.
export interface NarrationBarState {
  audioRef: React.RefObject<HTMLAudioElement>;
  audioUrl: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Nagranie istnieje, lektor włączony i się załadowało (nie loadFailed). */
  hasAudio: boolean;
  loadFailed: boolean;
  autoplayBlocked: boolean;
  captions: Caption[];
  activeIndex: number;
  /** hasAudio && jest aktywny napis - ten sam warunek co w dawnym NarrationPlayer, dla dwóch prezentacji. */
  showCaption: boolean;
  active: Caption | null;
  transcriptOpen: boolean;
  toggleTranscript: () => void;
  togglePlay: () => void;
  seek: (valueMs: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onTimeUpdate: (currentTimeSeconds: number) => void;
  onError: () => void;
}

export function useNarrationBar({
  narration,
  contentBase,
  enabled,
  autoPlay = false,
  resetKey,
}: {
  narration?: Narration;
  contentBase: string;
  enabled: boolean;
  /** Rozpocznij odtwarzanie po pojawieniu się bloku (tylko po geście użytkownika; decyzja o tym jest w CoursePlayer). */
  autoPlay?: boolean;
  /** Zmiana wartości resetuje CAŁY stan poniżej (nowy blok/wynik) - hook żyje przez cały czas trwania CoursePlayer
      (nie montuje się na nowo per blok jak dawny NarrationPlayer), więc bez tego stan (pozycja, odtwarzanie,
      otwarta transkrypcja) przeciekałby z poprzedniego bloku do następnego. */
  resetKey: string;
}): NarrationBarState {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Autostart tylko RAZ dla danego bloku: ponowne włączenie lektora nie restartuje nagrania (resetuje się razem z
  // resztą stanu poniżej przy zmianie resetKey).
  const autoStarted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    autoStarted.current = false;
    setPlaying(false);
    setPositionMs(0);
    setLoadFailed(false);
    setAutoplayBlocked(false);
    setTranscriptOpen(false);
  }, [resetKey]);

  const audioUrl = useMemo(() => contentAssetUrl(contentBase, narration?.audioUrl, 'audio'), [contentBase, narration?.audioUrl]);
  const captions = useMemo(() => (narration ? buildCaptions(narration) : []), [narration]);
  const durationMs = narration?.durationMs ?? 0;
  const hasAudio = enabled && audioUrl !== null && !loadFailed;
  const activeIndex = activeCaptionIndex(captions, positionMs);
  const showCaption = hasAudio && activeIndex >= 0;
  const active = activeIndex >= 0 ? captions[activeIndex] : null;

  // Odrzucone play(): AbortError (pause() przerwało oczekujące play(), np. szybkie Odtwórz i Wstrzymaj) to nie
  // błąd; NotAllowedError to blokada autoodtwarzania przez przeglądarkę (zostaje przycisk); reszta (np.
  // NotSupportedError) to nagranie nie do odtworzenia.
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

  // Wyłączenie lektora w trakcie odtwarzania zatrzymuje nagranie (element audio znika z DOM, a stan wraca do
  // "wstrzymane"). Pozycję zerujemy: po ponownym włączeniu powstaje nowy element audio od 0 s, więc suwak/napisy
  // nie mogą pokazywać starej pozycji.
  useEffect(() => {
    if (!enabled) {
      audioRef.current?.pause();
      setPlaying(false);
      setPositionMs(0);
    }
  }, [enabled]);

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

  function seek(valueMs: number) {
    if (audioRef.current) audioRef.current.currentTime = valueMs / 1000;
    setPositionMs(valueMs);
  }

  return {
    audioRef,
    audioUrl,
    playing,
    positionMs,
    durationMs,
    hasAudio,
    loadFailed,
    autoplayBlocked,
    captions,
    activeIndex,
    showCaption,
    active,
    transcriptOpen,
    toggleTranscript: () => setTranscriptOpen((open) => !open),
    togglePlay,
    seek,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      setPositionMs(durationMs);
    },
    onTimeUpdate: (currentTimeSeconds: number) => setPositionMs(Math.round(currentTimeSeconds * 1000)),
    onError: () => setLoadFailed(true),
  };
}

export function formatNarrationTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
