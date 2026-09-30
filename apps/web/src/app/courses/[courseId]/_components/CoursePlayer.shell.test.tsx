import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const audioBlock = (id: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'QUIZ' as const,
  prompt,
  options: [{ text: `${id}-A` }, { text: `${id}-B` }],
  narration: { text: `Narracja ${id}.`, audioUrl: `audio/${id}.mp3`, durationMs: 3000 },
  ...extra,
});

const silentBlock = (id: string, prompt: string) => ({ id, type: 'QUIZ' as const, prompt, options: [{ text: `${id}-A` }, { text: `${id}-B` }] });

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [
      audioBlock('one', 'Pytanie pierwsze', { mascot: { pose: 'greeting', text: 'Cześć! Zaczynamy.' } }),
      audioBlock('two', 'Pytanie drugie'),
      silentBlock('three', 'Pytanie trzecie'),
      silentBlock('four', 'Pytanie czwarte'),
    ],
    progress: null,
    score: null,
    ...overrides,
  };
}

const answerResponse = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    assignmentId: 'a1',
    status: 'IN_PROGRESS',
    currentBlockIndex: 1,
    score: 100,
    completedAt: null,
    lastResult: { blockIndex: 0, blockId: 'one', type: 'QUIZ', correct: true, points: 1 },
    gamification: null,
    ...over,
  }),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Po wyniku bloku jedyny „Dalej” (D-106) jest w pasku, aktywny. Czekamy na wynik, potem go klikamy.
async function continueFromFeedback() {
  await screen.findByText(/Poprawna odpowiedź|Niepoprawna odpowiedź/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Dalej' })[0]);
}

const answerFirstOption = () => {
  fireEvent.click(screen.getByLabelText(/-A$/));
  fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));
};

describe('CoursePlayer: powłoka (postęp, nawigacja, notatnik, lektor)', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    pushMock.mockClear();
  });

  describe('układ i postęp', () => {
    it('pasek postępu z tytułem: ukończone bloki z serwera i numer bieżącego; po odświeżeniu wracamy do bloku z serwera', () => {
      render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 2 })} />);

      expect(screen.getByRole('heading', { level: 1, name: 'Sprawa testowa' })).toBeInTheDocument();
      const bar = screen.getByRole('progressbar', { name: 'Postęp szkolenia' });
      expect(bar).toHaveAttribute('aria-valuenow', '50');
      expect(bar).toHaveAttribute('aria-valuetext', 'Ukończono 2 z 4 bloków');
      expect(screen.getAllByText('Blok 3 z 4').length).toBeGreaterThan(0);
      expect(screen.getByText('Pytanie trzecie')).toBeInTheDocument();
    });

    it('powłoka JEST landmarkiem <main> (kod review PR #44: trasa nie ma już Topbara/page.tsx <main> na ścieżce sukcesu - PlayerStage to CAŁY chrom strony), dokładnie jeden, oznaczony tytułem kursu', () => {
      const { container } = render(<CoursePlayer courseId="course-1" initial={course()} />);
      const mains = container.querySelectorAll('main');
      expect(mains).toHaveLength(1);
      expect(mains[0]).toHaveAccessibleName('Sprawa testowa');
    });

    it('tekst `block.mascot` z treści jako podpowiedź w pasku, bez postaci (D-093: poza ignorowana)', () => {
      render(<CoursePlayer courseId="course-1" initial={course()} />);
      // course() domyślnie NIE jest SCENE_HOTSPOTS -> contentLayout='slide' -> pasek, nie nakładka sceny.
      const unit = screen.getByTestId('hint-bar');
      expect(unit).toContainElement(screen.getByText('Cześć! Zaczynamy.'));
      expect(screen.queryByTestId('hint-overlay')).not.toBeInTheDocument();
      expect(unit.querySelector('img')).toBeNull();
      expect(document.querySelector('img[src^="/mascot/"]')).toBeNull();
    });

    it('podpowiedź przy nieaktywnym "Dalej" jest w tym samym rzędzie nawigacji (aria-describedby), nie pod przyciskiem', () => {
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      const nav = screen.getByRole('navigation', { name: 'Nawigacja po blokach' });
      const next = screen.getByRole('button', { name: /^Dalej$/ });
      // Podpowiedź zawijana w dwóch wierszach (D-130): tekst w wewnętrznym elemencie z line-clamp, id na zewnętrznym.
      const hint = screen.getByText('Ukończ ten blok, aby przejść dalej.').closest('[id]') as HTMLElement;
      expect(next).toBeDisabled();
      expect(nav).toContainElement(hint);
      expect(hint).toHaveTextContent('Ukończ ten blok, aby przejść dalej.');
      expect(hint.className).not.toMatch(/truncate/);
      expect(next).toHaveAttribute('aria-describedby', hint.id);
      expect(next).toHaveAttribute('title', 'Ukończ ten blok, aby przejść dalej.');
      expect(screen.getByRole('button', { name: /Wstecz/ })).toBeDisabled();
    });

    it('blok bez narracji: brak rzędu odtwarzacza i przełącznika, zostaje sama nawigacja', () => {
      const { container } = render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 2 })} />);

      expect(container.querySelector('section[aria-label="Narracja"]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lektor' })).toBeNull();
      expect(screen.queryByText(/nie ma narracji/i)).toBeNull();
      expect(screen.getByRole('navigation', { name: 'Nawigacja po blokach' })).toBeInTheDocument();
    });
  });

  describe('Wstecz / Dalej (podgląd tylko do odczytu)', () => {
    it('podgląd ukończonego bloku z wynikiem; brak formularza; Dalej wraca do bieżącego bloku; fokus na nagłówku sceny', () => {
      render(
        <CoursePlayer
          courseId="course-1"
          initial={course({
            currentBlockIndex: 2,
            progress: { v: 2, blocks: { two: { type: 'QUIZ', done: true, correct: false, points: 0 } }, notes: [] },
          })}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));

      expect(screen.getByTestId('review-block')).toBeInTheDocument();
      expect(screen.getByText('Pytanie drugie')).toBeInTheDocument();
      expect(screen.getByText('Twoja odpowiedź była niepoprawna.')).toBeInTheDocument();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Wybierz odpowiedź' })).toBeNull();
      expect(document.activeElement).toHaveTextContent('Blok 2 z 4');

      fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
      expect(screen.queryByTestId('review-block')).toBeNull();
      expect(screen.getByText('Pytanie trzecie')).toBeInTheDocument();
    });

    it('Wstecz o kilka bloków i Dalej po kolei; nie da się wyjść poza bieżący blok z serwera', () => {
      render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 3 })} />);

      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      expect(screen.getByText('Pytanie drugie')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
      expect(screen.getByText('Pytanie trzecie')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
      expect(screen.getByText('Pytanie czwarte')).toBeInTheDocument();
      expect(screen.queryByTestId('review-block')).toBeNull();
      expect(screen.getByRole('button', { name: /^Dalej$/ })).toBeDisabled();
    });

    it('podgląd nie wysyła nic na serwer', () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 2 })} />);

      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('"Wstecz" jest nieaktywne w trakcie wysyłania odpowiedzi (nie da się otworzyć podglądu w trakcie zapisu); po odpowiedzi aktywne dopiero po wyniku', async () => {
      const pending = deferred<ReturnType<typeof answerResponse>>();
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
      render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1 })} />);

      fireEvent.click(screen.getByLabelText(/-A$/));
      fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Wstecz/ })).toBeDisabled());

      pending.resolve(answerResponse({ currentBlockIndex: 2, lastResult: { blockIndex: 1, blockId: 'two', type: 'QUIZ', correct: true, points: 1 } }));
      await continueFromFeedback();

      // Po "Dalej" widać bieżący blok z serwera, nie podgląd, a "Wstecz" znów działa.
      expect(screen.getByText('Pytanie trzecie')).toBeInTheDocument();
      expect(screen.queryByTestId('review-block')).toBeNull();
      expect(screen.getByRole('button', { name: /Wstecz/ })).toBeEnabled();
    });

    it('wynik bloku (feedback): "Wstecz" nieaktywne, „Dalej” w pasku aktywny - jedyny przycisk dalej (D-106)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answerResponse()));
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      answerFirstOption();
      await screen.findByText('Poprawna odpowiedź!');

      expect(screen.getByRole('button', { name: /Wstecz/ })).toBeDisabled();
      expect(screen.getAllByRole('button', { name: /Dalej/ })).toHaveLength(1);
      expect(screen.getByRole('button', { name: /Dalej/ })).toBeEnabled();
      expect(screen.getByTestId('player-bottombar')).toContainElement(screen.getByRole('button', { name: /Dalej/ }));
    });

    it('po odpowiedzi wynik jest zapisany do podglądu ("Wstecz") w tej samej sesji', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answerResponse()));
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      answerFirstOption();
      await continueFromFeedback();
      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));

      expect(screen.getByText('Pytanie pierwsze')).toBeInTheDocument();
      expect(screen.getByText('Twoja odpowiedź była poprawna.')).toBeInTheDocument();
    });
  });

  describe('wysyłanie odpowiedzi', () => {
    it('podwójne kliknięcie w tym samym ticku wysyła tylko jedno żądanie (synchroniczna blokada)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(answerResponse());
      vi.stubGlobal('fetch', fetchMock);
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      fireEvent.click(screen.getByLabelText(/-A$/));
      const submit = screen.getByRole('button', { name: 'Wybierz odpowiedź' });
      fireEvent.click(submit);
      fireEvent.click(submit);
      fireEvent.click(submit);

      await screen.findByText('Poprawna odpowiedź!');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('po błędzie serwera blokada jest zdjęta: można spróbować ponownie', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'Błąd serwera' }) })
        .mockResolvedValueOnce(answerResponse());
      vi.stubGlobal('fetch', fetchMock);
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      answerFirstOption();
      expect(await screen.findByRole('alert')).toHaveTextContent('Błąd serwera');
      fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

      await screen.findByText('Poprawna odpowiedź!');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('ukończenie kursu', () => {
    it('ostatni blok OCENIANY (QUIZ): zapis pokazuje normalny ekran feedbacku "Poprawna odpowiedź!" (D-076 - blok oceniany kończący kurs NIE pomija ekranu feedbacku), "Dalej" prowadzi do podsumowania bez odtwarzacza i przełącznika (blok SUMMARY, którego tu nie ma, bez narracji)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          answerResponse({ status: 'COMPLETED', currentBlockIndex: 1, score: 100, lastResult: { blockIndex: 0, blockId: 'one', type: 'QUIZ', correct: true, points: 1 } }),
        ),
      );
      const { container } = render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: [audioBlock('one', 'Pytanie pierwsze')] })} />);

      answerFirstOption();

      // Blok OCENIANY kończący kurs: ekran feedbacku zostaje (z narracją tego bloku - miał audio) - jeszcze NIE podsumowanie.
      expect(await screen.findByText('Poprawna odpowiedź!')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Sprawa zamknięta' })).not.toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: 'Dalej' })[0]);

      const summaryHeading = await screen.findByRole('heading', { level: 2, name: 'Sprawa zamknięta' });
      // Fokus ląduje na WIDOCZNYM nagłówku SummaryScreen (nie na sr-only nagłówku PlayerStage.tsx - D-076).
      expect(document.activeElement).toBe(summaryHeading);
      expect(screen.queryByText('Poprawna odpowiedź!')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Zobacz podsumowanie' })).not.toBeInTheDocument();
      // Kurs bez bloku SUMMARY - SummaryScreen nie ma własnej narracji do odtworzenia.
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Lektor' })).toBeNull();
      // Pasek postępu ZOSTAJE na 100% (feat/player-stage: "górny pasek jak w kursie" - X, tytuł, postęp - także na
      // ekranie podsumowania).
      expect(screen.getByRole('progressbar', { name: 'Postęp szkolenia' })).toHaveAttribute('aria-valuenow', '100');
    });
  });

  describe('fokus', () => {
    it('przy pierwszym renderze fokus NIE ląduje na nagłówku sceny', () => {
      render(<CoursePlayer courseId="course-1" initial={course()} />);
      expect(document.activeElement).toBe(document.body);
    });

    it('błąd zapisu odpowiedzi nie przenosi fokusu na nagłówek', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      render(<CoursePlayer courseId="course-1" initial={course()} />);
      const option = screen.getByLabelText(/-A$/);
      option.focus();
      fireEvent.click(option);
      fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
      expect(document.activeElement).not.toHaveTextContent(/^Blok \d+ z \d+$/);
    });
  });

  describe('notatnik', () => {
    it('licznik z /start, panel pokazuje treść notatek po kliknięciu (aria-expanded, aria-controls tylko gdy panel istnieje)', () => {
      render(
        <CoursePlayer
          courseId="course-1"
          initial={course({ progress: { v: 2, blocks: {}, notes: [{ blockId: 'x', text: 'Mail przyszedł rano.' }, { blockId: 'y', text: 'Adres bank-0.pl' }] } })}
        />,
      );

      const toggle = screen.getByRole('button', { name: /Notatnik \(2\)/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).not.toHaveAttribute('aria-controls');
      // Panel notatnika (jak drawer Topbara, PR #39) jest zamontowany od razu - animacja wysuwania wymaga
      // trwałego montowania - ale jest aria-hidden, dopóki zamknięty, więc czytnik ekranu go nie widzi. Bez
      // filtra name: element aria-hidden="true" liczy nazwę dostępną jako pustą niezależnie od aria-label
      // (ten sam wzorzec co drawer Topbara, PR #39).
      const drawer = screen.getByRole('dialog', { hidden: true });
      expect(drawer).toHaveAttribute('aria-hidden', 'true');
      expect(drawer).toHaveTextContent('Mail przyszedł rano.');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle.getAttribute('aria-controls')).toBe(screen.getByRole('complementary', { name: 'Notatnik' }).id);
      expect(drawer).toHaveAttribute('aria-hidden', 'false');
      expect(screen.getByText('Mail przyszedł rano.')).toBeInTheDocument();
      expect(screen.getByText('Adres bank-0.pl')).toBeInTheDocument();
    });

    it('pusty notatnik pokazuje podpowiedź', () => {
      render(<CoursePlayer courseId="course-1" initial={course()} />);
      fireEvent.click(screen.getByRole('button', { name: /Notatnik \(0\)/ }));
      expect(screen.getByText('Notatki pojawią się w trakcie szkolenia.')).toBeInTheDocument();
    });
  });

  describe('przełącznik "Lektor" (przycisk z aria-pressed, zapis od razu na koncie)', () => {
    const lektor = () => screen.getByRole('button', { name: 'Lektor' });

    it('zapisuje wybór przez PATCH /api/users/me/preferences i zmienia stan (aria-pressed)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ narrationEnabled: false }) });
      vi.stubGlobal('fetch', fetchMock);
      render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled />);
      expect(lektor()).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(lektor());

      await waitFor(() => expect(lektor()).toHaveAttribute('aria-pressed', 'false'));
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me/preferences',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ narrationEnabled: false }) }),
      );
    });

    it('błąd zapisu wraca do poprzedniej wartości i pokazuje komunikat', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
      render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled />);

      fireEvent.click(lektor());

      expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się zapisać ustawienia lektora/i);
      expect(lektor()).toHaveAttribute('aria-pressed', 'true');
    });

    it('401 przekierowuje do logowania', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
      render(<CoursePlayer courseId="course-1" initial={course()} />);

      fireEvent.click(lektor());

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    });

    it('wyłączony z konta: brak odtwarzacza audio, przełącznik niezaznaczony', () => {
      const { container } = render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
      expect(container.querySelector('audio')).toBeNull();
      expect(lektor()).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('autoodtwarzanie kolejnego bloku', () => {
    it('pierwszy blok nie startuje sam; następny startuje po "Dalej", gdy poprzedni miał nagranie', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answerResponse()));
      render(<CoursePlayer courseId="course-1" initial={course()} />);
      expect(playSpy).not.toHaveBeenCalled();

      answerFirstOption();
      await continueFromFeedback();

      await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Pytanie drugie')).toBeInTheDocument();
    });

    it('nie startuje, gdy poprzedni blok nie miał nagrania (nawet jeśli następny ma)', async () => {
      const blocks = [silentBlock('zero', 'Pytanie zerowe'), audioBlock('one', 'Pytanie pierwsze')];
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(answerResponse({ lastResult: { blockIndex: 0, blockId: 'zero', type: 'QUIZ', correct: true, points: 1 } })),
      );
      render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: blocks })} />);

      answerFirstOption();
      await continueFromFeedback();

      await screen.findByText('Pytanie pierwsze');
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('nie startuje, gdy lektor jest wyłączony', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answerResponse()));
      render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);

      answerFirstOption();
      await continueFromFeedback();

      await screen.findByText('Pytanie drugie');
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('"Wstecz" nigdy nie uruchamia audio automatycznie', () => {
      render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1 })} />);
      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      expect(playSpy).not.toHaveBeenCalled();
    });
  });
});

// D-103 (rozszerza D-099): tekst min. 15 px na telefonie (.mobile-readable na ramce odtwarzacza) w KAŻDYM bloku i na ekranie zamknięcia.
describe('CoursePlayer: tekst min. 15 px na telefonie w całym module', () => {
  const blocks = [
    silentBlock('one', 'Pytanie pierwsze'),
    { id: 'kolejnosc', type: 'ORDERING' as const, prompt: 'Ułóż.', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] },
    { id: 'wnioski', type: 'SUMMARY' as const, text: 'Koniec.' },
  ];
  const frame = () => screen.getByRole('main');

  it('każdy typ bloku i ekran zamknięcia - ramka z klasą .mobile-readable', () => {
    for (const index of [0, 1, 2]) {
      const view = render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: blocks, currentBlockIndex: index })} />);
      expect(frame()).toHaveClass('mobile-readable');
      view.unmount();
    }
    render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: blocks, status: 'COMPLETED', currentBlockIndex: 3, score: 100 })} />);
    expect(frame()).toHaveClass('mobile-readable');
  });
});
