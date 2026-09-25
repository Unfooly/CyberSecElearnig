import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
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
    vi.restoreAllMocks();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('start -> odpowiedź -> OD RAZU podsumowanie z wynikiem z API (fix/course-finish-flow: bez ekranu pośredniego "Blok ukończony."/"Zobacz podsumowanie" - grep na te dwa napisy w tym pliku i CAŁYM apps/web powinien nic nie zwracać)', async () => {
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
        gamification: null,
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

    // OD RAZU podsumowanie - żaden pośredni ekran feedbacku, żaden przycisk "Zobacz podsumowanie" do kliknięcia.
    expect(await screen.findByRole('heading', { level: 1, name: 'Sprawa zamknięta' })).toBeInTheDocument();
    expect(screen.queryByText('Poprawna odpowiedź!')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zobacz podsumowanie' })).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    // Tytuł kursu widać DOKŁADNIE dwa razy: w pasku górnym PlayerStage (zawsze) i w treści SummaryScreen (kod
    // review PR #44: asercja >=1 przechodziłaby nawet, gdyby jedno z tych dwóch miejsc zniknęło).
    expect(screen.getAllByText('Rozpoznawanie phishingu')).toHaveLength(2);
    // gamification: null w odpowiedzi (badge się nie odblokował w tym scenariuszu testowym) -> brak karty nagrody.
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
  });

  it('pokazuje kartę nagrody (RewardCard, inline na SummaryScreen) z danymi z odpowiedzi /progress, gdy kurs kończy się z gamification', async () => {
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
        gamification: {
          xpGained: 150,
          newLevel: 2,
          previousLevel: 1,
          leveledUp: true,
          unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
          levelProgressBeforePercent: 0,
          levelProgressAfterPercent: 100,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); // XP od razu wartość końcowa, bez animacji

    render(<CoursePlayer courseId="course-1" initial={singleQuizBlockCourse} />);

    fireEvent.click(screen.getByText('wsparcie@bank-0ficjalny.pl'));
    fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

    await screen.findByRole('heading', { level: 1, name: 'Sprawa zamknięta' });
    expect(screen.getByText('+150 XP')).toBeInTheDocument();
    expect(screen.getByText('Awans na poziom 2!')).toBeInTheDocument();
    expect(screen.getByText(/Pierwszy Krok/)).toBeInTheDocument();
  });

  it('kurs już COMPLETED przy wejściu -> od razu podsumowanie, bez renderowania bloków', () => {
    const completedCourse: CoursePlayerInitialState = {
      ...singleQuizBlockCourse,
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: 80,
    };

    render(<CoursePlayer courseId="course-1" initial={completedCourse} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Sprawa zamknięta' })).toBeInTheDocument();
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

  it('błędna odpowiedź MID-KURSU (nie kończy go - fix/course-finish-flow skipsFeedbackScreen zależy od status==="COMPLETED", nie tylko typu bloku) pokazuje ekran feedbacku "Niepoprawna odpowiedź."', async () => {
    const twoQuizBlockCourse: CoursePlayerInitialState = {
      ...singleQuizBlockCourse,
      contentBlocks: [...singleQuizBlockCourse.contentBlocks, { ...singleQuizBlockCourse.contentBlocks[0] }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'assignment-1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, type: 'QUIZ', correct: false },
        gamification: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoursePlayer courseId="course-1" initial={twoQuizBlockCourse} />);

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

  // "Rozpocznij od nowa" (D-069, B-091): przycisk "Wstecz" w pasku PlayerStage, gdy kurs jest w trybie podsumowania.
  // Kod review PR #44: te testy zniknęły bez zastąpienia przy przenosinach logiki z (usuniętego) SummaryScreen do
  // CoursePlayer.tsx - fałszywy komentarz w SummaryScreen.test.tsx twierdził, że "przeniesiono" je tutaj.
  describe('"Rozpocznij od nowa" na ekranie podsumowania (restartCourse w CoursePlayer.tsx)', () => {
    const completedCourse: CoursePlayerInitialState = {
      ...singleQuizBlockCourse,
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: 80,
    };

    it('anulowanie potwierdzenia (window.confirm -> false) nie woła API', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      render(<CoursePlayer courseId="course-1" initial={completedCourse} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('potwierdzenie -> POST /api/courses/:id/restart, sukces odświeża stronę (router.refresh(), NIE nawigacja)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      render(<CoursePlayer courseId="course-1" initial={completedCourse} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/restart', { method: 'POST' }));
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('błąd z API (np. 409 - przypisanie już zarchiwizowane w międzyczasie) pokazuje komunikat i odblokowuje przycisk', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      render(<CoursePlayer courseId="course-1" initial={completedCourse} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      expect(await screen.findByText(/nie udało się rozpocząć kursu od nowa/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rozpocznij od nowa' })).toBeEnabled();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('w trakcie zapytania przycisk pokazuje "Uruchamianie od nowa…" i jest zablokowany', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolveFetch: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
      const pending = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      const fetchMock = vi.fn().mockReturnValue(pending);
      vi.stubGlobal('fetch', fetchMock);

      render(<CoursePlayer courseId="course-1" initial={completedCourse} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      const pendingButton = await screen.findByRole('button', { name: 'Uruchamianie od nowa…' });
      expect(pendingButton).toBeDisabled();

      resolveFetch!({ ok: true, status: 204, json: async () => ({}) });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    });
  });
});
