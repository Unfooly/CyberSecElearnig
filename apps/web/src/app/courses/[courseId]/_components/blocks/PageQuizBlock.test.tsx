import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PageQuizBlock, { isPageQuiz } from './PageQuizBlock';
import { HINT_EVENT_TEXT, HintProvider, useHints } from '../player/hints';
import type { ContentBlock } from '@/lib/courses-types';

// Pytanie na fałszywej stronie na pulpicie (D-190): ten sam widok co zadanie z domeną - okno przeglądarki na pulpicie, adres z
// zaznaczoną domeną, pytanie w pasku zadania, pod nim makieta strony.
const block: ContentBlock = {
  type: 'QUIZ',
  id: 'zaufanie',
  prompt: 'Czy ten link jest godny zaufania?',
  options: [{ text: 'Tak – w adresie jest nazwa fundacji.' }, { text: 'Nie – domena nie należy do fundacji.' }],
  frame: 'monitor',
  markUrl: 'https://fundacja.przyklad-online.net/rejestracja/1',
  background: 'images/pulpit.webp',
  backgroundScreen: { x: 17.64, y: 18.96, width: 65.08, height: 51.3 },
  page: { tabTitle: 'Formularz prelegenta', brand: 'Fundacja', heading: 'Rejestracja', fields: ['E-mail', 'Hasło'], button: 'Zarejestruj się' },
};

function HintProbe() {
  return <p data-testid="hint">{useHints().hint ?? ''}</p>;
}

function setup(props: Partial<Parameters<typeof PageQuizBlock>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <HintProvider resetKey="zaufanie">
      <PageQuizBlock block={block} contentBase="" onSubmit={onSubmit} {...props} />
      <HintProbe />
    </HintProvider>,
  );
  return { onSubmit };
}

describe('PageQuizBlock: pytanie na fałszywej stronie na pulpicie (D-190)', () => {
  it('ten sam widok co zadanie z domeną: okno na pulpicie bez najazdu, adres z zaznaczoną domeną, pytanie nad makietą strony', () => {
    setup();
    const stage = screen.getByTestId('desktop-stage');
    expect(stage).toHaveAttribute('data-still', 'true');
    expect(stage).toHaveAttribute('data-screen', 'true');
    const window = within(screen.getByTestId('browser-window'));
    expect(window.getByTestId('address-domain')).toHaveTextContent('przyklad-online.net');
    // Domena jest już zaznaczona - w pasku adresu nie ma nic do klikania.
    expect(within(window.getByTestId('address-marker')).queryAllByRole('button')).toHaveLength(0);
    const task = within(window.getByTestId('page-task'));
    expect(task.getByText('Czy ten link jest godny zaufania?')).toBeInTheDocument();
    expect(task.getAllByRole('radio')).toHaveLength(2);
    // Makieta strony to obrazek - żadnych pól na dane.
    expect(window.getByRole('img', { name: /Makieta strony: Fundacja/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('wysyła sam indeks wybranej odpowiedzi; bez wyboru przycisk jest nieaktywny', () => {
    const { onSubmit } = setup();
    const submit = screen.getByRole('button', { name: 'Wybierz odpowiedź' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Nie – domena nie należy do fundacji.' }));
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(1);
  });

  it('wynik zostaje na tej samej stronie: wybrana odpowiedź, werdykt i komentarz z treści; wyboru nie da się zmienić', () => {
    setup({ result: { selected: 1, correct: true, reaction: { text: 'Dokładnie. To nie jest strona fundacji.' } } });
    expect(screen.getByTestId('desktop-stage')).toBeInTheDocument();
    const result = within(screen.getByTestId('page-quiz-result'));
    expect(result.getByText('Poprawna odpowiedź!')).toBeInTheDocument();
    expect(result.getByText('Dokładnie. To nie jest strona fundacji.')).toBeInTheDocument();
    const [yes, no] = screen.getAllByRole('radio');
    expect(no).toBeChecked();
    fireEvent.click(yes);
    expect(no).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Wybierz odpowiedź' })).not.toBeInTheDocument();
    expect(screen.getByTestId('hint')).toHaveTextContent('');
  });

  it('zła odpowiedź: werdykt na stronie i ostrzeżenie w dymku', () => {
    setup({ result: { selected: 0, correct: false, reaction: { text: 'Nazwa fundacji jest tylko w poddomenie.' } } });
    expect(within(screen.getByTestId('page-quiz-result')).getByText('Niepoprawna odpowiedź.')).toBeInTheDocument();
    expect(screen.getByTestId('hint')).toHaveTextContent(HINT_EVENT_TEXT.wrong);
  });

  it('wynik bez zapisanego wyboru (starszy zapis): werdykt i komentarz, żadna odpowiedź niezaznaczona', () => {
    setup({ result: { correct: true, reaction: { text: 'Komentarz.' } } });
    expect(within(screen.getByTestId('page-quiz-result')).getByText('Poprawna odpowiedź!')).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('isPageQuiz: tylko QUIZ z oprawą monitora i tłem', () => {
    expect(isPageQuiz(block)).toBe(true);
    expect(isPageQuiz({ ...block, frame: undefined })).toBe(false);
    expect(isPageQuiz({ ...block, background: undefined })).toBe(false);
    expect(isPageQuiz({ ...block, type: 'TEXT_INPUT_GUIDED' })).toBe(false);
    expect(isPageQuiz(undefined)).toBe(false);
  });
});
