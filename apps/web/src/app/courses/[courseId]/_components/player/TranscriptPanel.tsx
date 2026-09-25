'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useOverlayLayer } from './overlay-stack';
import { TRANSCRIPT_TOGGLE_ID } from './NarrationBar';

// Panel transkrypcji NARRACJI BLOKU (nie mylić z transkrypcją audio hotspotu w SceneHotspotsBlock, osobny
// mechanizm): pełny tekst narracji, nad dolnym paskiem, WEWNĄTRZ ramki (bottom-full względem paska - zawsze tuż nad
// nim, niezależnie od jego wysokości). Zarejestrowany w overlay-stack (priorytet 'transcript') - Escape w
// PlayerStage zamyka go, o ile karta hotspotu nie jest akurat wyżej w kolejności (D-075: poza fullscreenem).
export default function TranscriptPanel({ text, open, onClose }: { text: string; open: boolean; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useOverlayLayer('transcript', open, onClose);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      id={TRANSCRIPT_TOGGLE_ID}
      role="region"
      aria-label="Transkrypcja narracji"
      className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-[40dvh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Transkrypcja</h3>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Zamknij transkrypcję"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <p className="whitespace-pre-line text-sm text-slate-700">{text}</p>
    </div>
  );
}
