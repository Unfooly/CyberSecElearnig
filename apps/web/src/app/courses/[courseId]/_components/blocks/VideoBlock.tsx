'use client';

import { useEffect, useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';

// Backend nie ocenia/weryfikuje bloków VIDEO (patrz CoursesService -
// SCOREABLE_BLOCK_TYPES nie obejmuje VIDEO), więc to blokowanie "Dalej" do
// zakończenia odtwarzania jest wyłącznie UX, nie ma egzekwowania po stronie
// serwera. onError też odblokowuje - zepsuty URL wideo nie może na stałe
// zablokować obowiązkowego szkolenia. Jeden „Dalej” (D-106): blok nie ma własnego
// przycisku - po obejrzeniu zgłasza gotowość, dalej prowadzi dolny pasek.
export default function VideoBlock({
  block,
  onReady,
}: {
  block: ContentBlock;
  /** true = obejrzane (albo błąd wideo) - „Dalej” w pasku aktywny. */
  onReady: (ready: boolean) => void;
}) {
  const [canProceed, setCanProceed] = useState(false);

  useEffect(() => {
    if (canProceed) onReady(true);
    // onReady celowo poza deps - remount przez `key` na zmianę bloku (jak inne bloki).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canProceed]);

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Wideo</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- treść kursu, nie ma jeszcze napisów w danych bloku */}
      <video
        src={block.url}
        controls
        onEnded={() => setCanProceed(true)}
        onError={() => setCanProceed(true)}
        className="mb-4 w-full rounded-lg bg-black"
      />
      {!canProceed && <p className="mt-2 text-xs text-slate-400">Obejrzyj wideo do końca, żeby przejść dalej.</p>}
    </div>
  );
}
