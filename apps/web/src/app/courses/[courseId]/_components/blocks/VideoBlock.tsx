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
export default function VideoBlock({
  block,
  contentBase = LOCAL_CONTENT_BASE,
  onReady,
}: {
  block: ContentBlock;
  /** Baza zasobów modułu (CONTENT_BASE_URL) - dla `src` i `poster`. */
  contentBase?: string;
  /** true = obejrzane (albo błąd wideo) - „Dalej” w pasku aktywny. */
  onReady: (ready: boolean) => void;
}) {
  const [canProceed, setCanProceed] = useState(false);
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
      {block.title && <p className="text-lg font-semibold text-ink">{block.title}</p>}
      <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- napisy wpalone w obraz filmu (D-159) */}
        <video
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
          onEnded={() => setCanProceed(true)}
          onError={() => setCanProceed(true)}
          className="block aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-w-full rounded-card bg-black"
        />
      </div>
      <p className={`min-h-[1.5rem] text-base text-muted ${canProceed ? 'invisible' : ''}`}>Obejrzyj film do końca, aby przejść dalej.</p>
    </div>
  );
}
