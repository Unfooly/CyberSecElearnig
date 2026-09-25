'use client';

import { useEvidence, hasEvidence } from './player/evidence';
import { useNotes } from './player/notes';

// Polska liczba mnoga: 1 dowód pozostał nieodkryty; 2-4 dowody pozostały nieodkryte; 5+ (także 12-14) dowodów pozostało nieodkrytych.
function missedPhrase(count: number): string {
  if (count === 1) return '1 dowód w tej scenie pozostał nieodkryty';
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)
    ? `${count} dowody w tej scenie pozostały nieodkryte`
    : `${count} dowodów w tej scenie pozostało nieodkrytych`;
}

// Lista zebranych dowodów: zebrane vs wszystkie (liczby z serwera), przeoczone WYŁĄCZNIE liczbowo per scena (bez
// treści i nazw elementów). Wydzielone z SummaryBlock.tsx (fix/course-finish-flow) - SummaryScreen.tsx pokazuje TĘ
// SAMĄ listę po ukończeniu kursu (user widział ją już na bloku SUMMARY chwilę wcześniej, ale ten ekran całkiem
// zastępuje treść bloku, więc bez tego dowody by "zniknęły" z widoku). Moduły bez dowodów (hasEvidence=false) -
// null, tak jak SummaryBlock.tsx.
export default function CaseEvidenceSection({ className = '' }: { className?: string }) {
  const { blockTitles } = useNotes();
  const { summary, pending } = useEvidence();
  if (!hasEvidence(summary)) return null;
  const collected = summary.collected + pending;
  const total = summary.total;

  return (
    <section aria-label="Dowody" data-testid="case-evidence" className={`rounded bg-indigo-50 p-4 ring-1 ring-indigo-200 ${className}`}>
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
              {missed > 0 && <span className="text-slate-600"> ({missedPhrase(missed)})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
