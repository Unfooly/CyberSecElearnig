'use client';

import type { ContentBlock } from '@/lib/courses-types';
import SceneHotspotsBlock from './SceneHotspotsBlock';
import DialogueBlock from './DialogueBlock';
import TabsBlock from './TabsBlock';
import NotepadBlock from './NotepadBlock';
import SummaryBlock from './SummaryBlock';

// Bloki eksploracyjne (nieoceniane): po przejrzeniu wymaganych elementów blok się kończy bez punktów. Ten sam komponent służy do
// podglądu ("Wstecz", review=true: bez zapisu i przycisku ukończenia), więc ukończony blok można przejść ponownie bez skutku na serwerze.
export const EXPLORATORY_TYPES = ['SCENE_HOTSPOTS', 'DIALOGUE', 'NOTEPAD', 'TABS', 'SUMMARY'] as const;

export function isExploratory(type: string): boolean {
  return (EXPLORATORY_TYPES as readonly string[]).includes(type);
}

export default function ExploratoryBlock({
  block,
  contentBase,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer?: unknown) => void;
  disabled: boolean;
  review?: boolean;
}) {
  switch (block.type) {
    case 'SCENE_HOTSPOTS':
      return <SceneHotspotsBlock block={block} contentBase={contentBase} onSubmit={onSubmit} disabled={disabled} review={review} />;
    case 'DIALOGUE':
      return <DialogueBlock block={block} contentBase={contentBase} onSubmit={onSubmit} disabled={disabled} review={review} />;
    case 'TABS':
      return <TabsBlock block={block} onSubmit={onSubmit} disabled={disabled} review={review} />;
    case 'NOTEPAD':
      return <NotepadBlock block={block} onSubmit={() => onSubmit()} disabled={disabled} review={review} />;
    case 'SUMMARY':
      return <SummaryBlock block={block} onSubmit={() => onSubmit()} disabled={disabled} review={review} />;
    default:
      return null;
  }
}
