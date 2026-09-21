'use client';

import { useRef, useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useMascotReaction } from '../player/mascot-reaction';
import ExploreFooter from './ExploreFooter';

// Rozmowa z postacią: gracz wybiera pytanie, postać odpowiada KWESTIAMI PO KOLEI (klik "Dalej" w dymku, nie cały tekst naraz; odpowiedź
// bez `lines` to jedna kwestia). Pytanie liczy się jako zadane, gdy wszystkie kwestie zostały wypowiedziane; dopiero wtedy pytanie z notatką
// dopisuje wpis do notatnika (dowód, gdy `evidence`). Podczas rozmowy pozostałe pytania są nieaktywne. Notatki dopisywane są tylko poza
// podglądem (serwer i tak sam wylicza je przy zapisie bloku). Avatar postaci tylko przez <img> z bazy zasobów.
// Odpowiedź dla serwera: { asked: [id...] } w kolejności ukończenia.
export default function DialogueBlock({
  block,
  contentBase,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { asked: string[] }) => void;
  disabled: boolean;
  review?: boolean;
}) {
  const questions = block.questions ?? [];
  const character = block.character;
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const mascot = useMascotReaction();
  // Postęp rozmowy: ile kwestii każdego pytania już padło (kolejność = kolejność wyboru).
  const [progress, setProgress] = useState<{ id: string; shown: number }[]>([]);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const avatarUrl = contentAssetUrl(contentBase, character?.avatar, 'image');

  const linesOf = (id: string): string[] => {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question) return [];
    if (question.lines && question.lines.length > 0) return question.lines.map((line) => line.text);
    return question.answer ? [question.answer] : [];
  };
  const isComplete = (entry: { id: string; shown: number }) => entry.shown >= linesOf(entry.id).length;
  const asked = progress.filter(isComplete).map((entry) => entry.id);
  const current = progress.find((entry) => !isComplete(entry)) ?? null;

  const required = requiredItemIds(questions, block.requiredQuestions);
  const doneCount = required.filter((id) => asked.includes(id)).length;

  function finish(id: string) {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question?.note || review || !block.id) return;
    addNote({ blockId: block.id, text: question.note.text, kind: question.note.kind });
    if (question.evidence) {
      evidence.addPending(`${block.id}.${id}`);
      mascot.react('evidence');
    }
  }

  function ask(id: string) {
    if (current || progress.some((entry) => entry.id === id)) return;
    setProgress((list) => [...list, { id, shown: 1 }]);
    if (linesOf(id).length <= 1) finish(id);
  }

  function next() {
    if (!current) return;
    const shown = current.shown + 1;
    setProgress((list) => list.map((entry) => (entry.id === current.id ? { ...entry, shown } : entry)));
    if (shown >= linesOf(current.id).length) {
      finish(current.id);
      // Przycisk "Dalej" znika po ostatniej kwestii: fokus na rozmowę, żeby klawiatura nie wracała na początek strony.
      if (!review) setTimeout(() => logRef.current?.focus(), 0);
    }
  }

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      {character && (
        <div className="mb-3 flex items-center gap-3">
          {avatarUrl && !avatarFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
            <img
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
              onError={() => setAvatarFailed(true)}
            />
          )}
          <p className="text-sm text-slate-600">
            Rozmawiasz z: <span className="font-semibold text-slate-900">{character.name}</span>
            {character.role && <span>, {character.role}</span>}
          </p>
        </div>
      )}

      <ol ref={logRef} tabIndex={-1} aria-label="Rozmowa" aria-live="polite" className="mb-4 space-y-3 focus:outline-none">
        {progress.map((entry) => {
          const question = questions.find((candidate) => candidate.id === entry.id);
          if (!question) return null;
          const lines = linesOf(entry.id).slice(0, entry.shown);
          return (
            <li key={entry.id} className="space-y-2">
              <p className="ml-auto max-w-[85%] rounded-lg bg-indigo-50 px-3 py-2 text-slate-900">
                <span className="sr-only">Ty: </span>
                {question.text}
              </p>
              {lines.map((line, index) => (
                <p key={index} className="max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
                  <span className="sr-only">{character?.name ?? 'Postać'}: </span>
                  {line}
                </p>
              ))}
            </li>
          );
        })}
      </ol>

      {current && (
        <button
          type="button"
          onClick={next}
          className="mb-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {/* Nie "Dalej": ten napis ma przycisk nawigacji powłoki (dwa "Dalej" obok siebie myliłyby też czytniki ekranu). */}
          Następna kwestia
        </button>
      )}

      <ul aria-label="Pytania do zadania" className="space-y-2">
        {/* Zadane pytania zostają na liście jako nieaktywne: usunięcie klikniętego przycisku gubiłoby fokus klawiatury. */}
        {questions.map((question) => {
          const done = asked.includes(question.id);
          const blocked = done || current !== null;
          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => ask(question.id)}
                aria-disabled={blocked}
                className={`min-h-[44px] w-full rounded border px-3 py-2 text-left text-sm font-medium ${
                  blocked ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                {question.text}
                {done && <span className="sr-only"> (zadane)</span>}
                {done && <span aria-hidden="true"> ✓</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <ExploreFooter
        done={doneCount}
        total={required.length}
        noun="pytań"
        verb="Zadano"
        readyText="Wszystkie wymagane pytania zadane."
        onSubmit={() => onSubmit({ asked })}
        disabled={disabled}
        review={review}
      />
    </div>
  );
}
