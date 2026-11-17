import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SimpleMultiChoiceBlock from './SimpleMultiChoiceBlock';
import type { ContentBlock } from '@/lib/courses-types';

// Wielokrotny wybór w trybie prostym (D-158): zaznaczenie, „Sprawdź” wysyła zbiór, oceny przy zaznaczonych, zmiana zaznaczenia czyści oceny,
// po 2 błędach podpowiedź, „Dalej” po trafieniu (zapis bez odpowiedzi).

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
  it('„Sprawdź” wysyła zbiór; oceny przy zaznaczonych; zmiana zaznaczenia czyści oceny; po 2 błędach podpowiedź; trafienie - „Dalej” bez odpowiedzi', async () => {
    const onSubmit = vi.fn();
    const ready: { current: (() => void) | null } = { current: null };
    render(<SimpleMultiChoiceBlock block={block} courseId="kurs-1" onSubmit={onSubmit} onReady={(submit) => (ready.current = submit)} />);
    expect(screen.getByText('Zaznacz wszystkie poprawne odpowiedzi.')).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    fireEvent.click(box('Przytrzymuję drzwi.'));
    fireEvent.click(box('Pytam, do kogo przyszedł.'));
    reply({
      blockId: 'ktos-za-toba',
      result: 'bad',
      feedback: '',
      done: false,
      options: [
        { option: 0, result: 'good', feedback: 'Tak – uprzejme pytanie wystarczy.' },
        { option: 1, result: 'bad', feedback: 'Wygląd nic nie mówi.' },
      ],
    });
    await act(async () => fireEvent.click(checkButton()));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ options: [0, 1] });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Nie tym razem. Popraw zaznaczenie i sprawdź jeszcze raz.');
    const marked = screen.getAllByTestId('simple-multi-option');
    expect(marked[0]).toHaveAttribute('data-result', 'good');
    expect(marked[1]).toHaveAttribute('data-result', 'bad');
    expect(marked[2]).not.toHaveAttribute('data-result');
    expect(marked[1]).toHaveTextContent('Wygląd nic nie mówi.');
    // Ten sam zbiór drugi raz - przycisk nieaktywny (serwer i tak odrzuci).
    expect(checkButton()).toBeDisabled();
    expect(ready.current).toBeNull();

    // Zmiana zaznaczenia czyści oceny poprzedniej próby.
    fireEvent.click(box('Przytrzymuję drzwi.'));
    expect(screen.queryAllByTestId('simple-multi-feedback')).toHaveLength(0);
    expect(screen.getByTestId('simple-feedback')).not.toHaveAttribute('data-result');

    reply({ blockId: 'ktos-za-toba', result: 'bad', feedback: '', hint: 'Do biura wchodzi się własną kartą.', done: false, options: [{ option: 0, result: 'good', feedback: 'Tak.' }] });
    await act(async () => fireEvent.click(checkButton()));
    expect(screen.getByTestId('simple-hint')).toHaveTextContent('Do biura wchodzi się własną kartą.');

    fireEvent.click(box('Nie przytrzymuję drzwi.'));
    reply({
      blockId: 'ktos-za-toba',
      result: 'good',
      feedback: '',
      done: true,
      options: [
        { option: 0, result: 'good', feedback: 'Tak.' },
        { option: 2, result: 'good', feedback: 'Tak – każdy ma swoją kartę.' },
      ],
    });
    await act(async () => fireEvent.click(checkButton()));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ options: [0, 2] });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze. Zaznaczono wszystkie poprawne odpowiedzi.');
    expect(screen.queryByTestId('simple-hint')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sprawdź' })).not.toBeInTheDocument();
    // Po trafieniu zaznaczenie zablokowane.
    fireEvent.click(box('Pożyczam kartę.'));
    expect(box('Pożyczam kartę.')).not.toBeChecked();
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('odświeżenie strony: zaznaczenie i oceny z ostatniej próby w postępie; po trafieniu „Dalej” od razu', () => {
    const ready: { current: (() => void) | null } = { current: null };
    const { unmount } = render(
      <SimpleMultiChoiceBlock
        block={block}
        courseId="kurs-1"
        onSubmit={vi.fn()}
        onReady={(submit) => (ready.current = submit)}
        progress={{ type: 'QUIZ', done: false, checks: [{ item: [1], result: 'bad', feedback: '', options: [{ option: 1, result: 'bad', feedback: 'Nie.' }] }] }}
      />,
    );
    expect(box('Przytrzymuję drzwi.')).toBeChecked();
    expect(screen.getAllByTestId('simple-multi-option')[1]).toHaveAttribute('data-result', 'bad');
    expect(ready.current).toBeNull();
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
