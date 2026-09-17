import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuizBlock from './QuizBlock';

const block = {
  type: 'QUIZ' as const,
  prompt: 'Który e-mail jest podejrzany?',
  options: [{ text: 'wsparcie@bank-oficjalny.pl' }, { text: 'wsparcie@bank-0ficjalny.pl' }],
};

describe('QuizBlock', () => {
  it('renderuje treść pytania i wszystkie opcje', () => {
    render(<QuizBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByText(block.prompt)).toBeInTheDocument();
    expect(screen.getByText('wsparcie@bank-oficjalny.pl')).toBeInTheDocument();
    expect(screen.getByText('wsparcie@bank-0ficjalny.pl')).toBeInTheDocument();
  });

  it('przycisk wysyłki jest zablokowany, dopóki nie wybrano opcji', () => {
    render(<QuizBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByRole('button', { name: 'Wybierz odpowiedź' })).toBeDisabled();
  });

  it('wywołuje onSubmit z indeksem wybranej opcji, nigdy z oceną', () => {
    const onSubmit = vi.fn();
    render(<QuizBlock block={block} onSubmit={onSubmit} disabled={false} />);

    fireEvent.click(screen.getByText('wsparcie@bank-0ficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    expect(onSubmit).toHaveBeenCalledWith(1);
  });

  it('blokuje interakcję, gdy disabled=true (trwa wysyłka)', () => {
    render(<QuizBlock block={block} onSubmit={vi.fn()} disabled />);

    expect(screen.getByRole('button', { name: 'Wybierz odpowiedź' })).toBeDisabled();
    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
  });
});
