import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// Quiz modułu (D-207): numeracja „Pytanie N z M” tylko w quizie (id z /start), niezaliczony quiz - ekran wyniku i „Powtórz quiz” w pasku
// (z odpowiedzi zapisu ostatniego pytania i po odświeżeniu strony z /start).

const exercise = { id: 'cwiczenie', type: 'QUIZ', prompt: 'Pytanie w historii?', options: [{ text: 'A.' }, { text: 'B.' }] } as ContentBlock;
const story = { id: 'historia', type: 'NARRATIVE', text: 'Dalej historia.' } as ContentBlock;
const q1 = { id: 'q1', type: 'QUIZ', prompt: 'Pierwsze pytanie quizu?', options: [{ text: 'Źle.' }, { text: 'Dobrze.' }] } as ContentBlock;
const q2 = { id: 'q2', type: 'QUIZ', prompt: 'Drugie pytanie quizu?', options: [{ text: 'Źle.' }, { text: 'Dobrze.' }] } as ContentBlock;
const summary = { id: 'raport', type: 'SUMMARY', text: 'Koniec.' } as ContentBlock;

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Quiz',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [exercise, story, q1, q2, summary],
    progress: null,
    score: null,
    simpleMode: true,
    quiz: { blockIds: ['q1', 'q2'], passPercent: 75, result: null },
    ...overrides,
  };
}

const json = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body });
const failed = { correct: 1, total: 2, passPercent: 75, passed: false, attempts: 1 };

describe('CoursePlayer: quiz modułu (D-207)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it('numeracja tylko w quizie: pytanie w historii bez numeru, q2 - „Pytanie 2 z 2”', () => {
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={course()} contentBase="/content" narrationEnabled={false} />);
    expect(screen.getByRole('region', { name: 'Pytanie quizu' })).not.toHaveTextContent(/Pytanie \d z \d/);
    unmount();
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 3 })} contentBase="/content" narrationEnabled={false} />);
    expect(screen.getByRole('region', { name: 'Pytanie quizu' })).toHaveTextContent('Pytanie 2 z 2');
  });

  it('zapis ostatniego pytania poniżej progu: ekran „Quiz niezaliczony” z wynikiem, w pasku „Powtórz quiz” - wywołuje powtórkę i odświeża', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/check')) return json({ blockId: 'q2', result: 'good', feedback: 'Tak.', done: true, options: [{ option: 1, result: 'good', feedback: 'Tak.', picked: true }] });
      if (url.endsWith('/quiz/retry')) return json({ currentBlockIndex: 2, score: null });
      return json({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 3,
        score: 50,
        completedAt: null,
        lastResult: { blockIndex: 3, blockId: 'q2', type: 'QUIZ', correct: true, points: 1 },
        gamification: null,
        quiz: failed,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 3 })} contentBase="/content" narrationEnabled={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dobrze.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sprawdź' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej' })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dalej' })));

    const screenFailed = await screen.findByTestId('quiz-failed');
    expect(screenFailed).toHaveTextContent('Quiz niezaliczony');
    expect(screen.getByTestId('quiz-failed-score')).toHaveTextContent('1 z 2');
    expect(screen.getByTestId('quiz-failed-score')).toHaveTextContent('75%');
    const retry = screen.getByRole('button', { name: 'Powtórz quiz' });
    await act(async () => fireEvent.click(retry));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/courses/course-1/quiz/retry'))).toBe(true);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('zaliczony quiz (`quiz.passed`): bez ekranu wyniku - następny blok (raport)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/check')
          ? json({ blockId: 'q2', result: 'good', feedback: 'Tak.', done: true, options: [{ option: 1, result: 'good', feedback: 'Tak.', picked: true }] })
          : json({
              assignmentId: 'a1',
              status: 'IN_PROGRESS',
              currentBlockIndex: 4,
              score: 100,
              completedAt: null,
              lastResult: { blockIndex: 3, blockId: 'q2', type: 'QUIZ', correct: true, points: 1 },
              gamification: null,
              quiz: { correct: 2, total: 2, passPercent: 75, passed: true, attempts: 1 },
            }),
      ),
    );
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 3 })} contentBase="/content" narrationEnabled={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dobrze.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sprawdź' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej' })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dalej' })));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pytanie quizu' })).not.toBeInTheDocument());
    expect(screen.queryByTestId('quiz-failed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Powtórz quiz' })).not.toBeInTheDocument();
  });

  it('ekran wyniku: fokus na nagłówku „Quiz niezaliczony” (czytnik ekranu odczyta wynik), „Wstecz” - podgląd pytania, „Dalej” wraca na wynik', () => {
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({ currentBlockIndex: 3, quiz: { blockIds: ['q1', 'q2'], passPercent: 75, result: failed } })}
        contentBase="/content"
        narrationEnabled={false}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Quiz niezaliczony' })).toHaveFocus();
    expect(screen.getByTestId('quiz-failed')).toHaveAccessibleDescription(/1 z 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Wstecz' }));
    expect(screen.getByTestId('review-block')).toHaveTextContent('Pierwsze pytanie quizu?');
    expect(screen.queryByTestId('quiz-failed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.getByTestId('quiz-failed')).toBeInTheDocument();
    // Po powrocie z podglądu fokus znowu na wyniku, nie na sr-only „Blok N z M”.
    expect(screen.getByRole('heading', { name: 'Quiz niezaliczony' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Powtórz quiz' })).toBeInTheDocument();
  });

  it('odświeżenie strony po niezaliczonym quizie (/start): od razu ekran wyniku i „Powtórz quiz”; błąd powtórki - komunikat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'x' }, 500)));
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({ currentBlockIndex: 3, quiz: { blockIds: ['q1', 'q2'], passPercent: 75, result: failed } })}
        contentBase="/content"
        narrationEnabled={false}
      />,
    );
    expect(screen.getByTestId('quiz-failed')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Powtórz quiz' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się uruchomić quizu ponownie.');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
