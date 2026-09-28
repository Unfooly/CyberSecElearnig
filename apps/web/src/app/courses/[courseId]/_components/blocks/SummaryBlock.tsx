'use client';

import { useEffect } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { GroupedNotes, useNotes } from '../player/notes';
import { hasEvidence, useEvidence } from '../player/evidence';
import { useCompleteHint } from '../player/hints';
import { SimpleMarkdown } from '../simple-markdown';
import CaseEvidenceSection from '../CaseEvidenceSection';

// Podsumowanie modułu. Gdy moduł ma dowody, to "Rozwiązanie sprawy": zebrane dowody vs wszystkie (CaseEvidenceSection.tsx),
// wnioski (tekst z treści) i zebrane notatki. Bez dowodów: zwykłe podsumowanie. Blok jest gotowy od razu: „Zakończ sprawę”
// („Zakończ szkolenie”) to etykieta „Dalej” w dolnym pasku - jedynego przejścia dalej (D-106). Wynik punktowy i nagrody pokazuje
// ekran zamknięcia sprawy (CaseClosedScreen, D-089), bo wynik jest znany dopiero po zapisie ostatniego bloku. Certyfikat: B-069.
export default function SummaryBlock({
  block,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  onReady?: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const { notes, blockTitles } = useNotes();
  const { summary } = useEvidence();
  const investigation = hasEvidence(summary);
  useCompleteHint(block.reactions?.complete, true, review);

  useEffect(() => {
    if (!review) onReady?.(() => onSubmit());
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  return (
    <div>
      <p className="mb-3 text-lg font-medium text-slate-900">{block.title ?? (investigation ? 'Rozwiązanie sprawy' : 'Podsumowanie')}</p>
      {block.text && <div className="mb-4 space-y-2 text-slate-800"><SimpleMarkdown text={block.text} /></div>}

      <CaseEvidenceSection className="mb-4" />

      {notes.length > 0 && (
        <section aria-label="Twoje notatki" className="rounded bg-amber-50 p-4 ring-1 ring-amber-200">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Najważniejsze wnioski</h3>
          <GroupedNotes notes={notes} blockTitles={blockTitles} />
        </section>
      )}

      {!review && investigation && <p className="mt-4 text-sm text-slate-600">Wynik z zadań zobaczysz po zakończeniu sprawy.</p>}
    </div>
  );
}
