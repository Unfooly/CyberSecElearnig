import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SimpleMultiChoiceBlock from './SimpleMultiChoiceBlock';
import type { ContentBlock } from '@/lib/courses-types';

// Wielokrotny wybór w trybie prostym (D-158, D-204): zaznaczenie, „Sprawdź” wysyła zbiór - jedna próba rozstrzyga; oceny przy zaznaczonych
// i poprawne niezaznaczone na zielono, „Dalej” od razu (zapis bez odpowiedzi).

const block = {
  id: 'ktos-za-toba',
  type: 'QUIZ',
  multiple: true,
  prompt: 'Co robisz, gdy ktoś bez karty idzie tuż za tobą do biura?',
  options: [{ text: 'Pytam, do kogo przyszedł.' }, { text: 'Przytrzymuję drzwi.' }, { text: 'Nie przytrzymuję drzwi.' }, { text: 'Pożyczam kartę.' }],
} as unknown as ContentBlock;

const fetchMock = vi.fn();
const reply = (body: object) => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name.replace(/[.,]/g, '\\$&')) });
const checkButton = () => screen.getByRole('button', { name: 'Sprawdź' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('SimpleMultiChoiceBlock', () => {
  it('„Sprawdź” wysyła zbiór; zła próba rozstrzyga: oceny przy zaznaczonych, brakująca poprawna na zielono, „Dalej” od razu, bez drugiej próby', async () => {
    const onSubmit = vi.fn();
    const ready: { current: (() => void) | null } = { current: null };
    render(<SimpleMultiChoiceBlock block={block} courseId="kurs-1" onSubmit={onSubmit} onReady={(submit) => (ready.current = submit)} />);
    expect(screen.getByText('Zaznacz wszystkie poprawne odpowiedzi i kliknij „Sprawdź”.')).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    fireEvent.click(box('Przytrzymuję drzwi.'));
    fireEvent.click(box('Pytam, do kogo przyszedł.'));
    expect(fetchMock).not.toHaveBeenCalled();
    reply({
      blockId: 'ktos-za-toba',
      result: 'bad',
      feedback: '',
      done: true,
      options: [
        { option: 0, result: 'good', feedback: 'Tak – uprzejme pytanie wystarczy.', picked: true },
        { option: 1, result: 'bad', feedback: 'Wygląd nic nie mówi.', picked: true },
        { option: 2, result: 'good', feedback: 'Tak – każdy ma swoją kartę.', picked: false },
      ],
    });
    await act(async () => fireEvent.click(checkButton()));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ options: [0, 1] });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Nie tym razem. Poprawne odpowiedzi oznaczyliśmy znakiem ✓.');
    const marked = screen.getAllByTestId('simple-multi-option');
    expect(marked[0]).toHaveAttribute('data-result', 'good');
    expect(marked[1]).toHaveAttribute('data-result', 'bad');
    expect(marked[1]).toHaveTextContent('Wygląd nic nie mówi.');
    expect(marked[2]).toHaveAttribute('data-result', 'good');
    expect(marked[2]).toHaveAttribute('data-picked', 'false');
    expect(marked[2]).toHaveTextContent('Poprawna odpowiedź. Tak – każdy ma swoją kartę.');
    expect(marked[3]).not.toHaveAttribute('data-result');
    // Przycisk zostaje (fokus), ale nieaktywny: „Sprawdzone”.
    expect(screen.getByTestId('simple-multi-check')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('simple-multi-check')).toHaveTextContent('Sprawdzone');
    // Po rozstrzygnięciu zaznaczenie zablokowane, „Dalej” od razu.
    fireEvent.click(box('Pożyczam kartę.'));
    expect(box('Pożyczam kartę.')).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('dobra próba: „Dobrze. Zaznaczono wszystkie poprawne odpowiedzi.”', async () => {
    render(<SimpleMultiChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} />);
    fireEvent.click(box('Pytam, do kogo przyszedł.'));
    fireEvent.click(box('Nie przytrzymuję drzwi.'));
    reply({
      blockId: 'ktos-za-toba',
      result: 'good',
      feedback: '',
      done: true,
      options: [
        { option: 0, result: 'good', feedback: 'Tak.', picked: true },
        { option: 2, result: 'good', feedback: 'Tak – każdy ma swoją kartę.', picked: true },
      ],
    });
    await act(async () => fireEvent.click(checkButton()));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ options: [0, 2] });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze. Zaznaczono wszystkie poprawne odpowiedzi.');
  });

  it('odświeżenie strony: zaznaczenie i oceny z rozstrzygniętej próby; „Dalej” od razu (także po złej próbie)', () => {
    const ready: { current: (() => void) | null } = { current: null };
    const { unmount } = render(
      <SimpleMultiChoiceBlock
        block={block}
        courseId="kurs-1"
        onSubmit={vi.fn()}
        onReady={(submit) => (ready.current = submit)}
        progress={{ type: 'QUIZ', done: false, checks: [{ item: [1], result: 'bad', feedback: '', options: [{ option: 1, result: 'bad', feedback: 'Nie.', picked: true }] }] }}
      />,
    );
    expect(box('Przytrzymuję drzwi.')).toBeChecked();
    expect(screen.getAllByTestId('simple-multi-option')[1]).toHaveAttribute('data-result', 'bad');
    expect(ready.current).not.toBeNull();
    unmount();

    render(
      <SimpleMultiChoiceBlock
        block={block}
        courseId="kurs-1"
        onSubmit={vi.fn()}
        onReady={(submit) => (ready.current = submit)}
        progress={{ type: 'QUIZ', done: false, checks: [{ item: [0, 2], result: 'good', feedback: '' }] }}
      />,
    );
    expect(ready.current).not.toBeNull();
    expect(box('Pytam, do kogo przyszedł.')).toBeChecked();
    expect(box('Nie przytrzymuję drzwi.')).toBeChecked();
  });

  it('błąd serwera - komunikat, bez zmiany stanu', async () => {
    render(<SimpleMultiChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} />);
    fireEvent.click(box('Pytam, do kogo przyszedł.'));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    await act(async () => fireEvent.click(checkButton()));
    expect(screen.getByRole('alert')).toHaveTextContent('Za dużo kliknięć naraz.');
    expect(screen.queryAllByTestId('simple-multi-feedback')).toHaveLength(0);
  });
});
