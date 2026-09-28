import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DragAndDropBlock from './DragAndDropBlock';

const block = {
  type: 'DRAG_AND_DROP' as const,
  prompt: 'Posegreguj maile',
  items: [{ text: 'wsparcie@bank.pl' }, { text: 'wygrales@nagroda-milion.biz' }],
};

// Jeden „Dalej” (D-106): blok nie ma własnego przycisku dalej - po posegregowaniu wszystkiego zgłasza gotowość.
describe('DragAndDropBlock', () => {
  it('renderuje treść polecenia i wszystkie elementy do sklasyfikowania', () => {
    render(<DragAndDropBlock block={block} onReady={vi.fn()} disabled={false} />);

    expect(screen.getByText(block.prompt)).toBeInTheDocument();
    expect(screen.getByText('wsparcie@bank.pl')).toBeInTheDocument();
    expect(screen.getByText('wygrales@nagroda-milion.biz')).toBeInTheDocument();
  });

  it('renderuje domyślne kategorie "Bezpieczne"/"Phishing" dla każdego elementu, bez przycisku "Dalej"', () => {
    render(<DragAndDropBlock block={block} onReady={vi.fn()} disabled={false} />);

    expect(screen.getAllByRole('button', { name: 'Bezpieczne' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Phishing' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
  });

  it('nie jest gotowy, dopóki nie sklasyfikowano wszystkich elementów', () => {
    const onReady = vi.fn();
    render(<DragAndDropBlock block={block} onReady={onReady} disabled={false} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Bezpieczne' })[0]);
    expect(onReady).not.toHaveBeenCalledWith(true);
  });

  it('zgłasza gotowość, gdy wszystko sklasyfikowane', () => {
    const onReady = vi.fn();
    render(<DragAndDropBlock block={block} onReady={onReady} disabled={false} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Bezpieczne' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Phishing' })[1]);

    expect(onReady).toHaveBeenLastCalledWith(true);
  });
});
