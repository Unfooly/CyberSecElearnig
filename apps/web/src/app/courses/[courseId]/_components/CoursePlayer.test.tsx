import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const singleQuizBlockCourse: CoursePlayerInitialState = {
  assignmentId: 'assignment-1',
  courseId: 'course-1',
  title: 'Rozpoznawanie phishingu',
  status: 'IN_PROGRESS',
  currentBlockIndex: 0,
  contentBlocks: [
    {
      type: 'QUIZ',
      prompt: 'Który e-mail jest podejrzany?',
      options: [{ text: 'wsparcie@bank-oficjalny.pl' }, { text: 'wsparcie@bank-0ficjalny.pl' }],
    },
  ],
  progress: null,
  score: null,
};

describe('CoursePlayer - przepływ kursu jednoblokowego', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('start -> odpowiedź -> feedback -> podsumowanie z wynikiem z API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'assignment-1',
        status: 'COMPLETED',
        currentBlockIndex: 1,
        score: 100,
        completedAt: '2026-01-01T00:00:00.000Z',
        lastResult: { blockIndex: 0, type: 'QUIZ', correct: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    // Blok renderuje się od razu wg currentBlockIndex z initial (start już
    // wykonany server-side w page.tsx) - żadnego dodatkowego fetcha na starcie.
    expect(screen.getByText('Który e-mail jest podejrzany?')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('wsparcie@bank-0ficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/course-1/progress',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ blockIndex: 0, answer: 1 }),
        }),
      ),
    );

    // Feedback przed przejściem dalej.
    expect(await screen.findByText('Poprawna odpowiedź!')).toBeInTheDocument();

    // Ostatni blok + status COMPLETED z API -> przycisk kontynuacji mówi
    // "Zobacz podsumowanie", nie "Dalej".
    const continueButton = screen.getByRole('button', { name: 'Zobacz podsumowanie' });
    fireEvent.click(continueButton);

    expect(await screen.findByText('Kurs ukończony')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
  });

  it('kurs już COMPLETED przy wejściu -> od razu podsumowanie, bez renderowania bloków', () => {
    const completedCourse: CoursePlayerInitialState = {
      ...singleQuizBlockCourse,
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: 80,
    };

    render(<CoursePlayer courseId="course-1" initial={completedCourse} />);

    expect(screen.getByText('Kurs ukończony')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.queryByText('Który e-mail jest podejrzany?')).not.toBeInTheDocument();
  });

  it('scoreUnavailable=true pokazuje komunikat o błędzie pobrania wyniku, nie fałszywe "brak ocenianych pytań"', () => {
    const completedCourse: CoursePlayerInitialState = {
      ...singleQuizBlockCourse,
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: null,
    };

    render(<CoursePlayer courseId="course-1" initial={completedCourse} scoreUnavailable />);

    expect(screen.getByText(/nie udało się pobrać wyniku/i)).toBeInTheDocument();
    expect(screen.queryByText('Ten kurs nie zawierał ocenianych pytań.')).not.toBeInTheDocument();
  });

  it('błędna odpowiedź: feedback pokazuje "Niepoprawna odpowiedź."', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'assignment-1',
        status: 'COMPLETED',
        currentBlockIndex: 1,
        score: 0,
        completedAt: '2026-01-01T00:00:00.000Z',
        lastResult: { blockIndex: 0, type: 'QUIZ', correct: false },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    fireEvent.click(screen.getByText('wsparcie@bank-oficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    expect(await screen.findByText('Niepoprawna odpowiedź.')).toBeInTheDocument();
  });

  it('401 z /progress przekierowuje do /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    fireEvent.click(screen.getByText('wsparcie@bank-oficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('błąd sieci (fetch rzuca wyjątkiem) pokazuje komunikat, nie crashuje, pozwala spróbować ponownie', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    fireEvent.click(screen.getByText('wsparcie@bank-oficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
    // Blok wciąż widoczny - user może spróbować ponownie, nie utknął na pustym ekranie.
    expect(screen.getByText('Który e-mail jest podejrzany?')).toBeInTheDocument();
  });

  it('zwraca ogólny komunikat błędu z API (nie 401, nie sieć) bez zmiany stanu postępu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Bloki trzeba ukończyć po kolei' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    fireEvent.click(screen.getByText('wsparcie@bank-oficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bloki trzeba ukończyć po kolei');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
