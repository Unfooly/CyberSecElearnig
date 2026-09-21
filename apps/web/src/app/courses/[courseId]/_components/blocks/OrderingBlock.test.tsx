import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import OrderingBlock, { move } from './OrderingBlock';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ContentBlock } from '@/lib/courses-types';

// Kolejność z serwera jest potasowana, a id nieprzejrzyste: klient nie zna poprawnej.
const block: ContentBlock = {
  type: 'ORDERING',
  id: 'kolejnosc',
  prompt: 'Ułóż kroki reakcji na podejrzany mail.',
  items: [
    { id: 'x2', text: 'Zgłoś wiadomość' },
    { id: 'x3', text: 'Usuń mail' },
    { id: 'x1', text: 'Nie klikaj w link' },
  ],
};

function setup(props: Partial<Parameters<typeof OrderingBlock>[0]> = {}) {
  const onSubmit = vi.fn();
  function Probe() {
    return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
  }
  render(
    <MascotReactionProvider resetKey="k">
      <OrderingBlock block={block} onSubmit={onSubmit} disabled={false} {...props} />
      <Probe />
    </MascotReactionProvider>,
  );
  return onSubmit;
}

const texts = () => within(screen.getByRole('list', { name: 'Kroki do uporządkowania' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
const up = (name: string) => screen.getByRole('button', { name: `Przesuń w górę: ${name}` });
const down = (name: string) => screen.getByRole('button', { name: `Przesuń w dół: ${name}` });

describe('move', () => {
  it('przenosi element, nie mutuje wejścia, ignoruje indeksy spoza zakresu', () => {
    const list = ['a', 'b', 'c'];
    expect(move(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(list).toEqual(['a', 'b', 'c']);
    expect(move(list, 1, 1)).toBe(list);
    expect(move(list, -1, 1)).toBe(list);
    expect(move(list, 0, 3)).toBe(list);
  });
});

describe('OrderingBlock: układanie przyciskami', () => {
  it('startuje w kolejności z serwera; przyciski przesuwają element o jedno miejsce i ogłaszają nową pozycję', () => {
    setup();
    expect(texts()[0]).toContain('Zgłoś wiadomość');
    fireEvent.click(down('Zgłoś wiadomość'));
    expect(texts()[1]).toContain('Zgłoś wiadomość');
    expect(screen.getByText('Zgłoś wiadomość: pozycja 2 z 3')).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(up('Zgłoś wiadomość'));
    expect(texts()[0]).toContain('Zgłoś wiadomość');
  });

  it('na brzegach listy przycisk kierunku jest nieaktywny', () => {
    setup();
    expect(up('Zgłoś wiadomość')).toBeDisabled();
    expect(down('Nie klikaj w link')).toBeDisabled();
    expect(down('Zgłoś wiadomość')).toBeEnabled();
  });

  it('fokus zostaje na przesuniętym elemencie (ten sam kierunek, a na brzegu przeciwny)', () => {
    setup();
    down('Zgłoś wiadomość').focus();
    fireEvent.click(down('Zgłoś wiadomość'));
    expect(down('Zgłoś wiadomość')).toHaveFocus();
    fireEvent.click(down('Zgłoś wiadomość')); // teraz na końcu: "w dół" nieaktywny, fokus na "w górę"
    expect(down('Zgłoś wiadomość')).toBeDisabled();
    expect(up('Zgłoś wiadomość')).toHaveFocus();
  });

  it('wysyła { order: [id nieprzejrzyste w ułożonej kolejności] }', () => {
    const onSubmit = setup();
    fireEvent.click(down('Zgłoś wiadomość'));
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź kolejność' }));
    expect(onSubmit).toHaveBeenCalledWith({ order: ['x3', 'x2', 'x1'] });
  });

  it('przeciąganie myszą też zmienia kolejność (udogodnienie obok przycisków)', () => {
    const onSubmit = setup();
    const items = within(screen.getByRole('list', { name: 'Kroki do uporządkowania' })).getAllByRole('listitem');
    const setData = vi.fn();
    fireEvent.dragStart(items[2], { dataTransfer: { setData, effectAllowed: '' } }); // "Nie klikaj w link"
    expect(setData).toHaveBeenCalledWith('text/plain', 'x1'); // Firefox nie startuje przeciągania bez setData
    fireEvent.dragOver(items[0]);
    fireEvent.drop(items[0]);
    expect(texts()[0]).toContain('Nie klikaj w link');
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź kolejność' }));
    expect(onSubmit).toHaveBeenCalledWith({ order: ['x1', 'x2', 'x3'] });
  });
});

describe('OrderingBlock: wynik', () => {
  const detail = { correctOrder: ['x1', 'x2', 'x3'], explanation: 'Najpierw nie klikaj, potem zgłoś, na końcu usuń.' };

  it('oznacza pozycje trafione i błędne, pokazuje poprawną kolejność, wyjaśnienie i wynik; bez przycisków przesuwania', () => {
    setup({ result: { answer: { order: ['x1', 'x3', 'x2'] }, detail, correct: false, points: 1 / 3 }, onContinue: vi.fn() });
    const items = within(screen.getByRole('list', { name: 'Kroki do uporządkowania' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('na miejscu');
    expect(items[1]).toHaveTextContent('zła pozycja');
    expect(items[2]).toHaveTextContent('zła pozycja');
    const correct = screen.getByRole('region', { name: 'Poprawna kolejność' });
    expect(within(correct).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nie klikaj w link', 'Zgłoś wiadomość', 'Usuń mail']);
    expect(within(correct).getByText(/Najpierw nie klikaj/)).toBeInTheDocument();
    expect(screen.getByText(/Wynik: 33%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Przesuń/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sprawdź kolejność' })).not.toBeInTheDocument();
    expect(screen.getByTestId('reaction')).toHaveTextContent('warning');
  });

  it('poprawna kolejność: bez ostrzeżenia maskotki; przycisk dalej z etykietą z powłoki', () => {
    const onContinue = vi.fn();
    setup({ result: { answer: { order: ['x1', 'x2', 'x3'] }, detail, correct: true, points: 1 }, onContinue, continueLabel: 'Zobacz podsumowanie' });
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Zobacz podsumowanie' }));
    expect(onContinue).toHaveBeenCalled();
  });
});
