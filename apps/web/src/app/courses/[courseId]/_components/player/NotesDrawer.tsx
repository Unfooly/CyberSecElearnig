'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { NotesPanel } from './notes';
import { useOverlayLayer } from './overlay-stack';

// Notatnik jako panel wysuwany Z PRAWEJ, WEWNĄTRZ ramki (feat/player-stage) - zastępuje dawną kolumnę siatki w
// PlayerShell.tsx (notesOpen zmieniało też max-w sceny na 1200px; ta zmiana szerokości znika, scena ma stałą
// szerokość niezależnie od stanu notatnika). `absolute` (nie `fixed`): zostaje w granicach ramki PlayerStage
// (position: relative), nie całego viewportu - w trybie 16:9 ramka nie wypełnia ekranu, więc `fixed` wystawałby
// poza jej krawędzie. Treść (nagłówek "Notatnik", lista wpisów) to bez zmian NotesPanel z notes.tsx - tu dokłada
// się tylko przycisk zamknięcia i sam mechanizm wysuwania/tła.
export default function NotesDrawer({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useOverlayLayer('notebook', open, onClose);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 z-20 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-label="Notatnik"
        aria-hidden={!open}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 z-30 flex w-full max-w-[320px] flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-200 motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 justify-end p-2">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Zamknij notatnik"
            tabIndex={open ? undefined : -1}
            className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 px-3 pb-3">
          <NotesPanel id={id} />
        </div>
      </div>
    </>
  );
}
