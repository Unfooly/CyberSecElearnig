'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { LOCAL_CONTENT_BASE, contentAssetUrl } from '@/lib/content-assets';

// Backend nie ocenia/weryfikuje bloków VIDEO (patrz CoursesService -
// SCOREABLE_BLOCK_TYPES nie obejmuje VIDEO), więc to blokowanie "Dalej" do
// zakończenia odtwarzania jest wyłącznie UX, nie ma egzekwowania po stronie
// serwera. onError też odblokowuje - zepsuty URL wideo nie może na stałe
// zablokować obowiązkowego szkolenia. Jeden „Dalej” (D-106): blok nie ma własnego
// przycisku - po obejrzeniu zgłasza gotowość, dalej prowadzi dolny pasek.
//
// Wygląd (D-159): ciemna ramka 16:9 wpisana w obszar bloku (contentLayout 'fill') - szerokość albo wysokość, co skończy się pierwsze, bez
// przewijania. Plik z potoku zasobów (`src`, CONTENT_BASE_URL) z plakatem; dotychczasowe bloki z zewnętrznym `url` grają po staremu.
// Bez widocznego tytułu nad filmem (uwaga właściciela 2026-11-17: napis obok filmu zbędny) - tytuł bloku jest nazwą odtwarzacza dla czytnika.

// Telefon = dotyk i wąski (pion) albo niski (poziom) ekran - te same progi co tryby telefonu odtwarzacza (globals.css .player-frame).
const PHONE_QUERY = '(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)';
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.(PHONE_QUERY).matches === true;

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

/**
 * Pełny ekran w poziomie dla filmu na telefonie (decyzja właściciela 2026-11-17). Android/Chrome: Fullscreen API na elemencie wideo i blokada
 * orientacji poziomej (dozwolona tylko w pełnym ekranie). iPhone (Safari nie ma Fullscreen API dla elementów): natywny odtwarzacz
 * pełnoekranowy `webkitEnterFullscreen`, który sam obraca się z telefonem. Każda odmowa (brak gestu, ustawienia) - film gra dalej w kursie.
 */
function enterLandscapeFullscreen(video: HTMLVideoElement) {
  const webkit = video as WebkitVideo;
  if (document.fullscreenElement || webkit.webkitDisplayingFullscreen) return;
  if (typeof video.requestFullscreen === 'function') {
    video
      .requestFullscreen()
      .then(() => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape'))
      .catch(() => {});
  } else if (typeof webkit.webkitEnterFullscreen === 'function') {
    try {
      webkit.webkitEnterFullscreen();
    } catch {
      // Odmowa przeglądarki - film zostaje w kursie.
    }
  }
}

function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Brak blokady albo API - nic do zwolnienia.
  }
}

function exitFullscreen(video: HTMLVideoElement) {
  const webkit = video as WebkitVideo;
  if (document.fullscreenElement === video) document.exitFullscreen?.().catch(() => {});
  else if (webkit.webkitDisplayingFullscreen) webkit.webkitExitFullscreen?.();
  unlockOrientation();
}

export default function VideoBlock({
  block,
  contentBase = LOCAL_CONTENT_BASE,
  onReady,
  autoPlay = false,
  suspended = false,
}: {
  /** Podgląd wcześniejszego bloku („Wstecz”): blok zostaje zamontowany, ale ukryty - film się zatrzymuje (ukryte <video> grałoby dalej). */
  suspended?: boolean;
  block: ContentBlock;
  /** Baza zasobów modułu (CONTENT_BASE_URL) - dla `src` i `poster`. */
  contentBase?: string;
  /** true = obejrzane (albo błąd wideo) - „Dalej” w pasku aktywny. */
  onReady: (ready: boolean) => void;
  /** Start filmu od razu - tylko po geście gracza (Start na ekranie startu, „Dalej”; decyzja w CoursePlayer). Przeglądarka, która mimo to
      zablokuje odtwarzanie z dźwiękiem (np. iOS), zostawia zwykły przycisk odtwarzania. */
  autoPlay?: boolean;
}) {
  const [canProceed, setCanProceed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!autoPlay) return;
    videoRef.current?.play()?.catch(() => {
      // NotAllowedError (autoodtwarzanie zablokowane) - gracz uruchomi film kontrolkami.
    });
    // Jednorazowo przy zamontowaniu bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (suspended) videoRef.current?.pause();
  }, [suspended]);
  // Pełny ekran po wyjściu z niego - zwolnienie blokady orientacji (Android).
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // Najdalszy obejrzany moment. Do pierwszego obejrzenia przewijanie do przodu wraca do niego - „Dalej” dopiero po końcu filmu (decyzja
  // właściciela, moduł 5); cofanie działa zawsze. Wyłącznie UX, jak cała blokada.
  const watched = useRef(0);
  // Ścieżka spoza bazy albo o złym rozszerzeniu - brak źródła (onError odblokuje „Dalej”), nigdy obcy adres.
  const legacyUrl = typeof block.url === 'string' && /^https:\/\//.test(block.url) ? block.url : null;
  const src = block.src !== undefined ? contentAssetUrl(contentBase, block.src, 'video') : legacyUrl;
  const poster = contentAssetUrl(contentBase, block.poster, 'image') ?? undefined;

  useEffect(() => {
    if (canProceed) onReady(true);
    // onReady celowo poza deps - remount przez `key` na zmianę bloku (jak inne bloki).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canProceed]);

  useEffect(() => {
    // Brak poprawnego źródła - nic się nie załaduje, więc i `error` nie przyjdzie; nie blokujemy szkolenia.
    if (src === null) setCanProceed(true);
  }, [src]);

  return (
    <div data-testid="video-block" className="flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4">
      <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- napisy wpalone w obraz filmu (D-159) */}
        <video
          ref={videoRef}
          aria-label={block.title ?? 'Film'}
          data-testid="video-player"
          src={src ?? undefined}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            if (!video.seeking && video.currentTime <= watched.current + 1.5) watched.current = Math.max(watched.current, video.currentTime);
          }}
          onSeeking={(event) => {
            const video = event.currentTarget;
            if (!canProceed && video.currentTime > watched.current + 1) video.currentTime = watched.current;
          }}
          // Telefon (decyzja właściciela 2026-11-17): film na pełnym ekranie w poziomie - film 16:9 w pionie zostawiał puste pasy.
          onPlay={(event) => {
            if (isPhone()) enterLandscapeFullscreen(event.currentTarget);
          }}
          onEnded={(event) => {
            setCanProceed(true);
            // Koniec filmu - powrót do kursu („Dalej” jest już aktywny).
            exitFullscreen(event.currentTarget);
          }}
          onError={() => setCanProceed(true)}
          className="block aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-w-full rounded-card bg-black"
        />
      </div>
      <p className={`min-h-[1.5rem] text-base text-muted ${canProceed ? 'invisible' : ''}`}>Obejrzyj film do końca, aby przejść dalej.</p>
    </div>
  );
}
