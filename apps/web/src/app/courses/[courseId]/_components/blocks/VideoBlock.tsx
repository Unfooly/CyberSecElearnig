'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';

// Backend nie ocenia/weryfikuje bloków VIDEO (patrz CoursesService -
// SCOREABLE_BLOCK_TYPES nie obejmuje VIDEO), więc to blokowanie "Dalej" do
// zakończenia odtwarzania jest wyłącznie UX, nie ma egzekwowania po stronie
// serwera. onError też odblokowuje - zepsuty URL wideo nie może na stałe
// zablokować obowiązkowego szkolenia.
export default function VideoBlock({
  block,
  onSubmit,
  disabled,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const [canProceed, setCanProceed] = useState(false);

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
      <button
        type="button"
        disabled={!canProceed || disabled}
        onClick={() => onSubmit()}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Dalej
      </button>
      {!canProceed && <p className="mt-2 text-xs text-slate-400">Obejrzyj wideo do końca, żeby przejść dalej.</p>}
    </div>
  );
}
