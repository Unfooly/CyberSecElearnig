import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Tryb prosty (D-132): ramka z .simple-mode (tekst min. 16 px), wybór oceniany przy kliknięciu (/check), po zapisie bez ekranu wyniku -
// od razu następny blok. Bez trybu prostego QUIZ zostaje zwykłym quizem.

const quiz = { id: 'wybor', type: 'QUIZ', prompt: 'Co robisz?', options: [{ text: 'Loguję się.' }, { text: 'Pytam innym kanałem.' }] } as ContentBlock;
const next = { id: 'dalej', type: 'NARRATIVE', text: 'Następny blok.' } as ContentBlock;

function course(simpleMode: boolean): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa prosta',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [quiz, next],
    progress: null,
    score: null,
    simpleMode,
  };
}

const json = (body: object) => ({ ok: true, status: 200, json: async () => body });

describe('CoursePlayer: tryb prosty', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('klasa .simple-mode; wybór przez /check; po zapisie od razu następny blok (bez „Poprawna/niepoprawna”)', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/check')
        ? json({ blockId: 'wybor', result: 'good', feedback: 'Tak sprawdzisz.', done: true })
        : json({
            assignmentId: 'a1',
            status: 'IN_PROGRESS',
            currentBlockIndex: 1,
            score: 100,
            completedAt: null,
            lastResult: { blockIndex: 0, blockId: 'wybor', type: 'QUIZ', correct: true, points: 1 },
            gamification: null,
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course(true)} contentBase="/content" narrationEnabled={false} />);

    expect(screen.getByRole('main')).toHaveClass('simple-mode');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pytam innym kanałem.' })));
    expect(screen.getByTestId('simple-feedback')).toHaveTextContent('Dobrze. Tak sprawdzisz.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => expect(screen.getByText('Następny blok.')).toBeInTheDocument());
    expect(screen.queryByText(/Poprawna odpowiedź|Niepoprawna odpowiedź/)).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ blockIndex: 0, blockId: 'wybor', answer: 1 });
  });

  it('quiz w monitorze (D-164): „Pytanie N z M” liczone wśród bloków QUIZ (inne bloki pomiędzy), podgląd „Wstecz” bez monitora', () => {
    const second = { id: 'drugi', type: 'QUIZ', prompt: 'Drugie pytanie?', options: [{ text: 'Tak.' }, { text: 'Nie.' }] } as ContentBlock;
    const initial: CoursePlayerInitialState = {
      ...course(true),
      contentBlocks: [quiz, next, second],
      currentBlockIndex: 2,
      progress: { v: 2, notes: [], blocks: { wybor: { type: 'QUIZ', done: true, answer: 1 }, dalej: { type: 'NARRATIVE', done: true } } },
    };
    render(<CoursePlayer courseId="course-1" initial={initial} contentBase="/content" narrationEnabled={false} />);
    // Trzeci blok modułu, ale drugie pytanie quizu.
    expect(screen.getByTestId('monitor-stage')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pytanie quizu' })).toHaveTextContent('Pytanie 2 z 2');
    // „Wstecz” dwa razy - podgląd ukończonego pierwszego pytania: zwykły podgląd, bez monitora (żywy blok ukryty).
    fireEvent.click(screen.getByRole('button', { name: 'Wstecz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wstecz' }));
    expect(screen.getByTestId('review-block')).toHaveTextContent('Co robisz?');
    expect(screen.queryByRole('region', { name: 'Pytanie quizu' })).not.toBeInTheDocument();
  });

  it('bez trybu prostego: zwykły quiz, ramka bez .simple-mode', () => {
    render(<CoursePlayer courseId="course-1" initial={course(false)} contentBase="/content" narrationEnabled={false} />);
    expect(screen.getByRole('main')).not.toHaveClass('simple-mode');
    expect(screen.queryByTestId('simple-choice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('monitor-stage')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Loguję się.' })).toBeInTheDocument();
  });
});
