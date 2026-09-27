'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { GroupedNotes, useNotes } from '../player/notes';
import { hasEvidence, useEvidence } from '../player/evidence';
import { useCompleteHint } from '../player/hints';
import { SimpleMarkdown } from '../simple-markdown';
import CaseEvidenceSection from '../CaseEvidenceSection';

// Podsumowanie modułu. Gdy moduł ma dowody, to "Rozwiązanie sprawy": zebrane dowody vs wszystkie (CaseEvidenceSection.tsx),
// wnioski (tekst z treści), zebrane notatki i przycisk "Zakończ sprawę". Bez dowodów: zwykłe podsumowanie. Wynik punktowy
// i nagrody pokazuje ekran zamknięcia sprawy (CaseClosedScreen, D-089), bo wynik jest znany dopiero po zapisie ostatniego
// bloku. Certyfikat: B-069.
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
  const { summary } = useEvidence();
  const investigation = hasEvidence(summary);
  useCompleteHint(block.reactions?.complete, true, review);

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
