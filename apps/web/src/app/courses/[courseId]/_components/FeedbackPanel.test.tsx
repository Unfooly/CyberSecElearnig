import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedbackPanel from './FeedbackPanel';
import { MascotReactionProvider, useMascotReaction } from './player/mascot-reaction';

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

  it('reaction z treści (schemaVersion 4, np. QUIZ/BRANCHING_SCENARIO) pokazuje się przez dymek maskotki w powłoce', () => {
    function Probe() {
      return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
    }
    render(
      <MascotReactionProvider resetKey="k">
        <FeedbackPanel feedback={{ blockIndex: 0, type: 'QUIZ', correct: true, reaction: { pose: 'cheer', text: 'Brawo!' } }} onContinue={vi.fn()} continueLabel="Dalej" />
        <Probe />
      </MascotReactionProvider>,
    );
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');
  });
});
