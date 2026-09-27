'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { NotesPanel } from './notes';
import { useOverlayLayer } from './overlay-stack';

// Notatnik jako panel wysuwany Z PRAWEJ, WEWNĄTRZ ramki (feat/player-stage) - zastępuje dawną kolumnę siatki w
// PlayerShell.tsx (notesOpen zmieniało też max-w sceny na 1200px; ta zmiana szerokości znika, scena ma stałą
// szerokość niezależnie od stanu notatnika). `absolute` (nie `fixed`): zostaje w granicach ramki PlayerStage
// (position: relative), nie całego viewportu - w trybie 16:9 ramka nie wypełnia ekranu, więc `fixed` wystawałby
// poza jej krawędzie. Treść (nagłówek "Notatnik", lista wpisów) to bez zmian NotesPanel z notes.tsx.
//
// PRAWDZIWY modal (kod review PR #44 - poprzednia wersja miała tło i wygląd modala, ale bez aria-modal, pułapki
// fokusu i bez oddawania fokusu przy zamknięciu, co gubiło go na body/ukrytym elemencie): aria-modal="true",
// jawna pętla fokusu (Tab/Shift+Tab, jak drawer Topbar.tsx) - reszta ramki jest DODATKOWO inert (PlayerStage.tsx),
// więc pętla dziś praktycznie zawsze ma tylko przycisk X (jedyny interaktywny element w NotesPanel), ale zostaje
// ogólna na wypadek przyszłej zawartości. Fokus wraca na przycisk "Notatnik" (triggerRef, przekazany przez
// PlayerStage) przy KAŻDYM zamknięciu - X, Escape (przez overlay-stack) i klik w tło - nie tylko przy X jak
// wcześniej.
export default function NotesDrawer({
  id,
  open,
  onClose,
  triggerRef,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Przycisk "Notatnik" w PlayerStage - dostaje fokus z powrotem przy KAŻDYM zamknięciu tego panelu. */
  triggerRef: RefObject<HTMLButtonElement>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useOverlayLayer('notebook', open, onClose);

  // Fokus na X po otwarciu; po zamknięciu (którąkolwiek drogą - X, Escape z overlay-stack, klik w tło) wraca na
  // przycisk "Notatnik" (ten sam wzorzec co drawer Topbar.tsx: wasOpenRef odróżnia PRAWDZIWE zamknięcie od
  // pierwszego renderu, gdzie open zaczyna się jako false).
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

  // Pułapka fokusu: Tab/Shift+Tab krąży WYŁĄCZNIE po elementach wewnątrz panelu. Reszta ramki jest już inert
  // (PlayerStage.tsx), więc to głównie zabezpieczenie na wypadek przeglądarek/trybów bez wsparcia dla inert, oraz
  // gdy NotesPanel kiedyś dostanie więcej niż jeden interaktywny element.
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      if (focusable.length === 0) return;
      event.preventDefault();
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (activeIndex === -1) {
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
        return;
      }
      const nextIndex = event.shiftKey ? (activeIndex - 1 + focusable.length) % focusable.length : (activeIndex + 1) % focusable.length;
      focusable[nextIndex].focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
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
          <NotesPanel id={id} open={open} />
        </div>
      </div>
    </>
  );
}
