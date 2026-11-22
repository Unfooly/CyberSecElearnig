import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SimpleChoiceBlock from './SimpleChoiceBlock';
import type { ContentBlock } from '@/lib/courses-types';

// Wybór w trybie prostym (D-132, D-204): klik zaznacza odpowiedź, „Sprawdź” wysyła ją do serwera - jedna próba rozstrzyga pytanie; potem
// zaznaczona i poprawna z oceną i zdaniem z treści, „Dalej” od razu. Bez prób do skutku i podpowiedzi.

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

describe('SimpleChoiceBlock (D-204)', () => {
  it('wygląd z szablonu (D-164): pytanie na ekranie monitora, „Pytanie N z M”, litery A/B/C, polecenie z „Sprawdź”', () => {
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} questionLabel="Pytanie 2 z 4" />);
    const screenSection = screen.getByRole('region', { name: 'Pytanie quizu' });
    expect(screenSection).toHaveAttribute('data-testid', 'monitor-screen');
    expect(screenSection).toHaveTextContent('Pytanie 2 z 4');
    expect(screenSection).toHaveTextContent('Zaznacz jedną odpowiedź i kliknij „Sprawdź”.');
    expect(screen.getAllByTestId('simple-option').map((option) => option.textContent?.slice(0, 1))).toEqual(['A', 'B', 'C']);
    // Litera jest dekoracją - nazwa pola to sama odpowiedź.
    expect(screen.getByRole('radio', { name: 'Loguję się.' })).toBeInTheDocument();
  });

  it('klik tylko zaznacza (bez zapytania do serwera, można zmienić); „Sprawdź” nieaktywne bez zaznaczenia', () => {
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} />);
    expect(screen.getByTestId('simple-check')).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Loguję się.' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Klikam link.' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Klikam link.' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Loguję się.' })).not.toBeChecked();
    expect(screen.getByTestId('simple-check')).toBeEnabled();
  });

  it('zła odpowiedź po „Sprawdź”: zaznaczona czerwona, poprawna zielona - obie ze zdaniem; koniec prób, „Dalej” od razu z indeksem', async () => {
    const onSubmit = vi.fn();
    const ready: { current: (() => void) | null } = { current: null };
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={onSubmit} onReady={(submit) => (ready.current = submit)} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Loguję się.' }));
    reply({
      blockId: 'wybor',
      result: 'bad',
      feedback: 'Hasło trafiłoby do oszusta.',
      done: true,
      options: [
        { option: 0, result: 'bad', feedback: 'Hasło trafiłoby do oszusta.', picked: true },
        { option: 2, result: 'good', feedback: 'Inny kanał pokaże, czy to ona.', picked: false },
      ],
    });
    const checkButton = screen.getByTestId('simple-check');
    checkButton.focus();
    await act(async () => fireEvent.click(checkButton));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ option: 0 });
    // Fokus zostaje na przycisku (aria-disabled, „Sprawdzone”) - nie ucieka na początek strony.
    expect(screen.getByTestId('simple-check')).toHaveFocus();
    expect(screen.getByTestId('simple-check')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('simple-check')).toHaveTextContent('Sprawdzone');
    const [first, second, third] = screen.getAllByTestId('simple-option');
    expect(first).toHaveAttribute('data-result', 'bad');
    expect(first).toHaveTextContent('Hasło trafiłoby do oszusta.');
    expect(second).not.toHaveAttribute('data-result');
    expect(third).toHaveAttribute('data-result', 'good');
    expect(third).toHaveAttribute('data-picked', 'false');
    expect(third).toHaveTextContent('Poprawna odpowiedź. Inny kanał pokaże, czy to ona.');
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Nie tym razem. Poprawną odpowiedź oznaczyliśmy znakiem ✓.');
    // Po rozstrzygnięciu zaznaczenia nie da się zmienić ani wysłać drugiej próby.
    fireEvent.click(screen.getByRole('radio', { name: /Pytam znajomą/ }));
    expect(screen.getByRole('radio', { name: /Loguję się/ })).toBeChecked();
    fireEvent.click(screen.getByTestId('simple-check'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith(0);
  });

  it('dobra odpowiedź: „Dobrze” i zdanie przy odpowiedzi', async () => {
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Pytam znajomą innym kanałem.' }));
    reply({ blockId: 'wybor', result: 'good', feedback: 'Tak.', done: true, options: [{ option: 2, result: 'good', feedback: 'Tak.', picked: true }] });
    await act(async () => fireEvent.click(screen.getByTestId('simple-check')));
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze. To poprawna odpowiedź.');
    expect(screen.getAllByTestId('simple-option')[2]).toHaveTextContent('Tak.');
  });

  it('błąd serwera przy „Sprawdź” - komunikat, zaznaczenie i przycisk zostają (można spróbować ponownie)', async () => {
    render(<SimpleChoiceBlock block={block} courseId="kurs-1" onSubmit={vi.fn()} onReady={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Klikam link.' }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => fireEvent.click(screen.getByTestId('simple-check')));
    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się sprawdzić odpowiedzi.');
    expect(screen.getByRole('radio', { name: 'Klikam link.' })).toBeChecked();
    expect(screen.getByTestId('simple-check')).toBeEnabled();
    expect(screen.getByTestId('simple-check')).toHaveTextContent('Sprawdź');
  });

  it('odświeżenie strony po rozstrzygnięciu: stan z postępu (także stary wpis bez `options`), „Dalej” od razu', () => {
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
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze.');
    expect(screen.getAllByTestId('simple-option')[2]).toHaveAttribute('data-result', 'good');
    expect(screen.getByRole('radio', { name: /Pytam znajomą/ })).toBeChecked();
  });
});
