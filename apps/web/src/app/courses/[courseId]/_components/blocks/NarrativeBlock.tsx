'use client';

import { useEffect } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { useCompleteReaction } from '../player/mascot-reaction';
import { SimpleMarkdown } from '../simple-markdown';

// Blok narracyjny (schemaVersion 4): sam tekst, bez interakcji poza "Dalej" - w przeciwieństwie do SUMMARY może wystąpić wielokrotnie,
// w dowolnym miejscu modułu (np. wprowadzenie do sceny). Reakcja maskotki na ukończenie (reactions.complete) odpala się od razu po
// zamontowaniu: blok nie ma nic do "pokrycia" (patrz mascot-reaction.tsx, useCompleteReaction). "Dalej" jest wyłącznie w pasku powłoki
// (bez osobnego przycisku tutaj), gotowe od razu po zamontowaniu - patrz ExploreFooter.
export default function NarrativeBlock({
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
  useCompleteReaction(block.reactions?.complete, true, review);

  useEffect(() => {
    if (review) return;
    onReady(() => onSubmit());
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  return (
    <div>
      {block.title && <p className="mb-3 text-lg font-medium text-slate-900">{block.title}</p>}
      {block.text && (
        <div className="space-y-2 text-slate-800">
          <SimpleMarkdown text={block.text} />
        </div>
      )}
    </div>
  );
}
