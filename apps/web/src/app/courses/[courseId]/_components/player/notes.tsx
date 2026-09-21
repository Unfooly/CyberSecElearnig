'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Mail, MapPin, Package, StickyNote, User, type LucideIcon } from 'lucide-react';
import type { ClientNote, NoteKind } from '@/lib/courses-types';

// Notatnik modułu: wspólny stan widoczny w wielu blokach (panel w powłoce). Wpisy dodają bloki (hotspoty, dialog, checklista maila);
// początkowe pochodzą z progress.notes z /start (treść rozwiązana przez serwer, klient nigdy nie wysyła własnej).
interface NotesContextValue {
  notes: ClientNote[];
  /** Tytuły bloków po id (nagłówki grup w panelu). */
  blockTitles: Record<string, string>;
  /** Dodaje wpis (bez duplikatów tego samego bloku i tekstu). */
  addNote: (note: ClientNote) => void;
}

const NotesContext = createContext<NotesContextValue>({ notes: [], blockTitles: {}, addNote: () => {} });

export function NotesProvider({
  initial,
  blockTitles = {},
  children,
}: {
  initial: ClientNote[];
  blockTitles?: Record<string, string>;
  children: ReactNode;
}) {
  const [notes, setNotes] = useState<ClientNote[]>(initial);
  const addNote = useCallback((note: ClientNote) => {
    setNotes((current) =>
      current.some((existing) => existing.blockId === note.blockId && existing.text === note.text) ? current : [...current, note],
    );
  }, []);
  const value = useMemo(() => ({ notes, blockTitles, addNote }), [notes, blockTitles, addNote]);
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export const useNotes = () => useContext(NotesContext);

const KIND_ICONS: Record<NoteKind, { Icon: LucideIcon; label: string }> = {
  mail: { Icon: Mail, label: 'Mail' },
  person: { Icon: User, label: 'Osoba' },
  item: { Icon: Package, label: 'Przedmiot' },
  place: { Icon: MapPin, label: 'Miejsce' },
};

/** Ikona rodzaju wpisu (nieznany albo brak rodzaju = zwykła notatka). Ikona jest dekoracyjna, rodzaj czyta się z ukrytej etykiety. */
export function NoteKindIcon({ kind, className = 'h-4 w-4' }: { kind?: string; className?: string }) {
  const entry = kind && Object.prototype.hasOwnProperty.call(KIND_ICONS, kind) ? KIND_ICONS[kind as NoteKind] : null;
  const Icon = entry?.Icon ?? StickyNote;
  return (
    <>
      <Icon aria-hidden="true" className={className} />
      <span className="sr-only">{entry?.label ?? 'Notatka'}: </span>
    </>
  );
}

/** Notatki pogrupowane per blok (kolejność pierwszego wpisu), z ikoną rodzaju przy każdym. */
export function GroupedNotes({ notes, blockTitles, className = '' }: { notes: ClientNote[]; blockTitles: Record<string, string>; className?: string }) {
  const groups: { blockId: string; notes: ClientNote[] }[] = [];
  for (const note of notes) {
    const group = groups.find((candidate) => candidate.blockId === note.blockId);
    if (group) group.notes.push(note);
    else groups.push({ blockId: note.blockId, notes: [note] });
  }
  return (
    <div className={`space-y-3 ${className}`}>
      {groups.map((group) => (
        <section key={group.blockId} aria-label={blockTitles[group.blockId] ?? 'Notatki'}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">{blockTitles[group.blockId] ?? 'Notatki'}</h3>
          <ul className="space-y-1 text-sm text-slate-800">
            {group.notes.map((note, index) => (
              // Klucz z indeksu: klient nie zna id elementów z treści (D-051), a lista tylko przyrasta.
              <li key={index} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-amber-800">
                  <NoteKindIcon kind={note.kind} />
                </span>
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function NotesPanel({ id }: { id: string }) {
  const { notes, blockTitles } = useNotes();
  return (
    <aside id={id} aria-label="Notatnik" className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="mb-2 text-sm font-semibold text-amber-900">Notatnik</h2>
      {notes.length === 0 ? (
        <p className="text-sm text-amber-800">Notatki pojawią się w trakcie szkolenia.</p>
      ) : (
        <GroupedNotes notes={notes} blockTitles={blockTitles} />
      )}
    </aside>
  );
}
