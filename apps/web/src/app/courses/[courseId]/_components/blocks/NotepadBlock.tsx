'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { useNotes } from '../player/notes';

// Blok "Notatnik": zachęta (prompt) i lista notatek zebranych dotąd. Notatki tworzą wyłącznie bloki i serwer (treść z kursu); użytkownik
// nie wpisuje własnego tekstu, więc nie ma tu pola formularza ani danych osobowych po stronie klienta.
export default function NotepadBlock({
  block,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  disabled: boolean;
  review?: boolean;
}) {
  const { notes } = useNotes();
  return (
    <div>
      <p className="mb-3 text-lg text-slate-900">{block.prompt ?? 'Twoje notatki z dotychczasowego szkolenia'}</p>
      {notes.length === 0 ? (
        <p className="text-sm text-slate-600">Nie zebrano jeszcze notatek.</p>
      ) : (
        <ul className="list-disc space-y-1 rounded bg-amber-50 p-4 pl-8 text-slate-800 ring-1 ring-amber-200">
          {notes.map((note, index) => (
            <li key={index}>{note.text}</li>
          ))}
        </ul>
      )}
      {!review && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="mt-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Kontynuuj
        </button>
      )}
    </div>
  );
}
