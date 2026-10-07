import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SimpleChoiceBlock from './SimpleChoiceBlock';
import type { ContentBlock } from '@/lib/courses-types';

// Wybór w trybie prostym (D-132): każde kliknięcie sprawdza serwer, zła odpowiedź zostaje wyłączona, po 2 błędach podpowiedź, „Dalej” po
// trafieniu z indeksem trafionej odpowiedzi.

const block = {
  id: 'wybor',
  type: 'QUIZ',
  prompt: 'Co robisz?',
  options: [{ text: 'Loguję się.' }, { text: 'Klikam link.' }, { text: 'Pytam znajomą innym kanałem.' }],
} as unknown as ContentBlock;

const fetchMock = vi.fn();
const reply = (body: object) => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('SimpleChoiceBlock', () => {
  it('zła odpowiedź - zdanie i wyłączona; po 2 błędach podpowiedź; trafienie - „Dobrze”, wszystko wyłączone, „Dalej” z indeksem', async () => {
    const onSubmit = vi.fn();
    const ready: { current: (() => void) | null } = { current: null };
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={onSubmit} onReady={(submit) => (ready.current = submit)} />);

    reply({ blockId: 'wybor', result: 'bad', feedback: 'Link prowadzi do fałszywej strony.', done: false });
    const first = screen.getByRole('button', { name: 'Loguję się.' });
    first.focus();
    await act(async () => fireEvent.click(first));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ option: 0 });
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Nie tym razem. Link prowadzi do fałszywej strony.');
    // aria-disabled, nie disabled: fokus zostaje na przycisku (klawiatura, czytnik), ponowny klik nic nie wysyła.
    const tried = screen.getByRole('button', { name: /Loguję się\. - zła odpowiedź/ });
    expect(tried).toHaveAttribute('aria-disabled', 'true');
    expect(tried).toHaveFocus();
    await act(async () => fireEvent.click(tried));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ready.current).toBeNull();

    reply({ blockId: 'wybor', result: 'bad', feedback: 'To też link.', hint: 'Zapytaj Kasię inaczej niż przez ten czat.', done: false });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Klikam link.' })));
    expect(screen.getByTestId('simple-hint')).toHaveTextContent('Zapytaj Kasię inaczej niż przez ten czat.');

    reply({ blockId: 'wybor', result: 'good', feedback: 'Tak sprawdzisz, czy to naprawdę ona.', done: true });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pytam znajomą innym kanałem.' })));
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze! Tak sprawdzisz');
    expect(screen.queryByTestId('simple-hint')).not.toBeInTheDocument();
    for (const button of screen.getAllByTestId('simple-option')) expect(button).toHaveAttribute('aria-disabled', 'true');
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith(2);
  });

  it('odświeżenie strony po trafieniu: stan z postępu, „Dalej” od razu', () => {
    const ready: { current: (() => void) | null } = { current: null };
    render(
      <SimpleChoiceBlock
        block={block}
        courseId="kurs-1"
        onSubmit={vi.fn()}
        onReady={(submit) => (ready.current = submit)}
        progress={{ type: 'QUIZ', done: false, checks: [{ item: 2, result: 'good', feedback: 'Tak.' }] }}
      />,
    );
    expect(ready.current).not.toBeNull();
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze! Tak.');
  });
});
