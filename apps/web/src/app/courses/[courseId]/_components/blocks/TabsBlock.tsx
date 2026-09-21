'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import ExploreFooter from './ExploreFooter';

// Zakładki według wzorca ARIA (tablist/tab/tabpanel, strzałki, Home/End, roving tabindex). Zakładka liczy się jako otwarta po wyświetleniu.
// Odpowiedź dla serwera: { opened: [id...] }.
export default function TabsBlock({
  block,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: (answer: { opened: string[] }) => void;
  disabled: boolean;
  review?: boolean;
}) {
  const tabs = block.tabs ?? [];
  const [activeId, setActiveId] = useState<string | null>(tabs[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(tabs[0] ? [tabs[0].id] : []);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = `tabs-${block.id ?? 'x'}`;

  // Jak na serwerze: requiredTabs albo wszystkie zakładki (zakładki nie mają flag required).
  const required = block.requiredTabs ?? tabs.map((tab) => tab.id);
  const doneCount = required.filter((id) => opened.includes(id)).length;
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  function select(id: string, focus = false) {
    setActiveId(id);
    setOpened((current) => (current.includes(id) ? current : [...current, id]));
    if (focus) buttons.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return; // np. Alt+strzałka to nawigacja przeglądarki
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    if (target < 0) return;
    event.preventDefault();
    select(tabs[target].id, true);
  }

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      <div role="tablist" aria-label={block.title ?? 'Zakładki'} className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[tab.id] = element;
            }}
            id={`${baseId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            aria-controls={activeId === tab.id ? `${baseId}-panel-${tab.id}` : undefined}
            tabIndex={activeId === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-[44px] rounded-t border-b-2 px-3 py-2 text-sm font-medium ${
              activeId === tab.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.title}
            {opened.includes(tab.id) && activeId !== tab.id && <span aria-hidden="true"> ✓</span>}
          </button>
        ))}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className="rounded bg-slate-50 p-3"
        >
          <p className="whitespace-pre-line text-slate-800">{active.content}</p>
        </div>
      )}
      <ExploreFooter
        done={doneCount}
        total={required.length}
        noun="zakładek"
        onSubmit={() => onSubmit({ opened })}
        disabled={disabled}
        review={review}
      />
    </div>
  );
}
