import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';
import { badgeNumber, displayNameFromEmail, playerIdentity } from '@/lib/use-my-display-name';
import { notebookTasks } from './player/notes';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Odprawa (BRIEFING, schemaVersion 5, D-081): kroki, "Pomiń odprawę", legitymacja z danych sesji, zadania w notatniku.

const briefing: ContentBlock = {
  type: 'BRIEFING',
  id: 'odprawa',
  steps: [
    { kind: 'typewriter', text: 'Wtorek, 7:58. Dzwoni telefon.', sub: 'Numer zastrzeżony.', cta: 'Odbierz' },
    { kind: 'call', caller: { name: 'Komisarz Fooli', role: 'Wydział cyber', mascot: 'greeting' }, text: 'Mamy sprawę w Unfooly.', cta: 'Słucham' },
    {
      kind: 'caseFile',
      caseNo: 'SPR-2026-0412',
      title: 'Wyłudzone hasło',
      fields: [{ label: 'Firma', value: 'Unfooly Sp. z o.o., Kraków' }],
      stamp: 'PILNE',
      cta: 'Przyjmuję sprawę',
    },
    { kind: 'badge', cta: 'Do dzieła' },
  ],
};

const objectives = [
  { text: 'Zabezpiecz dowody w biurze.', completeWhen: ['biuro'] },
  { text: 'Porozmawiaj z IT.', completeWhen: ['biuro', 'rozmowa'] },
  { text: 'Cel bez completeWhen.' },
];

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [
      briefing,
      { type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.' },
      { type: 'NARRATIVE', id: 'rozmowa', text: 'Rozmowa z IT.' },
    ],
    objectives,
    progress: null,
    score: null,
    ...overrides,
  };
}

function progressAfter(blockIndex: number, blockId: string, type: string) {
  return {
    assignmentId: 'a1',
    status: 'IN_PROGRESS',
    currentBlockIndex: blockIndex + 1,
    score: null,
    completedAt: null,
    lastResult: { blockIndex, blockId, type },
    gamification: null,
  };
}

/** fetch rozróżniany po adresie: imię do legitymacji, avatar i zapis postępu. */
function stubFetch(displayName: unknown = { firstName: 'Anna', lastInitial: 'K' }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/users/me/display-name') return { ok: true, status: 200, json: async () => displayName };
    if (url === '/api/users/me/avatar') return { ok: true, status: 200, json: async () => ({ avatarUrl: null }) };
    const body = JSON.parse(String(init?.body ?? '{}'));
    const block = course().contentBlocks[body.blockIndex];
    return { ok: true, status: 200, json: async () => progressAfter(body.blockIndex, block.id ?? '', block.type) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const progressCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/progress'));

/** Pozycja zadania w sekcji "Zadania" notatnika (stan jest w sr-only prefiksie tej samej pozycji). */
const notebookTask = (text: string) => within(screen.getByRole('region', { name: 'Zadania' })).getByText(text).closest('li')!;

describe('CoursePlayer: odprawa (BRIEFING)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('kroki po kolei przyciskami, legitymacja z imieniem z profilu i numerem odznaki; ostatni krok zapisuje blok bez odpowiedzi', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} userEmail="anna.kowalska@firma.pl" />);

    // Tekst "maszyny do pisania" dla czytnika od razu w całości (widoczny jest wystukiwany znak po znaku).
    expect(screen.getByText('Wtorek, 7:58. Dzwoni telefon. Numer zastrzeżony.')).toHaveClass('sr-only');
    // Wyjściem jest odprawa (ostatni krok albo "Pomiń"), nie "Dalej" z paska.
    expect(screen.queryByRole('button', { name: /^Dalej$/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.getByText('Komisarz Fooli')).toBeInTheDocument();
    expect(screen.getByText('Mamy sprawę w Unfooly.')).toBeInTheDocument();
    expect(screen.getByAltText('Maskotka Unfooly wita')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Słucham' }));
    expect(screen.getByText('SPR-2026-0412')).toHaveClass('font-typewriter');
    expect(screen.getByText('Unfooly Sp. z o.o., Kraków')).toBeInTheDocument();
    expect(screen.getByText('PILNE')).toHaveTextContent('Pieczątka: PILNE');
    // Zadania pod kartą sprawy - z celów modułu (wersja przypisania), nie z treści kroku.
    const tasks = within(screen.getByRole('region', { name: 'Zadania' }));
    expect(tasks.getByText('Zabezpiecz dowody w biurze.')).toBeInTheDocument();
    expect(tasks.getByText('Cel bez completeWhen.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję sprawę' }));
    await screen.findByText('Anna K.');
    expect(screen.getByText('0412-AK')).toBeInTheDocument();
    expect(progressCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Do dzieła' }));
    await waitFor(() => expect(progressCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(progressCalls(fetchMock)[0][1]?.body))).toEqual({ blockIndex: 0 });
    await screen.findByText('Biuro Anny.');
  });

  it('"Pomiń odprawę" w górnym pasku jest widoczny od razu i zapisuje blok; zadania się NIE odhaczają', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} userEmail="anna.kowalska@firma.pl" />);

    fireEvent.click(screen.getByRole('button', { name: 'Pomiń odprawę' }));
    await waitFor(() => expect(progressCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(progressCalls(fetchMock)[0][1]?.body))).toEqual({ blockIndex: 0 });
    await screen.findByText('Biuro Anny.');
    expect(screen.queryByRole('button', { name: 'Pomiń odprawę' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notatnik/ }));
    expect(notebookTask('Zabezpiecz dowody w biurze.')).toHaveTextContent('Do zrobienia:');
    expect(notebookTask('Porozmawiaj z IT.')).toHaveTextContent('Do zrobienia:');
  });

  it('ponowne wejście w ukończoną odprawę ("Wstecz"): "Pomiń odprawę" od razu, przewija dalej bez zapisu', async () => {
    const fetchMock = stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({ currentBlockIndex: 1, progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true } }, notes: [] } })}
        narrationEnabled={false}
        userEmail="anna.kowalska@firma.pl"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Odbierz' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pomiń odprawę' }));
    expect(screen.queryByTestId('review-block')).not.toBeInTheDocument();
    expect(screen.getByText('Biuro Anny.')).toBeInTheDocument();
    expect(progressCalls(fetchMock)).toHaveLength(0);
  });

  it('zadania w notatniku odhaczone wg ukończonych bloków (wszystkie z completeWhen), także zaraz po zapisie w tej sesji', async () => {
    stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({
          currentBlockIndex: 2,
          progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true }, biuro: { type: 'NARRATIVE', done: true } }, notes: [] },
        })}
        narrationEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notatnik/ }));
    expect(notebookTask('Zabezpiecz dowody w biurze.')).toHaveTextContent('Wykonane:');
    expect(notebookTask('Porozmawiaj z IT.')).toHaveTextContent('Do zrobienia:');
    // Cel bez completeWhen: zwykła pozycja, bez stanu.
    expect(notebookTask('Cel bez completeWhen.').textContent).toBe('Cel bez completeWhen.');

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij notatnik' }));
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));
    // Ostatni blok ukończony w TEJ sesji: kurs przechodzi dalej, a zadanie odhacza się z wyniku zapisu (bez /start).
    await waitFor(() => expect(screen.queryByText('Rozmowa z IT.')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Notatnik/ }));
    expect(notebookTask('Porozmawiaj z IT.')).toHaveTextContent('Wykonane:');
  });

  it('legitymacja bez imienia w profilu: imię z e-maila; bez e-maila (np. podgląd dev) neutralny "Detektyw"', async () => {
    stubFetch({ firstName: null, lastInitial: null });
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} userEmail="jan.nowak@firma.pl" />);
    for (const cta of ['Odbierz', 'Słucham', 'Przyjmuję sprawę']) fireEvent.click(screen.getByRole('button', { name: cta }));
    expect(await screen.findByText('Jan N.')).toBeInTheDocument();
    unmount();

    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    for (const cta of ['Odbierz', 'Słucham', 'Przyjmuję sprawę']) fireEvent.click(screen.getByRole('button', { name: cta }));
    expect(screen.getByText('Detektyw')).toBeInTheDocument();
    // Bez zalogowanego e-maila nie ma po co pytać o imię.
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/users/me/display-name')).toBe(false);
  });

  it('pasek lektora idzie za KROKIEM odprawy (steps[].narration), krok bez narracji nie ma paska', () => {
    stubFetch();
    const withNarration: ContentBlock = {
      ...briefing,
      steps: briefing.steps!.map((step, index) => (index === 1 ? { ...step, narration: { text: 'Komisarz mówi o sprawie.' } } : step)),
    };
    render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: [withNarration] })} narrationEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Transkrypcja' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transkrypcja' }));
    expect(within(screen.getByRole('region', { name: 'Transkrypcja narracji' })).getByText('Komisarz mówi o sprawie.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Słucham' }));
    expect(screen.queryByRole('button', { name: 'Transkrypcja' })).not.toBeInTheDocument();
  });

  describe('autoodtwarzanie narracji kroków (lektor włączony)', () => {
    const withAudio: ContentBlock = {
      ...briefing,
      steps: briefing.steps!.map((step, index) => ({
        ...step,
        narration: { text: `Narracja kroku ${index}.`, audioUrl: `audio/odprawa/krok-${index}.mp3`, durationMs: 1000 },
      })),
    };
    const next: ContentBlock = { type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.', narration: { text: 'Biuro.', audioUrl: 'audio/biuro.mp3', durationMs: 1000 } };
    const audioCourse = (overrides: Partial<CoursePlayerInitialState> = {}) =>
      course({ contentBlocks: [withAudio, next, { type: 'NARRATIVE', id: 'rozmowa', text: 'Rozmowa z IT.' }], ...overrides });
    // Który plik próbowano odtworzyć (src elementu audio w chwili play()).
    function spyPlay() {
      const played: string[] = [];
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
        played.push(this.getAttribute('src') ?? '');
        return Promise.resolve();
      });
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      return played;
    }

    it('krok 0 bez gestu nie gra sam; przycisk kroku odtwarza narrację NASTĘPNEGO kroku', async () => {
      stubFetch();
      const played = spyPlay();
      render(<CoursePlayer courseId="course-1" initial={audioCourse()} narrationEnabled />);
      expect(played).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
      await waitFor(() => expect(played).toEqual([expect.stringContaining('krok-1.mp3')]));
    });

    it('"Pomiń odprawę" (odprawa ma nagrania w krokach) odtwarza narrację kolejnego bloku', async () => {
      stubFetch();
      const played = spyPlay();
      render(<CoursePlayer courseId="course-1" initial={audioCourse()} narrationEnabled />);
      fireEvent.click(screen.getByRole('button', { name: 'Pomiń odprawę' }));
      await screen.findByText('Biuro Anny.');
      await waitFor(() => expect(played).toEqual([expect.stringContaining('biuro.mp3')]));
    });

    it('ponowne wejście w podgląd ukończonej odprawy startuje od kroku 0 bez odtwarzania (bez narracji starego kroku)', async () => {
      stubFetch();
      const played = spyPlay();
      render(
        <CoursePlayer
          courseId="course-1"
          initial={audioCourse({ currentBlockIndex: 1, progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true } }, notes: [] } })}
          narrationEnabled
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
      fireEvent.click(screen.getByRole('button', { name: 'Słucham' }));
      await waitFor(() => expect(played.at(-1)).toContain('krok-2.mp3'));
      fireEvent.click(screen.getByRole('button', { name: 'Pomiń odprawę' }));
      const before = played.length;

      fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
      expect(screen.getByRole('button', { name: 'Odbierz' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Transkrypcja' }));
      expect(within(screen.getByRole('region', { name: 'Transkrypcja narracji' })).getByText('Narracja kroku 0.')).toBeInTheDocument();
      expect(played.slice(before).filter((src) => src.includes('krok-2.mp3'))).toEqual([]);
    });
  });

  it('karta sprawy w podglądzie ukończonego kursu pokazuje ten sam stan zadań co notatnik', () => {
    stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({
          currentBlockIndex: 2,
          progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true }, biuro: { type: 'NARRATIVE', done: true } }, notes: [] },
        })}
        narrationEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    for (const cta of ['Odbierz', 'Słucham']) fireEvent.click(screen.getByRole('button', { name: cta }));
    expect(notebookTask('Zabezpiecz dowody w biurze.')).toHaveTextContent('Wykonane:');
    expect(notebookTask('Porozmawiaj z IT.')).toHaveTextContent('Do zrobienia:');
    expect(notebookTask('Cel bez completeWhen.').textContent).toBe('Cel bez completeWhen.');
  });

  it('imię nie jest pobierane w module bez odprawy', () => {
    const fetchMock = stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({ contentBlocks: [{ type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.' }] })}
        narrationEnabled={false}
        userEmail="anna.kowalska@firma.pl"
      />,
    );
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/users/me/display-name')).toBe(false);
  });

  it('maszyna do pisania: bez reduced-motion tekst pojawia się znak po znaku; z reduced-motion od razu w całości', () => {
    vi.useFakeTimers();
    stubFetch();
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    const typed = () => screen.getByTestId('briefing-block').querySelector('p[aria-hidden="true"]')!.textContent ?? '';
    expect(typed()).toBe('');
    // Jeden znak na timeout (kolejny planuje efekt po renderze), więc każdy tik we własnym act().
    for (let tick = 0; tick < 7; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(32);
      });
    }
    expect(typed()).toBe('Wtorek,');
    unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(typed()).toBe('Wtorek, 7:58. Dzwoni telefon.');
    expect(screen.getByText('Numer zastrzeżony.')).toBeInTheDocument();
  });
});

describe('tożsamość na legitymacji i zadania (funkcje czyste)', () => {
  it('displayNameFromEmail / playerIdentity / badgeNumber', () => {
    expect(displayNameFromEmail('anna.kowalska@x.pl')).toEqual({ firstName: 'Anna', lastInitial: 'K' });
    expect(displayNameFromEmail('admin@x.pl')).toEqual({ firstName: 'Admin', lastInitial: null });
    expect(playerIdentity({ firstName: 'Ewa', lastInitial: 'Ż' }, 'anna.kowalska@x.pl')).toEqual({ label: 'Ewa Ż.', initials: 'EŻ' });
    // Profil bez imienia: CAŁA tożsamość z e-maila (nie miesza imienia z profilu z inicjałem z e-maila).
    expect(playerIdentity({ firstName: null, lastInitial: 'Z' }, 'anna.kowalska@x.pl')).toEqual({ label: 'Anna K.', initials: 'AK' });
    expect(playerIdentity(null, null)).toEqual({ label: 'Detektyw', initials: 'D' });
    expect(badgeNumber('SPR-2026-0412', 'AK')).toBe('0412-AK');
    expect(badgeNumber('A-1', 'AK')).toBe('A1-AK');
    expect(badgeNumber(undefined, 'AK')).toBe('AK');
  });

  it('notebookTasks: odhaczone, gdy WSZYSTKIE bloki z completeWhen są ukończone', () => {
    expect(
      notebookTasks(objectives, { biuro: { type: 'NARRATIVE', done: true }, rozmowa: { type: 'NARRATIVE', done: false } }),
    ).toEqual([
      { text: 'Zabezpiecz dowody w biurze.', done: true },
      { text: 'Porozmawiaj z IT.', done: false },
      { text: 'Cel bez completeWhen.' },
    ]);
  });
});
