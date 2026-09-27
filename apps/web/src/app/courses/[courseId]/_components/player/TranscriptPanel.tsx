'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { usePresence } from '@/lib/use-presence';
import { useOverlayLayer } from './overlay-stack';
import { TRANSCRIPT_TOGGLE_ID } from './NarrationBar';

// Panel transkrypcji NARRACJI BLOKU (nie mylić z transkrypcją audio hotspotu w SceneHotspotsBlock, osobny
// mechanizm): pełny tekst narracji, nad dolnym paskiem, WEWNĄTRZ ramki (bottom-full względem paska - zawsze tuż nad
// nim, niezależnie od jego wysokości). Zarejestrowany w overlay-stack (LIFO wg kolejności otwarcia) - Escape w
// PlayerStage zamyka go, o ile inna warstwa nie jest akurat otwarta później (D-075: poza fullscreenem).
// z-30 (hotfix fix/mascot-overlap - wcześniej z-10, tak samo jak MascotOverlay.tsx; poprawiony opis po kodzie
// review, druga runda): ten panel i dymek Fooli leżą w TYM SAMYM kontekście warstw (ani bottomBarRef, ani
// contentRef nie mają własnego z-index/isolate - oba są zwykłymi potomkami `<main>`'s isolate w PlayerStage.tsx),
// więc przy równym z-index o tym, co maluje się na wierzchu, decydowała kolejność w DOM (bottomBarRef PO
// contentRef) - działało dziś przypadkiem, ale krucho, bo niezależnie od tego, co user faktycznie otworzył jako
// ostatnie. z-30 dorównuje karcie hotspotu/panelowi notatnika - wszystkie "nakładki" overlay-stack są teraz jawnie,
// nie przez przypadek kolejności DOM, ponad dymkiem (z-10).
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

  // Ruch (D-090): wejście fade + scale .96 -> 1 (180 ms), wyjście 140 ms (panel zostaje na chwilę, bez interakcji).
  const { mounted, closing } = usePresence(open, 140);
  if (!mounted) return null;

  return (
    <div
      id={TRANSCRIPT_TOGGLE_ID}
      role="region"
      aria-label="Transkrypcja narracji"
      aria-hidden={closing || undefined}
      data-state={closing ? 'closing' : 'open'}
      className={`absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[40dvh] origin-bottom overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg ${
        closing ? 'pointer-events-none motion-safe:animate-overlay-out' : 'motion-safe:animate-overlay-in'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Transkrypcja</h3>
        <button
          ref={closeButtonRef}
          type="button"
          tabIndex={closing ? -1 : undefined}
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
