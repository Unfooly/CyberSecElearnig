'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { useNotes } from '../player/notes';
import ExploreFooter, { requiredIds } from './ExploreFooter';

// Rozmowa z postacią: użytkownik wybiera pytania z listy, odpowiedzi dopisują się do rozmowy. Pytanie z `note` dopisuje wpis do notatnika
// (tylko poza podglądem; serwer i tak sam wylicza notatki przy zapisie bloku, klient dopisuje je od razu dla wygody).
// Odpowiedź dla serwera: { asked: [id...] } w kolejności zadawania.
export default function DialogueBlock({
  block,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: (answer: { asked: string[] }) => void;
  disabled: boolean;
  review?: boolean;
}) {
  const questions = block.questions ?? [];
  const character = block.character;
  const { addNote } = useNotes();
  const [asked, setAsked] = useState<string[]>([]);

  const required = requiredIds(
    questions.map((question) => question.id),
    block.requiredQuestions,
  );
  const doneCount = required.filter((id) => asked.includes(id)).length;

  function ask(id: string) {
    if (asked.includes(id)) return;
    setAsked((current) => [...current, id]);
    const note = questions.find((question) => question.id === id)?.note;
    if (note && !review && block.id) addNote({ blockId: block.id, text: note.text });
  }

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      {character && (
        <p className="mb-3 text-sm text-slate-600">
          Rozmawiasz z: <span className="font-semibold text-slate-900">{character.name}</span>
          {character.role && <span>, {character.role}</span>}
        </p>
      )}

      <ol aria-label="Rozmowa" aria-live="polite" className="mb-4 space-y-3">
        {asked.map((id) => {
          const question = questions.find((candidate) => candidate.id === id);
          if (!question) return null;
          return (
            <li key={id} className="space-y-2">
              <p className="ml-auto max-w-[85%] rounded-lg bg-indigo-50 px-3 py-2 text-slate-900">
                <span className="sr-only">Ty: </span>
                {question.text}
              </p>
              <p className="max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
                <span className="sr-only">{character?.name ?? 'Postać'}: </span>
                {question.answer}
              </p>
            </li>
          );
        })}
      </ol>

      <ul aria-label="Pytania do zadania" className="space-y-2">
        {/* Zadane pytania zostają na liście jako nieaktywne: usunięcie klikniętego przycisku gubiłoby fokus klawiatury. */}
        {questions.map((question) => (
          <li key={question.id}>
            <button
              type="button"
              onClick={() => ask(question.id)}
              aria-disabled={asked.includes(question.id)}
              className={`min-h-[44px] w-full rounded border px-3 py-2 text-left text-sm font-medium ${
                asked.includes(question.id)
                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              {question.text}
              {asked.includes(question.id) && <span className="sr-only"> (zadane)</span>}
            </button>
          </li>
        ))}
      </ul>

      <ExploreFooter
        done={doneCount}
        total={required.length}
        noun="pytań"
        onSubmit={() => onSubmit({ asked })}
        disabled={disabled}
        review={review}
      />
    </div>
  );
}
