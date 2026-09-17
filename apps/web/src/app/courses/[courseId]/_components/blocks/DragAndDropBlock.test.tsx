import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DragAndDropBlock from './DragAndDropBlock';

const block = {
  type: 'DRAG_AND_DROP' as const,
  prompt: 'Posegreguj maile',
  items: [{ text: 'wsparcie@bank.pl' }, { text: 'wygrales@nagroda-milion.biz' }],
};

describe('DragAndDropBlock', () => {
  it('renderuje treść polecenia i wszystkie elementy do sklasyfikowania', () => {
    render(<DragAndDropBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByText(block.prompt)).toBeInTheDocument();
    expect(screen.getByText('wsparcie@bank.pl')).toBeInTheDocument();
    expect(screen.getByText('wygrales@nagroda-milion.biz')).toBeInTheDocument();
  });

  it('renderuje domyślne kategorie "Bezpieczne"/"Phishing" dla każdego elementu', () => {
    render(<DragAndDropBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getAllByRole('button', { name: 'Bezpieczne' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Phishing' })).toHaveLength(2);
  });

  it('"Dalej" jest zablokowane, dopóki nie sklasyfikowano wszystkich elementów', () => {
    render(<DragAndDropBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    const nextButton = screen.getByRole('button', { name: 'Dalej' });
    expect(nextButton).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Bezpieczne' })[0]);
    expect(nextButton).toBeDisabled();
  });

  it('odblokowuje "Dalej" i wywołuje onSubmit bez odpowiedzi, gdy wszystko sklasyfikowane', () => {
    const onSubmit = vi.fn();
    render(<DragAndDropBlock block={block} onSubmit={onSubmit} disabled={false} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Bezpieczne' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Phishing' })[1]);

    const nextButton = screen.getByRole('button', { name: 'Dalej' });
    expect(nextButton).not.toBeDisabled();

    fireEvent.click(nextButton);
    expect(onSubmit).toHaveBeenCalledWith();
  });
});
