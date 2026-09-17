'use client';

import { useId, useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';

// Wspólna logika dla QuizBlock i BranchingScenarioBlock - identyczny
// mechanizm UI (prompt + jednokrotny wybór), różni się tylko copy
// (nagłówek, tekst przycisku), więc nie duplikujemy całego komponentu.
export default function SingleChoiceBlock({
  block,
  onSubmit,
  disabled,
  heading,
  submitLabel,
  groupName,
}: {
  block: ContentBlock;
  onSubmit: (answer: number) => void;
  disabled: boolean;
  heading: string;
  submitLabel: string;
  groupName: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const promptId = useId();
  const options = block.options ?? [];

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{heading}</p>
      <p id={promptId} className="mb-4 text-lg text-slate-900">
        {block.prompt}
      </p>

      {/* aria-labelledby zamiast duplikującego treść <legend> - prompt jest
          już widoczny powyżej, nie trzeba go powtarzać dla czytników ekranu. */}
      <fieldset className="space-y-2" disabled={disabled} aria-labelledby={promptId}>
        {options.map((option, index) => (
          <label
            key={index}
            className="flex cursor-pointer items-center gap-3 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={groupName}
              checked={selected === index}
              onChange={() => setSelected(index)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        disabled={selected === null || disabled}
        onClick={() => selected !== null && onSubmit(selected)}
        className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}
