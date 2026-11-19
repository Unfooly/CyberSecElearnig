'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { useCompleteHint } from '../player/hints';
import { SimpleMarkdown } from '../simple-markdown';
import ExploreFooter from './ExploreFooter';

// Zakładki według wzorca ARIA (tablist/tab/tabpanel, strzałki, Home/End, roving tabindex). Zakładka liczy się jako otwarta po wyświetleniu.
// Odpowiedź dla serwera: { opened: [id...] }.
export default function TabsBlock({
  block,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  onSubmit: (answer: { opened: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane zakładki otwarte) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const tabs = block.tabs ?? [];
  const [activeId, setActiveId] = useState<string | null>(tabs[0]?.id ?? null);
  const [opened, setOpened] = useState<string[]>(tabs[0] ? [tabs[0].id] : []);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = `tabs-${useId()}`; // unikalne także dla dwóch zamontowanych bloków (ukryty bieżący + podgląd)

  // Jak na serwerze: requiredTabs albo wszystkie zakładki (zakładki nie mają flag required).
  const required = block.requiredTabs ?? tabs.map((tab) => tab.id);
  const doneCount = required.filter((id) => opened.includes(id)).length;
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const ready = doneCount >= required.length;
  useCompleteHint(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ opened }) : null);
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, review]);

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

  // Teczka sprawy (D-178, `look: 'folder'`): manilowa teczka z przekładkami (zakładki), kartka papieru i opcjonalna pieczątka. Te same role
  // ARIA i klawiatura - zmieniają się wyłącznie klasy.
  const folder = block.look === 'folder';
  const tabClass = (selected: boolean) =>
    folder
      ? `min-h-[44px] rounded-t-xl px-4 py-2 text-sm font-bold ${selected ? 'bg-[#FBF8F1] text-ink' : 'bg-[#D6C495] text-[#4A3B1C] hover:bg-[#E0CFA3]'}`
      : `min-h-[44px] rounded-t border-b-2 px-3 py-2 text-sm font-medium ${
          selected ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'
        }`;

  const content = (
    <>
      <div
        role="tablist"
        aria-label={block.title ?? 'Zakładki'}
        // Miejsce na pieczątkę: na telefonie tekst rośnie do 15 px (.mobile-readable), stąd szersza rezerwa.
        className={folder ? `flex flex-wrap gap-1.5 ${block.stamp ? 'pr-40 sm:pr-44' : ''}` : 'mb-3 flex flex-wrap gap-1 border-b border-slate-200'}
      >
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
            className={tabClass(activeId === tab.id)}
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
          data-testid={folder ? 'folder-sheet' : undefined}
          className={
            folder
              ? 'min-h-[220px] rounded-b-xl rounded-tr-xl bg-[#FBF8F1] p-5 text-ink shadow-[0_1px_0_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(74,59,28,0.08)] sm:p-7'
              : 'rounded bg-slate-50 p-3'
          }
        >
          <div className={folder ? 'space-y-3 text-[15px] leading-relaxed sm:text-base' : 'space-y-2 text-slate-800'}>
            <SimpleMarkdown text={active.content} />
          </div>
        </div>
      )}
    </>
  );

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      {folder ? (
        <div data-testid="folder" className="relative rounded-2xl bg-[#E7D6AC] p-3 shadow-card sm:p-5">
          {block.stamp && (
            <p
              data-testid="folder-stamp"
              // Ciemniejsza czerwień (#A3271B) - kontrast ≥ 4.5:1 na kremowej teczce (WCAG AA dla tekstu 12-15 px).
              className="pointer-events-none absolute right-3 top-3 z-10 rotate-[-6deg] rounded-md border-[3px] border-[#A3271B] px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-[0.08em] text-[#A3271B] sm:right-5 sm:top-4 sm:text-sm"
            >
              {block.stamp}
            </p>
          )}
          {content}
        </div>
      ) : (
        content
      )}
      <ExploreFooter done={doneCount} total={required.length} noun="zakładek" review={review} />
    </div>
  );
}
