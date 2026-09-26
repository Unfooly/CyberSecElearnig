'use client';

import type { ContentBlock, CourseObjective } from '@/lib/courses-types';
import type { PlayerIdentity } from '@/lib/use-my-display-name';
import SceneHotspotsBlock from './SceneHotspotsBlock';
import DialogueBlock from './DialogueBlock';
import TabsBlock from './TabsBlock';
import NotepadBlock from './NotepadBlock';
import SummaryBlock from './SummaryBlock';
import NarrativeBlock from './NarrativeBlock';
import BriefingBlock from './BriefingBlock';

// Bloki eksploracyjne (nieoceniane): po przejrzeniu wymaganych elementów blok się kończy bez punktów. Ten sam komponent służy do
// podglądu ("Wstecz", review=true: bez zapisu i przycisku ukończenia), więc ukończony blok można przejść ponownie bez skutku na serwerze.
export const EXPLORATORY_TYPES = ['SCENE_HOTSPOTS', 'DIALOGUE', 'NOTEPAD', 'TABS', 'SUMMARY', 'NARRATIVE', 'BRIEFING'] as const;

const ANONYMOUS: PlayerIdentity = { label: 'Detektyw', initials: 'D' };

export function isExploratory(type: string): boolean {
  return (EXPLORATORY_TYPES as readonly string[]).includes(type);
}

export default function ExploratoryBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  disabled,
  review = false,
  myAvatarUrl,
  myInitials,
  objectives,
  identity,
  onBriefingStep,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer?: unknown) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (SCENE_HOTSPOTS/DIALOGUE/TABS/NOTEPAD/NARRATIVE) - SUMMARY ma własny, jedyny przycisk. */
  onReady: (submit: (() => void) | null) => void;
  /** SUMMARY i ostatni krok BRIEFING: reszta typów nie ma już własnego przycisku ukończenia (patrz ExploreFooter, onReady). */
  disabled: boolean;
  review?: boolean;
  myAvatarUrl?: string | null;
  myInitials?: string;
  /** BRIEFING: zadania pod kartą sprawy, tożsamość gracza (tylko z sesji) i zmiana kroku (narracja w pasku powłoki). */
  objectives?: CourseObjective[];
  identity?: PlayerIdentity;
  onBriefingStep?: (index: number, byGesture: boolean) => void;
}) {
  switch (block.type) {
    case 'SCENE_HOTSPOTS':
      return <SceneHotspotsBlock block={block} contentBase={contentBase} onSubmit={onSubmit} onReady={onReady} review={review} />;
    case 'DIALOGUE':
      return (
        <DialogueBlock
          block={block}
          contentBase={contentBase}
          onSubmit={onSubmit}
          onReady={onReady}
          review={review}
          myAvatarUrl={myAvatarUrl}
          myInitials={myInitials}
        />
      );
    case 'TABS':
      return <TabsBlock block={block} onSubmit={onSubmit} onReady={onReady} review={review} />;
    case 'NOTEPAD':
      return <NotepadBlock block={block} onSubmit={() => onSubmit()} onReady={onReady} review={review} />;
    case 'SUMMARY':
      return <SummaryBlock block={block} onSubmit={() => onSubmit()} disabled={disabled} review={review} />;
    case 'NARRATIVE':
      return <NarrativeBlock block={block} onSubmit={() => onSubmit()} onReady={onReady} review={review} />;
    case 'BRIEFING':
      return (
        <BriefingBlock
          block={block}
          contentBase={contentBase}
          onSubmit={() => onSubmit()}
          review={review}
          disabled={disabled}
          objectives={objectives}
          identity={identity ?? ANONYMOUS}
          myAvatarUrl={myAvatarUrl ?? null}
          onStepChange={onBriefingStep}
        />
      );
    default:
      return null;
  }
}
