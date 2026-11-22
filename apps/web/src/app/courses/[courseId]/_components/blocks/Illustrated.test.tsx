import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from '../CoursePlayer';
import Illustrated from './Illustrated';
import ReviewBlock from '../player/ReviewBlock';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Ilustracja obok tekstu albo pytania (D-200): NARRATIVE i QUIZ z `illustration` - grafika z contentBase i opisem, treść obok;
// bez ilustracji układ bloku bez zmian. jsdom nie liczy układu - wysokości i kolumny sprawdzono w prawdziwej przeglądarce (zrzuty w PR).

const BASE = 'https://cdn.example.com';
const illustration = { image: 'assets/m/tabela.1a2b3c4d.webp', alt: 'Bartek przy biurku z górą danych.' };

function course(blocks: CoursePlayerInitialState['contentBlocks']): CoursePlayerInitialState {
  return { assignmentId: 'a1', courseId: 'c1', title: 'Na skróty', status: 'IN_PROGRESS', currentBlockIndex: 0, contentBlocks: blocks, progress: null, score: null, simpleMode: true };
}

describe('Illustrated (D-200)', () => {
  it('grafika z contentBase z opisem, treść obok; bez ilustracji - sama treść', () => {
    const { rerender } = render(
      <Illustrated illustration={illustration} contentBase={BASE}>
        <p>Treść</p>
      </Illustrated>,
    );
    const wrapper = screen.getByTestId('illustrated');
    expect(within(wrapper).getByRole('img', { name: illustration.alt })).toHaveAttribute('src', `${BASE}/${illustration.image}`);
    expect(within(wrapper).getByText('Treść')).toBeInTheDocument();
    rerender(
      <Illustrated contentBase={BASE}>
        <p>Treść</p>
      </Illustrated>,
    );
    expect(screen.queryByTestId('illustrated')).not.toBeInTheDocument();
    expect(screen.getByText('Treść')).toBeInTheDocument();
  });

  it('niebezpieczna ścieżka obrazu (adres z zewnątrz) - bez grafiki, sama treść', () => {
    render(
      <Illustrated illustration={{ image: 'https://evil.example/x.png', alt: 'x' }} contentBase={BASE}>
        <p>Treść</p>
      </Illustrated>,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Treść')).toBeInTheDocument();
  });

  it('odtwarzacz: NARRATIVE i QUIZ w trybie prostym z ilustracją; blok bez ilustracji bez oprawy', () => {
    const { unmount } = render(
      <CoursePlayer
        courseId="c1"
        contentBase={BASE}
        narrationEnabled={false}
        showStartScreen={false}
        initial={course([{ type: 'NARRATIVE', id: 'n1', title: 'Tabela na jutro', text: 'Bartek ma do rana przerobić tabelę.', illustration }] as CoursePlayerInitialState['contentBlocks'])}
      />,
    );
    expect(within(screen.getByTestId('illustrated')).getByText('Bartek ma do rana przerobić tabelę.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: illustration.alt })).toBeInTheDocument();
    unmount();

    const { unmount: unmountQuiz } = render(
      <CoursePlayer
        courseId="c1"
        contentBase={BASE}
        narrationEnabled={false}
        showStartScreen={false}
        initial={course([{ type: 'QUIZ', id: 'q1', prompt: 'Instalować?', options: [{ text: 'Tak' }, { text: 'Nie, najpierw IT' }], illustration }] as CoursePlayerInitialState['contentBlocks'])}
      />,
    );
    // Tryb prosty: pytanie w monitorze (D-164) - ilustracja NA ekranie monitora, nie wokół monitora (łańcuch wysokości, code review D-200).
    const screenArea = screen.getByTestId('monitor-screen');
    const quiz = within(screenArea).getByTestId('illustrated');
    expect(quiz).toHaveAttribute('data-variant', 'screen');
    expect(within(quiz).getByText('Instalować?')).toBeInTheDocument();
    expect(within(quiz).getByRole('img', { name: illustration.alt })).toBeInTheDocument();
    expect(screen.getAllByTestId('illustrated')).toHaveLength(1);
    unmountQuiz();

    // Wielokrotny wybór w trybie prostym - też na ekranie monitora.
    const { unmount: unmountMulti } = render(
      <CoursePlayer
        courseId="c1"
        contentBase={BASE}
        narrationEnabled={false}
        showStartScreen={false}
        initial={course([
          { type: 'QUIZ', id: 'q2', prompt: 'Co może się stać?', multiple: true, options: [{ text: 'Wyciek' }, { text: 'Wirus' }], illustration },
        ] as CoursePlayerInitialState['contentBlocks'])}
      />,
    );
    expect(within(screen.getByTestId('monitor-screen')).getByRole('img', { name: illustration.alt })).toBeInTheDocument();
    expect(screen.getAllByTestId('illustrated')).toHaveLength(1);
    unmountMulti();

    // Pole `illustration` w bloku innego typu (np. podstawione) - bez oprawy.
    const { unmount: unmountOther } = render(
      <CoursePlayer
        courseId="c1"
        contentBase={BASE}
        narrationEnabled={false}
        showStartScreen={false}
        initial={course([{ type: 'SUMMARY', id: 's1', text: 'Koniec.', illustration }] as CoursePlayerInitialState['contentBlocks'])}
      />,
    );
    expect(screen.queryByTestId('illustrated')).not.toBeInTheDocument();
    unmountOther();

    render(
      <CoursePlayer
        courseId="c1"
        contentBase={BASE}
        narrationEnabled={false}
        showStartScreen={false}
        initial={course([{ type: 'NARRATIVE', id: 'n2', text: 'Bez grafiki.' }] as CoursePlayerInitialState['contentBlocks'])}
      />,
    );
    expect(screen.getByText('Bez grafiki.')).toBeInTheDocument();
    expect(screen.queryByTestId('illustrated')).not.toBeInTheDocument();
  });

  it('podgląd „Wstecz”: ilustracja przy NARRATIVE i przy podsumowaniu QUIZ (wybrana odpowiedź)', () => {
    const { unmount } = render(<ReviewBlock block={{ type: 'NARRATIVE', id: 'n1', text: 'Tekst slajdu.', illustration }} contentBase={BASE} courseId="c1" simpleMode />);
    const narrative = screen.getByTestId('illustrated');
    expect(within(narrative).getByRole('img', { name: illustration.alt })).toBeInTheDocument();
    expect(within(narrative).getByText('Tekst slajdu.')).toBeInTheDocument();
    unmount();
    render(
      <ReviewBlock
        block={{ type: 'QUIZ', id: 'q1', prompt: 'Instalować?', options: [{ text: 'Tak' }, { text: 'Nie' }], illustration }}
        result={{ type: 'QUIZ', done: true, answer: 1 } as never}
        contentBase={BASE}
        courseId="c1"
        simpleMode
      />,
    );
    const quiz = screen.getByTestId('illustrated');
    expect(within(quiz).getByRole('img', { name: illustration.alt })).toBeInTheDocument();
    expect(within(quiz).getByText('Nie')).toBeInTheDocument();
  });
});
