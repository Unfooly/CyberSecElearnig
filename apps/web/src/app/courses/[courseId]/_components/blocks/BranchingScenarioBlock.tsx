import type { ContentBlock } from '@/lib/courses-types';
import SingleChoiceBlock from './SingleChoiceBlock';

export default function BranchingScenarioBlock({
  block,
  onSubmit,
  disabled,
}: {
  block: ContentBlock;
  onSubmit: (answer: number) => void;
  disabled: boolean;
}) {
  return (
    <SingleChoiceBlock
      block={block}
      onSubmit={onSubmit}
      disabled={disabled}
      heading="Scenariusz"
      submitLabel="Co robisz?"
      groupName="scenario-option"
    />
  );
}
