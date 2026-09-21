'use client';

import type { ReactNode, RefObject } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';

// Powłoka odtwarzacza modułu: nagłówek z tytułem i paskiem postępu (jak na wzorcach), scena na środku (max. ok. 880 px, wyśrodkowana),
// panel notatek, na dole stały pasek z odtwarzaczem narracji (maks. dwa rzędy) i nawigacją Wstecz/Dalej. Prezentacyjna: stan i logika są
// w CoursePlayer. Działa od 390 px: panel notatek ląduje pod sceną, cele dotykowe mają min. 44 px, dolny pasek ma limit wysokości
// (rozwinięta transkrypcja nie wypycha przycisków poza ekran). Landmark <main> jest w page.tsx (tu go nie dublujemy).
export default function PlayerShell({
  title,
  blockNumber,
  totalBlocks,
  completedBlocks,
  stage,
  mascot,
  narration,
  notesCount,
  notesOpen,
  onToggleNotes,
  notesPanel,
  notesId,
  onBack,
  onForward,
  canBack,
  canForward,
  forwardHint,
  headingRef,
}: {
  title: string;
  /** Numer wyświetlanego bloku (od 1). */
  blockNumber: number;
  totalBlocks: number;
  /** Liczba bloków ukończonych po stronie serwera (postęp), niezależnie od tego, który blok jest podglądany. */
  completedBlocks: number;
  stage: ReactNode;
  mascot?: ReactNode;
  narration: ReactNode;
  notesCount: number;
  notesOpen: boolean;
  onToggleNotes: () => void;
  notesPanel: ReactNode;
  /** Id panelu notatek (aria-controls przycisku); ten sam prop trafia do panelu. */
  notesId: string;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  /** Krótki tekst po lewej od "Dalej", gdy jest nieaktywne (np. trzeba ukończyć bieżący blok). */
  forwardHint?: string;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const percent = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;
  const hintId = 'forward-hint';
  const width = notesOpen ? 'max-w-[1200px]' : 'max-w-[880px]';

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <header className={`mx-auto mb-4 w-full ${width}`}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
          <button
            type="button"
            onClick={onToggleNotes}
            aria-expanded={notesOpen}
            aria-controls={notesOpen ? notesId : undefined}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <NotebookPen aria-hidden="true" className="h-4 w-4" />
            Notatnik ({notesCount})
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Postęp szkolenia"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`Ukończono ${completedBlocks} z ${totalBlocks} bloków`}
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
          >
            <div className="h-full rounded-full bg-indigo-600 motion-safe:transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
            Blok {blockNumber} z {totalBlocks}
          </span>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        Blok {blockNumber} z {totalBlocks}
      </p>

      <div className={`mx-auto grid w-full flex-1 gap-4 ${width} ${notesOpen ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
        <div className="min-w-0">
          {mascot && <div className="mb-3">{mascot}</div>}
          <div className="rounded-lg bg-white p-4 shadow-sm sm:p-6">
            {/* Nagłówek tylko dla czytników ekranu i fokusu przy zmianie bloku; treść bloku jest widoczna w scenie (bez duplikowania). */}
            <h2 ref={headingRef} tabIndex={-1} className="sr-only">
              Blok {blockNumber} z {totalBlocks}
            </h2>
            {stage}
          </div>
        </div>
        {notesOpen && <div>{notesPanel}</div>}
      </div>

      {/* Pasek ma tę samą szerokość co scena (na telefonie pełna szerokość okna, od sm wyśrodkowany razem z sceną). */}
      <div
        className={`sticky bottom-0 -mx-4 mt-6 max-h-[60vh] overflow-y-auto border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:mx-auto sm:w-full sm:rounded-lg sm:border ${
          notesOpen ? 'sm:max-w-[1200px]' : 'sm:max-w-[880px]'
        }`}
      >
        <div className="space-y-1">
          {narration}
          <nav aria-label="Nawigacja po blokach" className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={!canBack}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 sm:px-4"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Wstecz
            </button>
            {/* Podpowiedź w TYM SAMYM rzędzie (flex-1): jej pojawienie się nie przesuwa układu, jak przy tekście pod przyciskiem. */}
            <span id={hintId} className="min-w-0 flex-1 truncate text-right text-xs text-slate-500" title={!canForward ? forwardHint : undefined}>
              {!canForward ? forwardHint : ''}
            </span>
            <button
              type="button"
              onClick={onForward}
              disabled={!canForward}
              aria-describedby={!canForward && forwardHint ? hintId : undefined}
              title={!canForward ? forwardHint : undefined}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 sm:px-4"
            >
              Dalej
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
