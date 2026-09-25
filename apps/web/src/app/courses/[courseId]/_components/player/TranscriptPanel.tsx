'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useOverlayLayer } from './overlay-stack';
import { TRANSCRIPT_TOGGLE_ID } from './NarrationBar';

// Panel transkrypcji NARRACJI BLOKU (nie mylić z transkrypcją audio hotspotu w SceneHotspotsBlock, osobny
// mechanizm): pełny tekst narracji, nad dolnym paskiem, WEWNĄTRZ ramki (bottom-full względem paska - zawsze tuż nad
// nim, niezależnie od jego wysokości). Zarejestrowany w overlay-stack (LIFO wg kolejności otwarcia) - Escape w
// PlayerStage zamyka go, o ile inna warstwa nie jest akurat otwarta później (D-075: poza fullscreenem).
export default function TranscriptPanel({
  text,
  open,
  onClose,
  triggerRef,
}: {
  text: string;
  open: boolean;
  onClose: () => void;
  /** Przycisk "Transkrypcja" w NarrationBar - dostaje fokus z powrotem przy KAŻDYM zamknięciu tego panelu. */
  triggerRef: RefObject<HTMLButtonElement>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useOverlayLayer('transcript', open, onClose);

  // Ten sam wzorzec co NotesDrawer.tsx (bez trzeciej drogi - ten panel, w przeciwieństwie do NotesDrawer, nie ma
  // WŁASNEGO tła/kliknięcia poza sobą): fokus na X po otwarciu, po zamknięciu (X albo Escape z overlay-stack) wraca
  // na przycisk "Transkrypcja". Hooki są NAD `if (!open) return null` poniżej, więc ten efekt i tak odpala się przy
  // przejściu open -> false, zanim komponent zwróci null.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

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
