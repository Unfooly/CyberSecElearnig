'use client';

import { useEffect } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { GroupedNotes, useNotes } from '../player/notes';
import { useCompleteReaction } from '../player/mascot-reaction';

// Blok "Notatnik": zachęta (prompt) i lista notatek zebranych dotąd. Notatki tworzą wyłącznie bloki i serwer (treść z kursu); użytkownik
// nie wpisuje własnego tekstu, więc nie ma tu pola formularza ani danych osobowych po stronie klienta. Bez czego "pokrywać" - gotowy od
// razu po zamontowaniu ("Dalej" w pasku powłoki, bez osobnego przycisku tutaj - patrz ExploreFooter).
export default function NotepadBlock({
  block,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const { notes, blockTitles } = useNotes();
  useCompleteReaction(block.reactions?.complete, true, review);

  useEffect(() => {
    if (review) return;
    onReady(() => onSubmit());
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  return (
    <div>
      <p className="mb-3 text-lg text-slate-900">{block.prompt ?? 'Twoje notatki z dotychczasowego szkolenia'}</p>
      {notes.length === 0 ? (
        <p className="text-sm text-slate-600">Nie zebrano jeszcze notatek.</p>
      ) : (
        <div className="rounded bg-amber-50 p-4 ring-1 ring-amber-200">
          <GroupedNotes notes={notes} blockTitles={blockTitles} />
        </div>
      )}
    </div>
  );
}
