import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedbackPanel from './FeedbackPanel';

describe('FeedbackPanel', () => {
  it('pokazuje "Poprawna odpowiedź!" dla correct=true', () => {
    render(
      <FeedbackPanel
        feedback={{ blockIndex: 0, type: 'QUIZ', correct: true }}
        onContinue={vi.fn()}
        continueLabel="Dalej"
      />,
    );

    expect(screen.getByText('Poprawna odpowiedź!')).toBeInTheDocument();
  });

  it('pokazuje "Niepoprawna odpowiedź." dla correct=false', () => {
    render(
      <FeedbackPanel
        feedback={{ blockIndex: 0, type: 'QUIZ', correct: false }}
        onContinue={vi.fn()}
        continueLabel="Dalej"
      />,
    );

    expect(screen.getByText('Niepoprawna odpowiedź.')).toBeInTheDocument();
  });

  it('pokazuje ogólne "Blok ukończony." dla bloków nieocenianych (brak pola correct)', () => {
    render(
      <FeedbackPanel
        feedback={{ blockIndex: 0, type: 'VIDEO' }}
        onContinue={vi.fn()}
        continueLabel="Dalej"
      />,
    );

    expect(screen.getByText('Blok ukończony.')).toBeInTheDocument();
    expect(screen.queryByText(/odpowiedź/i)).not.toBeInTheDocument();
  });

  it('wywołuje onContinue z etykietą przekazaną przez rodzica', () => {
    const onContinue = vi.fn();
    render(
      <FeedbackPanel
        feedback={{ blockIndex: 0, type: 'QUIZ', correct: true }}
        onContinue={onContinue}
        continueLabel="Zobacz podsumowanie"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zobacz podsumowanie' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
