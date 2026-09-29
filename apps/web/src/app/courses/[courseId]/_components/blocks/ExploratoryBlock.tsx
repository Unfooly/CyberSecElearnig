'use client';

import type { ContentBlock } from '@/lib/courses-types';
import { ANONYMOUS_IDENTITY, type PlayerIdentity } from '@/lib/use-my-display-name';
import type { NotebookTask } from '../player/notes';
import SceneHotspotsBlock from './SceneHotspotsBlock';
import DialogueBlock from './DialogueBlock';
import TabsBlock from './TabsBlock';
import NotepadBlock from './NotepadBlock';
import SummaryBlock from './SummaryBlock';
import NarrativeBlock from './NarrativeBlock';
import BriefingBlock from './BriefingBlock';
import DossierBlock from './DossierBlock';
import AnnotatedReplayBlock from './AnnotatedReplayBlock';

// Bloki eksploracyjne (nieoceniane): po przejrzeniu wymaganych elementów blok się kończy bez punktów. Ten sam komponent służy do
// podglądu ("Wstecz", review=true: bez zapisu i przycisku ukończenia), więc ukończony blok można przejść ponownie bez skutku na serwerze.
export const EXPLORATORY_TYPES = ['SCENE_HOTSPOTS', 'DIALOGUE', 'NOTEPAD', 'TABS', 'SUMMARY', 'NARRATIVE', 'BRIEFING', 'DOSSIER', 'ANNOTATED_REPLAY'] as const;

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
  tasks,
  identity,
  onBriefingStep,
  briefingSkip = 0,
  moduleBlocks = [],
}: {
  block: ContentBlock;
  /** Bloki modułu (ANNOTATED_REPLAY czyta transkrypcję z bloku CALL_RECORDING). */
  moduleBlocks?: ContentBlock[];
  contentBase: string;
  onSubmit: (answer?: unknown) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki - jedynego przejścia dalej (D-106), we wszystkich typach. */
  onReady: (submit: (() => void) | null) => void;
  /** Zapis w toku - przedmiot ostatniego kroku BRIEFING nie reaguje. */
  disabled: boolean;
  /** „Pomiń odprawę” (D-106): zmiana licznika = BRIEFING przeskakuje na ostatni krok. */
  briefingSkip?: number;
  review?: boolean;
  myAvatarUrl?: string | null;
  myInitials?: string;
  /** BRIEFING: zadania pod kartą sprawy, tożsamość gracza (tylko z sesji) i zmiana kroku (narracja w pasku powłoki). */
  tasks?: NotebookTask[];
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
    case 'DOSSIER':
      return <DossierBlock block={block} onSubmit={onSubmit} onReady={onReady} review={review} />;
    case 'NOTEPAD':
      return <NotepadBlock block={block} onSubmit={() => onSubmit()} onReady={onReady} review={review} />;
    case 'SUMMARY':
      return <SummaryBlock block={block} onSubmit={() => onSubmit()} onReady={onReady} review={review} />;
    case 'NARRATIVE':
      return <NarrativeBlock block={block} onSubmit={() => onSubmit()} onReady={onReady} review={review} />;
    case 'BRIEFING':
      return (
        <BriefingBlock
          block={block}
          contentBase={contentBase}
          onSubmit={() => onSubmit()}
          onReady={onReady}
          skipSignal={briefingSkip}
          review={review}
          disabled={disabled}
          tasks={tasks}
          identity={identity ?? ANONYMOUS_IDENTITY}
          myAvatarUrl={myAvatarUrl ?? null}
          onStepChange={onBriefingStep}
        />
      );
    case 'ANNOTATED_REPLAY':
      return (
        <AnnotatedReplayBlock
          block={block}
          moduleBlocks={moduleBlocks}
          contentBase={contentBase}
          onSubmit={onSubmit}
          onReady={onReady}
          review={review}
          onStepChange={onBriefingStep}
        />
      );
    default:
      return null;
  }
}
