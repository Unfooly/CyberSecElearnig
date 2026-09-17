import type { ContentBlock } from '@/lib/courses-types';
import SingleChoiceBlock from './SingleChoiceBlock';

export default function QuizBlock({
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
      heading="Pytanie"
      submitLabel="Wybierz odpowiedź"
      groupName="quiz-option"
    />
  );
}
