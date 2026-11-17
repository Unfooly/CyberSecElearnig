import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { CourseCompletionReward, ModuleInfo } from '@/lib/courses-types';
import { summaryRules } from './simple-markdown';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const info = (over: Partial<ModuleInfo> = {}): ModuleInfo => ({
  category: 'IT_HYGIENE',
  durationMinutes: 6,
  subtitle: null,
  caseNumber: 5,
  cover: { start: 'assets/m/start.1a2b3c4d.webp', end: 'assets/m/koniec.1a2b3c4d.webp', startPortrait: null, endPortrait: 'assets/m/koniec-pion.1a2b3c4d.webp' },
  ...over,
});

const summary = {
  id: 'podsumowanie',
  type: 'SUMMARY',
  title: 'Drzwi zamknięte',
  text: 'Wstęp.\n\n**Trzy zasady**\n\n1. Wchodzisz **swoją** kartą.\n2. Nie podłączasz nieznanych urządzeń.\n3. Goście mają sieć dla gości.',
};

function completed(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Najłatwiejsze drzwi',
    status: 'COMPLETED',
    currentBlockIndex: 2,
    startedAt: '2026-11-17T10:00:00.000Z',
    completedAt: '2026-11-17T10:07:00.000Z',
    contentBlocks: [{ id: 'q', type: 'QUIZ', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] }, summary] as CoursePlayerInitialState['contentBlocks'],
    progress: null,
    score: 90,
    moduleInfo: info(),
    ...overrides,
  };
}

const reward: CourseCompletionReward = {
  xpGained: 150,
  newLevel: 3,
  previousLevel: 3,
  leveledUp: false,
  levelProgressBeforePercent: 40,
  levelProgressAfterPercent: 68,
  unlockedBadges: [{ code: 'flawless-case', title: 'Sprawa bez skazy', icon: 'x', xpReward: 50, rank: 'RARE' }],
};

const BASE = 'https://cdn.example.com';

describe('CoursePlayer: ekran końca modułu (D-165)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
  });

  it('ukończony kurs z danymi modułu: pieczątka, nagłówek z SUMMARY, wynik/czas, zasady z listy numerowanej, okładka końca, bez paska odtwarzacza', () => {
    const { container } = render(<CoursePlayer courseId="course-1" initial={completed()} contentBase={BASE} />);
    expect(screen.getByTestId('module-end')).toBeInTheDocument();
    expect(screen.getByTestId('module-end-stamp')).toHaveTextContent('Sprawa zamknięta');
    expect(screen.getByRole('heading', { level: 1, name: 'Drzwi zamknięte' })).toBeInTheDocument();
    expect(screen.getByTestId('module-end-wynik')).toHaveTextContent('90%');
    expect(screen.getByTestId('module-end-czas')).toHaveTextContent('7 min');
    // Powrót do ukończonego kursu - bez świeżej nagrody: „—” w punktach, bez karty poziomu.
    expect(screen.getByTestId('module-end-punkty')).toHaveTextContent('—');
    expect(screen.queryByTestId('module-end-level')).not.toBeInTheDocument();
    const rules = screen.getByRole('region', { name: 'Trzy zasady na wynos' });
    expect(rules).toHaveTextContent('1. Wchodzisz swoją kartą.');
    expect(rules.querySelector('strong')).toHaveTextContent('swoją');
    expect(screen.getByTestId('module-end-cover')).toHaveAttribute('src', `${BASE}/assets/m/koniec.1a2b3c4d.webp`);
    expect(container.querySelector('source')).toHaveAttribute('srcset', `${BASE}/assets/m/koniec-pion.1a2b3c4d.webp`);
    expect(screen.queryByTestId('player-bottombar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-closed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wróć do biblioteki' })).toHaveAttribute('href', '/courses');
    expect(screen.getByRole('button', { name: 'Następna sprawa · wkrótce' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('następny kurs - link „Następna sprawa”; bez okładki - ciemne tło bez obrazu', () => {
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ moduleInfo: info({ cover: null }) })}
        contentBase={BASE}
        nextCourse={{ courseId: 'kurs-2', title: 'Łańcuszek' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Następna sprawa: Łańcuszek' })).toHaveAttribute('href', '/courses/kurs-2');
    expect(screen.queryByTestId('module-end-cover')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-end')).toHaveClass('bg-[#23232A]');
  });

  it('świeże ukończenie (nagroda): +XP, poziom z paskiem i nowe osiągnięcie, ogłoszenie dla czytnika', async () => {
    render(<CoursePlayer courseId="course-1" initial={completed()} contentBase={BASE} previewReward={reward} />);
    expect(screen.getByTestId('module-end-punkty')).toHaveTextContent('+150');
    expect(screen.getByTestId('module-end-level')).toHaveTextContent('Poziom 3');
    expect(screen.getByRole('progressbar', { name: 'Poziom 3' })).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByTestId('module-end-badge')).toHaveTextContent('Nowe: Sprawa bez skazy');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Kurs ukończony. Zdobyto 150 punktów doświadczenia.'));
  });

  it('„Zagraj jeszcze raz” uruchamia kurs od nowa (POST restart, jak „Rozpocznij od nowa”)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ assignmentId: 'a2' }) }));
    vi.stubGlobal('fetch', fetchMock);
    // Restart pyta o potwierdzenie (D-069) - jak przy „Rozpocznij od nowa”.
    vi.stubGlobal('confirm', () => true);
    render(<CoursePlayer courseId="course-1" initial={completed()} contentBase={BASE} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Zagraj jeszcze raz' })));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/restart');
  });

  it('przejście jak na produkcji (D-169): SUMMARY jako bieżący blok zamyka się sam -> /progress COMPLETED z nagrodą -> ekran końca, fokus na nagłówku, +XP, ogłoszenie', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'COMPLETED',
        currentBlockIndex: 2,
        score: 90,
        completedAt: '2026-11-17T10:07:00.000Z',
        lastResult: { blockIndex: 1, blockId: 'podsumowanie', type: 'SUMMARY' },
        gamification: reward,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ status: 'IN_PROGRESS', currentBlockIndex: 1, completedAt: null, score: null, progress: { v: 2, notes: [], blocks: { q: { type: 'QUIZ', done: true, answer: 1 } } } })}
        contentBase={BASE}
        narrationEnabled={false}
      />,
    );
    // Region ogłoszenia istnieje już w ramce odtwarzacza (przed ukończeniem) - pusty; zamiast treści podsumowania - „Zamykanie sprawy…”.
    const live = screen.getByTestId('result-announcement');
    expect(live).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Zakończ szkolenie' })).not.toBeInTheDocument();
    await screen.findByTestId('module-end');
    // Jeden zapis - bloku podsumowania, bez kliknięcia.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body as string)).toEqual({ blockIndex: 1 });
    // Ten sam element regionu (zachowany przy przejściu), teraz z treścią.
    expect(screen.getByTestId('result-announcement')).toBe(live);
    expect(live).toHaveTextContent('Kurs ukończony. Zdobyto 150 punktów doświadczenia.');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Drzwi zamknięte' })).toHaveFocus());
    expect(screen.getByTestId('module-end-punkty')).toHaveTextContent('+150');
    expect(screen.getByTestId('module-end-level')).toHaveTextContent('Nowe: Sprawa bez skazy');
    expect(screen.queryByTestId('player-bottombar')).not.toBeInTheDocument();
  });

  it('nieudany zapis podsumowania (D-169) - podsumowanie pokazuje się jak dotąd, z błędem i „Zakończ szkolenie”, bez pętli zapisów', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'Awaria.' }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ status: 'IN_PROGRESS', currentBlockIndex: 1, completedAt: null, score: null, progress: { v: 2, notes: [], blocks: { q: { type: 'QUIZ', done: true, answer: 1 } } } })}
        contentBase={BASE}
        narrationEnabled={false}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Awaria.');
    expect(await screen.findByRole('button', { name: 'Zakończ szkolenie' })).toBeInTheDocument();
    expect(screen.queryByTestId('module-end')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const progressReply = (over: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    json: async () => ({ assignmentId: 'a1', score: 100, completedAt: null, gamification: null, ...over }),
  });
  const quizDone = { blockIndex: 0, blockId: 'q', type: 'QUIZ', correct: true, points: 1 };
  const completedReply = progressReply({ status: 'COMPLETED', currentBlockIndex: 2, completedAt: '2026-11-17T10:07:00.000Z', lastResult: { blockIndex: 1, blockId: 'podsumowanie', type: 'SUMMARY' }, gamification: reward });

  it('blok oceniany (tryb zwykły): ekran wyniku -> „Dalej” -> podsumowanie zamyka się samo -> ekran końca (D-169)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(progressReply({ status: 'IN_PROGRESS', currentBlockIndex: 1, lastResult: quizDone }))
      .mockResolvedValueOnce(completedReply);
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={completed({ status: 'IN_PROGRESS', currentBlockIndex: 0, completedAt: null, score: null })} contentBase={BASE} narrationEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByLabelText('B'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Wybierz odpowiedź' })));
    // Ekran wyniku bloku ocenianego zostaje (D-076); podsumowanie jeszcze nie jest zapisywane.
    await screen.findByText(/Poprawna odpowiedź/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dalej' })));
    await screen.findByTestId('module-end');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(((fetchMock.mock.calls[1] as unknown[])[1] as RequestInit).body as string)).toEqual({ blockIndex: 1 });
  });

  it('tryb prosty: trafienie w ostatnim pytaniu -> „Dalej” -> od razu ekran końca, bez ekranu podsumowania (D-169)', async () => {
    // Kolejno: /check (trafienie), zapis pytania, automatyczny zapis podsumowania.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ blockId: 'q', result: 'good', feedback: 'Tak.', done: true }) })
      .mockResolvedValueOnce(progressReply({ status: 'IN_PROGRESS', currentBlockIndex: 1, lastResult: quizDone }))
      .mockResolvedValueOnce(completedReply);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ status: 'IN_PROGRESS', currentBlockIndex: 0, completedAt: null, score: null, simpleMode: true })}
        contentBase={BASE}
        narrationEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'B' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dalej' })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dalej' })));
    await screen.findByTestId('module-end');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Wstęp.')).not.toBeInTheDocument();
  });

  it('po nieudanym zapisie „Zakończ szkolenie” kończy kurs - łącznie 2 zapisy, bez podwójnego (D-169)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'Awaria.' }) })
      .mockResolvedValueOnce(completedReply);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ status: 'IN_PROGRESS', currentBlockIndex: 1, completedAt: null, score: null, progress: { v: 2, notes: [], blocks: { q: { type: 'QUIZ', done: true, answer: 1 } } } })}
        contentBase={BASE}
        narrationEnabled={false}
      />,
    );
    const finish = await screen.findByRole('button', { name: 'Zakończ szkolenie' });
    await waitFor(() => expect(finish).not.toBeDisabled());
    await act(async () => fireEvent.click(finish));
    await screen.findByTestId('module-end');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bez danych modułu (starsze API) podsumowanie zostaje osobnym ekranem - nie zamyka się samo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CoursePlayer
        courseId="course-1"
        initial={completed({ moduleInfo: undefined, status: 'IN_PROGRESS', currentBlockIndex: 1, completedAt: null, score: null, progress: null })}
        contentBase={BASE}
        narrationEnabled={false}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Zakończ szkolenie' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('odpowiedź bez danych modułu (starsze API) - dotychczasowy raport w teczce', () => {
    render(<CoursePlayer courseId="course-1" initial={completed({ moduleInfo: undefined })} contentBase={BASE} />);
    expect(screen.queryByTestId('module-end')).not.toBeInTheDocument();
    expect(screen.getByTestId('case-closed')).toBeInTheDocument();
  });
});

describe('summaryRules (zasady na ekranie końca)', () => {
  it('wnioski `lessons` mają pierwszeństwo; bez nich pierwsza lista numerowana z tekstu; bez obu - pusto', () => {
    expect(summaryRules({ lessons: ['A.', 'B.'], text: '1. X' })).toEqual(['A.', 'B.']);
    expect(summaryRules({ text: 'Wstęp.\n\n1. Jeden.\n2. Dwa.\n\nKoniec.\n\n1. Inna lista.' })).toEqual(['Jeden.', 'Dwa.']);
    expect(summaryRules({ text: 'Sam tekst.' })).toEqual([]);
    expect(summaryRules(undefined)).toEqual([]);
  });
});
