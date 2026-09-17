'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';

const DEFAULT_CATEGORIES: [string, string] = ['Bezpieczne', 'Phishing'];

// Uproszczona wersja zamiast prawdziwego drag&drop - patrz plan/README:
// backend NIE ocenia bloków DRAG_AND_DROP (tak jak VIDEO, nie ma go w
// SCOREABLE_BLOCK_TYPES w CoursesService), więc prawdziwe przeciąganie
// dawałoby złudzenie oceniania, którego i tak nie ma. Zamiast tego: lista
// elementów z dwoma przyciskami klasyfikującymi każdy z nich.
export default function DragAndDropBlock({
  block,
  onSubmit,
  disabled,
}: {
  block: ContentBlock;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const items = block.items ?? [];
  const categories = block.categories ?? DEFAULT_CATEGORIES;
  const [classified, setClassified] = useState<Record<number, 0 | 1>>({});

  const allDone = items.length > 0 && Object.keys(classified).length === items.length;

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Posegreguj</p>
      <p className="mb-4 text-lg text-slate-900">{block.prompt}</p>

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"
          >
            <span>{item.text}</span>
            <div className="flex gap-2">
              {categories.map((category, categoryIndex) => (
                <button
                  key={category}
                  type="button"
                  disabled={disabled}
                  aria-pressed={classified[index] === categoryIndex}
                  onClick={() =>
                    setClassified((prev) => ({ ...prev, [index]: categoryIndex as 0 | 1 }))
                  }
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    classified[index] === categoryIndex
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={!allDone || disabled}
        onClick={() => onSubmit()}
        className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Dalej
      </button>
    </div>
  );
}
