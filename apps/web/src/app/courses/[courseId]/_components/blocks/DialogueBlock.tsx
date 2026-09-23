'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import ExploreFooter from './ExploreFooter';

// Kwestia postaci: avatar PRZY KAŻDEJ wiadomości (nie tylko w nagłówku) - jak w prawdziwym komunikatorze. Na poziomie
// MODUŁU (nie wewnątrz DialogueBlock): zdefiniowany w ciele komponentu dostawałby nową tożsamość przy KAŻDYM renderze
// rodzica, więc React odmontowywałby i montował na nowo WSZYSTKIE dymki wątku przy każdej zmianie stanu (progress,
// avatarFailed), nie tylko nowy - zbędna praca uzgadniania.
function CharacterBubble({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  speakerName,
  children,
}: {
  avatarUrl: string | null;
  avatarFailed: boolean;
  onAvatarError: () => void;
  speakerName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end gap-2">
      {avatarUrl && !avatarFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          onError={onAvatarError}
        />
      ) : (
        <span aria-hidden="true" className="h-8 w-8 shrink-0" />
      )}
      <p className="max-w-[75%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
        <span className="sr-only">{speakerName}: </span>
        {children}
      </p>
    </div>
  );
}

// Rozmowa z postacią w stylu komunikatora: kwestie postaci Z LEWEJ z jej avatarem PRZY KAŻDEJ kwestii (nie tylko w nagłówku), pytania
// gracza Z PRAWEJ w kolorze akcentu bez avatara (jak "Ty" w czacie). Gracz wybiera pytanie z listy "chipów" pod rozmową; zadane pytanie
// znika z listy chipów (zostaje widoczne w wątku rozmowy). Postać odpowiada KWESTIAMI PO KOLEI (klik "Następna kwestia" w dymku, nie cały
// tekst naraz; odpowiedź bez `lines` to jedna kwestia). Pytanie liczy się jako zadane, gdy wszystkie kwestie zostały wypowiedziane;
// dopiero wtedy pytanie z notatką dopisuje wpis do notatnika (dowód, gdy `evidence`). Podczas rozmowy pozostałe pytania są nieaktywne.
// Notatki dopisywane są tylko poza podglądem (serwer i tak sam wylicza je przy zapisie bloku). Avatar postaci tylko przez <img> z bazy
// zasobów. Odpowiedź dla serwera: { asked: [id...] } w kolejności ukończenia.
export default function DialogueBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { asked: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane pytania zadane) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
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
  const ready = doneCount >= required.length;
  useCompleteReaction(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ asked }) : null);
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, review]);

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
    if (linesOf(id).length <= 1) {
      finish(id);
      // Pytanie JEDNOKWESTYJNE kończy się od razu w TYM kliknięciu: jego chip znika z listy w tym samym renderze, co
      // klikany przycisk - bez przeniesienia fokusu klawiatura/czytnik ekranu zgubiłby fokus (ląduje na <body>), tak
      // samo jak przy ostatniej kwestii pytania wielokwestyjnego (patrz next() niżej - ten sam fix, ten sam powód).
      if (!review) setTimeout(() => logRef.current?.focus(), 0);
    }
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

  const availableQuestions = questions.filter((question) => !asked.includes(question.id));
  const speakerName = character?.name ?? 'Postać';
  const onAvatarError = () => setAvatarFailed(true);

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      {character && (
        <div className="mb-3 flex items-center gap-3">
          {avatarUrl && !avatarFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
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
        {character?.opening && (
          <li>
            <CharacterBubble
              avatarUrl={avatarUrl}
              avatarFailed={avatarFailed}
              onAvatarError={onAvatarError}
              speakerName={speakerName}
            >
              {character.opening}
            </CharacterBubble>
          </li>
        )}
        {progress.map((entry) => {
          const question = questions.find((candidate) => candidate.id === entry.id);
          if (!question) return null;
          const lines = linesOf(entry.id).slice(0, entry.shown);
          return (
            <li key={entry.id} className="space-y-2">
              <p className="ml-auto max-w-[75%] rounded-lg bg-indigo-600 px-3 py-2 text-white">
                <span className="sr-only">Ty: </span>
                {question.text}
              </p>
              {lines.map((line, index) => (
                <CharacterBubble
                  key={index}
                  avatarUrl={avatarUrl}
                  avatarFailed={avatarFailed}
                  onAvatarError={onAvatarError}
                  speakerName={speakerName}
                >
                  {line}
                </CharacterBubble>
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

      {availableQuestions.length > 0 && (
        <ul aria-label="Pytania do zadania" className="flex flex-wrap gap-2">
          {/* Chipy: zadane pytanie znika stąd (zostaje w wątku wyżej) - lista pokazuje tylko to, co jeszcze można zapytać. */}
          {availableQuestions.map((question) => (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => ask(question.id)}
                aria-disabled={current !== null}
                className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium ${
                  current !== null ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                }`}
              >
                {question.text}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ExploreFooter done={doneCount} total={required.length} noun="pytań" verb="Zadano" readyText="Wszystkie wymagane pytania zadane." review={review} />
    </div>
  );
}
