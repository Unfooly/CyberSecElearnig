'use client';

import { useId } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useHintCollapse } from './useHintCollapse';

// Dymek podpowiedzi (refactor/remove-mascot-player, D-093) - zastępuje maskotkę Fooli: sam tekst w neutralnej karcie, bez postaci.
// Dwa warianty:
//  - `bar` (bloki w układzie 'slide' i rozmowa): w normalnym przepływie nad treścią bloku - niczego nie zasłania;
//  - `overlay` (SCENE_HOTSPOTS): w lewym dolnym rogu sceny, max 30% szerokości; przy otwartej nakładce (zbliżenie, notatnik,
//    transkrypcja) dymek jest zwinięty (bubbleVisible), a ikona `invisible` + aria-hidden + poza Tab (nie zasłania i nie łapie kliknięć);
//    po zamknięciu nakładki wraca sama ikona, dymek zostaje zwinięty.
// Zwinięty dymek to mała ikona żarówki („Pokaż podpowiedź”) - klik rozwija. Przy rozwiniętym dymku ikona jest `sr-only` i poza Tab (nic nie
// robi, a fokus na elemencie 1 px byłby niewidoczny). Tekst jest w <p role="status" aria-live="polite"> poza przyciskami; zwijanie przez
// max-h-0/opacity-0 (nie display:none ani aria-hidden) - region aria-live zostaje w drzewie dostępności także przy otwartej nakładce, więc
// reakcja, która przyjdzie pod zbliżeniem (np. reactions.complete po ostatnim punkcie), jest ogłoszona.
export default function Hint({ text, variant }: { text?: string; variant: 'bar' | 'overlay' }) {
  const { setCollapsed, bubbleVisible, rootRef, anyOverlayOpen } = useHintCollapse(text);
  const bubbleId = useId();

  if (!text) return null;
  const overlay = variant === 'overlay';
  const hiddenForOverlay = overlay && anyOverlayOpen;

  return (
    <div
      ref={rootRef}
      data-testid={overlay ? 'hint-overlay' : 'hint-bar'}
      className={overlay ? 'pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[30%] items-end gap-2' : 'mb-3 flex shrink-0 items-start gap-2'}
    >
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Pokaż podpowiedź"
        aria-expanded={bubbleVisible}
        aria-controls={bubbleId}
        aria-hidden={hiddenForOverlay ? true : undefined}
        tabIndex={hiddenForOverlay || bubbleVisible ? -1 : undefined}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          hiddenForOverlay ? 'pointer-events-none invisible' : 'pointer-events-auto visible'
        } ${bubbleVisible ? 'sr-only' : ''}`}
      >
        <Lightbulb aria-hidden="true" className="h-4 w-4" />
      </button>
      <div
        id={bubbleId}
        className={`pointer-events-auto relative min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card transition-[max-height,opacity] duration-base motion-reduce:transition-none ${
          overlay ? 'max-w-[280px]' : 'flex-1'
        } ${bubbleVisible ? 'max-h-[400px] px-4 py-3 opacity-100' : 'pointer-events-none max-h-0 border-0 p-0 opacity-0'}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Zwiń podpowiedź"
          tabIndex={bubbleVisible ? undefined : -1}
          className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-paper hover:text-ink"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <p role="status" aria-live="polite" className="pr-6 text-sm leading-snug text-ink">
          {text}
        </p>
      </div>
    </div>
  );
}
