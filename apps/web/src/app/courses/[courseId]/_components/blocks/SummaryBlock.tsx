'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { useNotes } from '../player/notes';

// Podsumowanie modułu: tekst z treści i zebrane notatki. Wynik punktowy i nagrody pokazuje ekran po ukończeniu kursu (SummaryScreen), bo
// wynik jest znany dopiero po zapisie ostatniego bloku. Certyfikat: B-069.
export default function SummaryBlock({
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
      <p className="mb-3 text-lg font-medium text-slate-900">{block.title ?? 'Podsumowanie'}</p>
      {block.text && <p className="mb-4 whitespace-pre-line text-slate-800">{block.text}</p>}
      {notes.length > 0 && (
        <section aria-label="Twoje notatki" className="rounded bg-amber-50 p-4 ring-1 ring-amber-200">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Najważniejsze wnioski</h3>
          <ul className="list-disc space-y-1 pl-5 text-slate-800">
            {notes.map((note, index) => (
              <li key={index}>{note.text}</li>
            ))}
          </ul>
        </section>
      )}
      {!review && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="mt-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Zakończ szkolenie
        </button>
      )}
    </div>
  );
}
