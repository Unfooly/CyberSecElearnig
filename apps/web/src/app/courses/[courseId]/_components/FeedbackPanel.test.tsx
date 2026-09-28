import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeedbackPanel from './FeedbackPanel';

describe('FeedbackPanel', () => {
  it('pokazuje "Poprawna odpowiedź!" dla correct=true', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: true }} />);

    expect(screen.getByText('Poprawna odpowiedź!')).toBeInTheDocument();
  });

  it('pokazuje "Niepoprawna odpowiedź." dla correct=false', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: false }} />);

    expect(screen.getByText('Niepoprawna odpowiedź.')).toBeInTheDocument();
  });

  it('pokazuje ogólne "Blok ukończony." dla bloków nieocenianych (brak pola correct)', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'VIDEO' }} />);

    expect(screen.getByText('Blok ukończony.')).toBeInTheDocument();
    expect(screen.queryByText(/odpowiedź/i)).not.toBeInTheDocument();
  });

  it('bez własnego przycisku dalej - „Dalej” jest wyłącznie w dolnym pasku (D-106)', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: true }} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reaction z treści (schemaVersion 4, np. QUIZ/BRANCHING_SCENARIO): sam tekst pod wynikiem, bez postaci (pose ignorowana)', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: true, reaction: { pose: 'cheer', text: 'Brawo!' } }} />);
    expect(screen.getByTestId('feedback-reaction')).toHaveTextContent('Brawo!');
    expect(screen.queryByText('cheer')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('bez reaction: brak akapitu reakcji', () => {
    render(<FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: false }} />);
    expect(screen.queryByTestId('feedback-reaction')).not.toBeInTheDocument();
  });
});
