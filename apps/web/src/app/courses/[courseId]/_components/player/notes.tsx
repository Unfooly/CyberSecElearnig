'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Mail, MapPin, Package, Square, StickyNote, User, type LucideIcon } from 'lucide-react';
import type { ClientNote, ClientProgressBlock, ContentBlock, NoteKind } from '@/lib/courses-types';

// Notatnik modułu: wspólny stan widoczny w wielu blokach (panel w powłoce). Wpisy dodają bloki (hotspoty, dialog, checklista maila);
// początkowe pochodzą z progress.notes z /start (treść rozwiązana przez serwer, klient nigdy nie wysyła własnej).
// Zadania (D-081): zadania sprawy z karty w odprawie (BRIEFING, krok caseFile) w treści BIEŻĄCEJ wersji przypisania; zadanie
// jest odhaczone, gdy WSZYSTKIE bloki z completeWhen są ukończone wg progress (liczy klient - to nie ocena, serwer niczego tu
// nie przyznaje). Cele szkoleniowe modułu (objectives) to co innego i tu ich nie ma.
export interface NotebookTask {
  text: string;
  done: boolean;
}

/** Zadania sprawy z bloku BRIEFING (krok caseFile) i stan bloków (results z /start i z tej sesji). Moduł bez odprawy = brak zadań. */
export function notebookTasks(blocks: ContentBlock[], results: Record<string, ClientProgressBlock>): NotebookTask[] {
  const tasks = blocks
    .filter((block) => block.type === 'BRIEFING')
    .flatMap((block) => block.steps ?? [])
    .flatMap((step) => (step.kind === 'caseFile' ? (step.tasks ?? []) : []));
  return tasks.map((task) => ({ text: task.text, done: task.completeWhen.every((blockId) => results[blockId]?.done === true) }));
}

interface NotesContextValue {
  notes: ClientNote[];
  /** Tytuły bloków po id (nagłówki grup w panelu). */
  blockTitles: Record<string, string>;
  /** Dodaje wpis (bez duplikatów tego samego bloku i tekstu). */
  addNote: (note: ClientNote) => void;
  tasks: NotebookTask[];
}

const NotesContext = createContext<NotesContextValue>({ notes: [], blockTitles: {}, addNote: () => {}, tasks: [] });

const NO_TASKS: NotebookTask[] = [];

export function NotesProvider({
  initial,
  blockTitles = {},
  tasks = NO_TASKS,
  children,
}: {
  initial: ClientNote[];
  blockTitles?: Record<string, string>;
  tasks?: NotebookTask[];
  children: ReactNode;
}) {
  const [notes, setNotes] = useState<ClientNote[]>(initial);
  const addNote = useCallback((note: ClientNote) => {
    setNotes((current) =>
      current.some((existing) => existing.blockId === note.blockId && existing.text === note.text) ? current : [...current, note],
    );
  }, []);
  const value = useMemo(() => ({ notes, blockTitles, addNote, tasks }), [notes, blockTitles, addNote, tasks]);
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

/** Odhaczone pole zadania: ramka + ptaszek rysowany kreską (stroke-dashoffset, 300 ms, D-090) przy pierwszym pokazaniu po wykonaniu. */
function DrawnCheck({ draw }: { draw: boolean }) {
  return (
    <svg aria-hidden="true" data-testid="task-check" viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 12.5l3 3 5-6.5" pathLength={24} strokeDasharray={24} className={draw ? 'motion-safe:animate-check-draw' : undefined} />
    </svg>
  );
}

/**
 * Sekcja "Zadania" notatnika: stan odhaczenia jest wyłącznie do odczytu (liczony z postępu), więc to ikony, nie checkboxy. Ptaszek rysuje
 * się raz - przy pierwszym otwarciu notatnika po wykonaniu zadania (zadania wykonane przy wejściu do modułu stoją od razu); po zamknięciu
 * notatnika uznajemy go za pokazany.
 */
export function TaskList({ tasks, open = true }: { tasks: NotebookTask[]; open?: boolean }) {
  // Klucz: pozycja + tekst (dwa zadania o tym samym tekście nie dzielą stanu).
  const keyOf = (task: NotebookTask, index: number) => `${index}:${task.text}`;
  const shown = useRef<Set<string> | null>(null);
  if (shown.current === null) shown.current = new Set(tasks.flatMap((task, index) => (task.done ? [keyOf(task, index)] : [])));
  // Wykonane zadania, które BYŁY widoczne przy otwartym notatniku; za pokazane uznajemy je dopiero przy ZAMKNIĘCIU - kolejne rendery
  // w trakcie rysowania (300 ms) go nie przerywają, a zadanie wykonane przy zamkniętym notatniku czeka na następne otwarcie.
  const seenOpen = useRef(new Set<string>());
  // Zapis w renderze celowo: idempotentne dodanie do zbioru (StrictMode/przerwany render nic nie psują), a efekt po renderze byłby za
  // późno dla zamknięcia w tym samym commicie.
  if (open) tasks.forEach((task, index) => task.done && seenOpen.current.add(keyOf(task, index)));
  useEffect(() => {
    if (open) return;
    seenOpen.current.forEach((key) => shown.current?.add(key));
    seenOpen.current.clear();
  }, [open]);
  if (tasks.length === 0) return null;
  return (
    <section aria-label="Zadania" className="mb-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">Zadania</h3>
      <ul className="space-y-1 text-sm text-slate-800">
        {tasks.map((task, index) => (
          <li key={index} className="flex items-start gap-2">
            {task.done ? (
              <DrawnCheck draw={open && !shown.current?.has(keyOf(task, index))} />
            ) : (
              <Square aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
            )}
            <span className={task.done ? 'text-muted line-through motion-safe:transition-colors motion-safe:duration-base' : undefined}>
              <span className="sr-only">{task.done ? 'Wykonane: ' : 'Do zrobienia: '}</span>
              {task.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotesPanel({ id, open = true }: { id: string; open?: boolean }) {
  const { notes, blockTitles, tasks } = useNotes();
  return (
    <aside id={id} aria-label="Notatnik" className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="mb-2 text-sm font-semibold text-amber-900">Notatnik</h2>
      <TaskList tasks={tasks} open={open} />
      {notes.length === 0 ? (
        <p className="text-sm text-amber-800">Notatki pojawią się w trakcie szkolenia.</p>
      ) : (
        <GroupedNotes notes={notes} blockTitles={blockTitles} />
      )}
    </aside>
  );
}
