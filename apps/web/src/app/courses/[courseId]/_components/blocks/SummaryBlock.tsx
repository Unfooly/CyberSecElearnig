'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { GroupedNotes, useNotes } from '../player/notes';
import { hasEvidence, useEvidence } from '../player/evidence';
import { useCompleteReaction } from '../player/mascot-reaction';
import { SimpleMarkdown } from '../simple-markdown';

// Polska liczba mnoga: 1 dowód pozostał nieodkryty; 2-4 dowody pozostały nieodkryte; 5+ (także 12-14) dowodów pozostało nieodkrytych.
function missedPhrase(count: number): string {
  if (count === 1) return '1 dowód w tej scenie pozostał nieodkryty';
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)
    ? `${count} dowody w tej scenie pozostały nieodkryte`
    : `${count} dowodów w tej scenie pozostało nieodkrytych`;
}

// Podsumowanie modułu. Gdy moduł ma dowody, to "Rozwiązanie sprawy": zebrane dowody vs wszystkie (liczby z serwera), przeoczone WYŁĄCZNIE
// liczbowo per scena (bez treści i nazw elementów), wnioski (tekst z treści), zebrane notatki i przycisk "Zakończ sprawę". Bez dowodów: zwykłe
// podsumowanie. Wynik punktowy i nagrody pokazuje ekran po ukończeniu (SummaryScreen), bo wynik jest znany dopiero po zapisie ostatniego bloku.
// Certyfikat: B-069.
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
  const { notes, blockTitles } = useNotes();
  const { summary, pending } = useEvidence();
  const investigation = hasEvidence(summary);
  const collected = summary.collected + pending;
  const total = summary.total;
  useCompleteReaction(block.reactions?.complete, true, review);

  return (
    <div>
      <p className="mb-3 text-lg font-medium text-slate-900">{block.title ?? (investigation ? 'Rozwiązanie sprawy' : 'Podsumowanie')}</p>
      {block.text && <div className="mb-4 space-y-2 text-slate-800"><SimpleMarkdown text={block.text} /></div>}

      {investigation && (
        <section aria-label="Dowody" data-testid="case-evidence" className="mb-4 rounded bg-indigo-50 p-4 ring-1 ring-indigo-200">
          <h3 className="mb-2 text-sm font-semibold text-indigo-900">
            Zebrane dowody: {collected} z {total}
          </h3>
          <ul className="space-y-1 text-sm text-slate-800">
            {summary.perBlock.map((entry) => {
              const missed = Math.max(0, entry.total - entry.collected);
              return (
                <li key={entry.blockId}>
                  <span className="font-medium">{blockTitles[entry.blockId] ?? 'Scena'}</span>
                  {': '}
                  {entry.collected} z {entry.total}
                  {missed > 0 && (
                    <span className="text-slate-600"> ({missedPhrase(missed)})</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section aria-label="Twoje notatki" className="rounded bg-amber-50 p-4 ring-1 ring-amber-200">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Najważniejsze wnioski</h3>
          <GroupedNotes notes={notes} blockTitles={blockTitles} />
        </section>
      )}

      {!review && (
        <>
          {investigation && <p className="mt-4 text-sm text-slate-600">Wynik z zadań zobaczysz po zakończeniu sprawy.</p>}
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className="mt-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {investigation ? 'Zakończ sprawę' : 'Zakończ szkolenie'}
          </button>
        </>
      )}
    </div>
  );
}
