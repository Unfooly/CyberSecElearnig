import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewBlock from './ReviewBlock';
import type { ContentBlock } from '@/lib/courses-types';

// Podgląd „Wstecz” pytania quizu w trybie prostym (D-204, code review): rozstrzygnięcie jak po „Sprawdź” - zaznaczona zła odpowiedź z ✕
// i zdaniem, poprawna z ✓ i „Poprawna odpowiedź”; nie „Twoja odpowiedź: …” bez oceny.

const block = {
  id: 'wybor',
  type: 'QUIZ',
  prompt: 'Co robisz?',
  options: [{ text: 'Loguję się.' }, { text: 'Pytam innym kanałem.' }],
} as unknown as ContentBlock;

describe('ReviewBlock: pytanie quizu w trybie prostym (D-204)', () => {
  it('zła odpowiedź: zaznaczona z oceną „bad”, poprawna z „good” i zdaniem; komunikat o niepoprawnej odpowiedzi', () => {
    render(
      <ReviewBlock
        block={block}
        courseId="kurs-1"
        contentBase=""
        simpleMode
        result={{
          type: 'QUIZ',
          done: true,
          answer: 0,
          correct: false,
          checks: [
            {
              item: 0,
              result: 'bad',
              feedback: 'Hasło trafi do oszusta.',
              options: [
                { option: 0, result: 'bad', feedback: 'Hasło trafi do oszusta.', picked: true },
                { option: 1, result: 'good', feedback: 'Tak sprawdzisz.', picked: false },
              ],
            },
          ],
        }}
      />,
    );
    const [first, second] = screen.getAllByTestId('review-option');
    expect(first).toHaveAttribute('data-result', 'bad');
    expect(first).toHaveTextContent('Hasło trafi do oszusta.');
    expect(second).toHaveAttribute('data-result', 'good');
    expect(second).toHaveTextContent('Poprawna odpowiedź. Tak sprawdzisz.');
    expect(screen.getByText(/Odpowiedź była niepoprawna/)).toBeInTheDocument();
    expect(screen.queryByText(/Twoja odpowiedź:/)).not.toBeInTheDocument();
  });

  it('bez prób w postępie (np. stary wpis) - „Blok ukończony”', () => {
    render(<ReviewBlock block={block} courseId="kurs-1" contentBase="" simpleMode result={{ type: 'QUIZ', done: true }} />);
    expect(screen.getByText('Blok ukończony.')).toBeInTheDocument();
  });
});
