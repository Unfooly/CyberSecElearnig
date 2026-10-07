import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SwipeSortBlock from './SwipeSortBlock';
import type { ContentBlock } from '@/lib/courses-types';

// jsdom nie ma PointerEvent - fireEvent.pointer* tworzyłby zwykłe Event bez clientX/pointerId. Minimalny odpowiednik na MouseEvent.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

// Segregowanie wiadomości (SWIPE_SORT, D-132): przyciski i gest robią to samo, werdykt sprawdza serwer (/check), zdanie po każdej karcie,
// podpowiedź po 2 błędach, „Dalej” po ocenie wszystkich kart, podgląd „Wstecz” z własnymi werdyktami.

const block = {
  id: 'wiadomosci',
  type: 'SWIPE_SORT',
  prompt: 'Przesuń każdą wiadomość w lewo albo w prawo.',
  cards: [
    { id: 'op1', channel: 'sms', from: 'SzybkaPaczka', time: '9:41', text: 'Dopłać 1,99 zł do paczki.' },
    { id: 'op2', channel: 'chat', from: 'Szef', text: 'Przenoszę spotkanie na 11:00.', attachment: 'agenda.pdf' },
  ],
} as unknown as ContentBlock;

const fetchMock = vi.fn();
const reply = (body: object, status = 200) => fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

function setup(progress?: Parameters<typeof SwipeSortBlock>[0]['progress']) {
  const onSubmit = vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  const onProgress = vi.fn();
  render(
    <SwipeSortBlock
      block={block}
      courseId="kurs-1"
      progress={progress}
      onSubmit={onSubmit}
      onReady={(submit) => {
        ready.current = submit;
      }}
      onProgress={onProgress}
    />,
  );
  return { onSubmit, ready, onProgress };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('SwipeSortBlock', () => {
  it('przyciski: werdykt do /check, zdanie „Dobrze”/„Nie tym razem”, kolejna karta; po ostatniej - „Dalej” i zapis bez odpowiedzi', async () => {
    const { ready, onSubmit } = setup();
    expect(screen.getByText('Wiadomość 1 z 2')).toBeInTheDocument();
    expect(screen.getByTestId('swipe-card')).toHaveTextContent('SzybkaPaczka');
    expect(ready.current).toBeNull();

    reply({ blockId: 'wiadomosci', result: 'good', feedback: 'Dopłata przez link to typowy przekręt.', done: false });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Podejrzane' })));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses/kurs-1/blocks/wiadomosci/check');
    expect(sent(0)).toEqual({ card: 'op1', verdict: 'suspicious' });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze! Dopłata przez link to typowy przekręt.');
    expect(screen.getByTestId('swipe-card')).toHaveTextContent('Szef');
    expect(screen.getByTestId('swipe-card')).toHaveTextContent('agenda.pdf');

    reply({ blockId: 'wiadomosci', result: 'bad', feedback: 'Szef pisze z tego samego numeru co zawsze.', done: true });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'W porządku' })));
    expect(sent(1)).toEqual({ card: 'op2', verdict: 'ok' });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Nie tym razem. Szef pisze');
    expect(screen.queryByTestId('swipe-card')).not.toBeInTheDocument();
    expect(screen.getByText('Wszystkie wiadomości ocenione.')).toBeInTheDocument();
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('gest: przesunięcie w lewo poza próg = „Podejrzane”, w prawo = „W porządku”; krótkie przesunięcie wraca bez werdyktu', async () => {
    setup();
    const card = () => screen.getByTestId('swipe-card');
    fireEvent.pointerDown(card(), { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 160, pointerId: 1 });
    expect(card()).toHaveAttribute('data-leaning', 'suspicious');
    await act(async () => fireEvent.pointerUp(card(), { clientX: 160, pointerId: 1 }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(card()).not.toHaveAttribute('data-leaning');

    reply({ blockId: 'wiadomosci', result: 'good', feedback: 'Tak.', done: false });
    fireEvent.pointerDown(card(), { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 60, pointerId: 1 });
    await act(async () => fireEvent.pointerUp(card(), { clientX: 60, pointerId: 1 }));
    expect(sent(0)).toEqual({ card: 'op1', verdict: 'suspicious' });

    reply({ blockId: 'wiadomosci', result: 'good', feedback: 'Tak.', done: true });
    fireEvent.pointerDown(card(), { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(card(), { clientX: 250, pointerId: 1 });
    expect(card()).toHaveAttribute('data-leaning', 'ok');
    await act(async () => fireEvent.pointerUp(card(), { clientX: 250, pointerId: 1 }));
    expect(sent(1)).toEqual({ card: 'op2', verdict: 'ok' });
  });

  it('podpowiedź z odpowiedzi serwera (po 2 błędach) zostaje widoczna; błąd serwera - komunikat, karta zostaje', async () => {
    setup();
    reply({ message: 'Za dużo żądań.' }, 429);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Podejrzane' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Za dużo żądań.');
    expect(screen.getByTestId('swipe-card')).toHaveTextContent('SzybkaPaczka');

    reply({ blockId: 'wiadomosci', result: 'bad', feedback: 'Nie.', hint: 'Zobacz, czy wiadomość prosi o kliknięcie albo pieniądze.', done: false });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'W porządku' })));
    expect(screen.getByTestId('simple-hint')).toHaveTextContent('Podpowiedź: Zobacz, czy wiadomość prosi o kliknięcie albo pieniądze.');
  });

  it('odświeżenie strony w trakcie: ocenione karty z postępu pominięte, ostatnie zdanie widoczne', () => {
    setup({ type: 'SWIPE_SORT', done: false, checks: [{ item: 'op1', result: 'good', feedback: 'Tak było.' }] });
    expect(screen.getByText('Wiadomość 2 z 2')).toBeInTheDocument();
    expect(screen.getByTestId('swipe-card')).toHaveTextContent('Szef');
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze! Tak było.');
  });

  it('podgląd „Wstecz”: każda karta z własnym werdyktem i zdaniem, bez przycisków', () => {
    render(
      <SwipeSortBlock
        block={block}
        courseId="kurs-1"
        review
        progress={{
          type: 'SWIPE_SORT',
          done: true,
          checks: [
            { item: 'op1', result: 'good', feedback: 'Tak było.' },
            { item: 'op2', result: 'bad', feedback: 'To był szef.' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('swipe-review')).toHaveTextContent('Dobrze. Tak było.');
    expect(screen.getByTestId('swipe-review')).toHaveTextContent('Nie tym razem. To był szef.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
