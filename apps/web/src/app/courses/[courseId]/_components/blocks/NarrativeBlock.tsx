'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { useCompleteReaction } from '../player/mascot-reaction';
import { SimpleMarkdown } from '../simple-markdown';

// Blok narracyjny (schemaVersion 4): sam tekst, bez interakcji poza "Dalej" - w przeciwieństwie do SUMMARY może wystąpić wielokrotnie,
// w dowolnym miejscu modułu (np. wprowadzenie do sceny). Reakcja maskotki na ukończenie (reactions.complete) odpala się od razu po
// zamontowaniu: blok nie ma nic do "pokrycia" (patrz mascot-reaction.tsx, useCompleteReaction).
export default function NarrativeBlock({
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
  useCompleteReaction(block.reactions?.complete, true, review);

  return (
    <div>
      {block.title && <p className="mb-3 text-lg font-medium text-slate-900">{block.title}</p>}
      {block.text && (
        <div className="space-y-2 text-slate-800">
          <SimpleMarkdown text={block.text} />
        </div>
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
