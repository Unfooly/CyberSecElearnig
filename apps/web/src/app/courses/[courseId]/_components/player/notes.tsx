'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ClientNote } from '@/lib/courses-types';

// Notatnik modułu: wspólny stan widoczny w wielu blokach (panel w powłoce). Wpisy dodają bloki (dialog, checklista maila - kolejne
// commity PR 2); początkowe pochodzą z progress.notes z /start (treść rozwiązana przez serwer, klient nigdy nie wysyła własnej).
interface NotesContextValue {
  notes: ClientNote[];
  /** Dodaje wpis (bez duplikatów tego samego bloku i tekstu). */
  addNote: (note: ClientNote) => void;
}

const NotesContext = createContext<NotesContextValue>({ notes: [], addNote: () => {} });

export function NotesProvider({ initial, children }: { initial: ClientNote[]; children: ReactNode }) {
  const [notes, setNotes] = useState<ClientNote[]>(initial);
  const addNote = useCallback((note: ClientNote) => {
    setNotes((current) =>
      current.some((existing) => existing.blockId === note.blockId && existing.text === note.text) ? current : [...current, note],
    );
  }, []);
  const value = useMemo(() => ({ notes, addNote }), [notes, addNote]);
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export const useNotes = () => useContext(NotesContext);

export function NotesPanel({ id }: { id: string }) {
  const { notes } = useNotes();
  return (
    <aside id={id} aria-label="Notatnik" className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="mb-2 text-sm font-semibold text-amber-900">Notatnik</h2>
      {notes.length === 0 ? (
        <p className="text-sm text-amber-800">Notatki pojawią się w trakcie szkolenia.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          {notes.map((note, index) => (
            // Klucz z indeksu: klient nie zna id elementów z treści (D-051), a lista tylko przyrasta.
            <li key={index}>{note.text}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
