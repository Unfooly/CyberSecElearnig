import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { EvidenceCounter, EvidenceProvider, useEvidence } from './evidence';
import { TaskList, type NotebookTask } from './notes';
import TranscriptPanel from './TranscriptPanel';

describe('TranscriptPanel: wyjście 140 ms (usePresence)', () => {
  it('po zamknięciu: stan "closing" bez interakcji (aria-hidden, X poza Tab), fokus wraca na "Transkrypcja", po 140 ms panel znika', () => {
    vi.useFakeTimers();
    try {
      const trigger = document.createElement('button');
      document.body.append(trigger);
      const triggerRef = createRef<HTMLButtonElement>() as { current: HTMLButtonElement | null };
      triggerRef.current = trigger;
      const props = { text: 'Treść.', onClose: vi.fn(), triggerRef: triggerRef as React.RefObject<HTMLButtonElement> };
      const { rerender, container } = render(<TranscriptPanel {...props} open />);
      expect(screen.getByRole('region', { name: 'Transkrypcja narracji' })).toHaveClass('motion-safe:animate-overlay-in');

      rerender(<TranscriptPanel {...props} open={false} />);
      const panel = container.querySelector('[data-state="closing"]');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(panel).toHaveClass('pointer-events-none', 'motion-safe:animate-overlay-out');
      expect(panel?.querySelector('button')).toHaveAttribute('tabindex', '-1');
      expect(trigger).toHaveFocus();

      act(() => {
        vi.advanceTimersByTime(140);
      });
      expect(container).toBeEmptyDOMElement();
      trigger.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Ruch w odtwarzaczu (D-090): przewinięcie cyfry licznika i rysowany ptaszek zadania - tylko przy zmianie w tej sesji, pod motion-safe.

describe('EvidenceCounter: przewinięcie cyfry', () => {
  it('bez animacji przy wejściu (dowody z serwera), z animacją motion-safe po nowym dowodzie', () => {
    let add: (key: string) => void = () => {};
    function Grab() {
      add = useEvidence().addPending;
      return null;
    }
    render(
      <EvidenceProvider summary={{ collected: 2, total: 5, perBlock: [{ blockId: 'b', collected: 2, total: 5 }] }}>
        <EvidenceCounter />
        <Grab />
      </EvidenceProvider>,
    );
    expect(screen.getByTestId('evidence-count')).toHaveTextContent('2');
    expect(screen.getByTestId('evidence-count').className).not.toMatch(/animate-digit-roll/);

    act(() => add('b.h1'));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 3/5');
    expect(screen.getByTestId('evidence-count')).toHaveClass('motion-safe:animate-digit-roll');
  });
});

describe('TaskList: rysowany ptaszek', () => {
  const tasks = (done: boolean[]): NotebookTask[] => done.map((d, i) => ({ text: `Zadanie ${i + 1}`, done: d }));
  const draws = () => screen.queryAllByTestId('task-check').map((svg) => svg.querySelector('path')?.getAttribute('class') ?? '');

  it('zadanie wykonane przy wejściu stoi od razu; wykonane później rysuje się raz, przy pierwszym otwarciu notatnika', () => {
    const { rerender } = render(<TaskList tasks={tasks([true, false])} open={false} />);
    rerender(<TaskList tasks={tasks([true, false])} open />);
    expect(draws()).toEqual(['']);

    // Drugie zadanie wykonane przy zamkniętym notatniku - ptaszek czeka na otwarcie.
    rerender(<TaskList tasks={tasks([true, true])} open={false} />);
    expect(draws()).toEqual(['', '']);
    rerender(<TaskList tasks={tasks([true, true])} open />);
    expect(draws()).toEqual(['', 'motion-safe:animate-check-draw']);
    expect(screen.getByText('Zadanie 2')).toHaveClass('text-muted', 'line-through');

    // Kolejne otwarcie - bez ponownego rysowania.
    rerender(<TaskList tasks={tasks([true, true])} open={false} />);
    rerender(<TaskList tasks={tasks([true, true])} open />);
    expect(draws()).toEqual(['', '']);
  });
});
