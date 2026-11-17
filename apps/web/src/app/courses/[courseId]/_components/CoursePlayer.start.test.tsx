import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ModuleInfo } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const info = (over: Partial<ModuleInfo> = {}): ModuleInfo => ({
  category: 'IT_HYGIENE',
  durationMinutes: 6,
  subtitle: 'Jak przestępca szuka wejścia do sieci',
  caseNumber: 5,
  cover: { start: 'assets/m/start.1a2b3c4d.webp', end: 'assets/m/koniec.1a2b3c4d.webp', startPortrait: 'assets/m/pion.1a2b3c4d.webp', endPortrait: null },
  ...over,
});

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Najłatwiejsze drzwi',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [
      {
        id: 'one',
        type: 'QUIZ',
        prompt: 'Pytanie pierwsze',
        options: [{ text: 'A' }, { text: 'B' }],
        narration: { text: 'Narracja pierwszego bloku.', audioUrl: 'audio/one.mp3', durationMs: 3000 },
      },
      { id: 'two', type: 'QUIZ', prompt: 'Pytanie drugie', options: [{ text: 'A' }, { text: 'B' }] },
    ],
    progress: null,
    score: null,
    moduleInfo: info(),
    ...overrides,
  };
}

const BASE = 'https://cdn.example.com';

describe('CoursePlayer: ekran startu modułu (D-163)', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('nierozpoczęty kurs zaczyna od ekranu startu: numer sprawy i czas, tytuł, opis, kategoria, okładka (pozioma i pionowa), X do listy', () => {
    const { container } = render(<CoursePlayer courseId="course-1" initial={course()} contentBase={BASE} />);
    expect(screen.getByTestId('module-start')).toBeInTheDocument();
    expect(screen.getByText('Sprawa 5 · ok. 6 min')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Najłatwiejsze drzwi' })).toBeInTheDocument();
    expect(screen.getByText('Jak przestępca szuka wejścia do sieci')).toBeInTheDocument();
    expect(screen.getByTestId('module-start-category')).toHaveTextContent('Higiena IT');
    expect(screen.getByTestId('module-start-cover')).toHaveAttribute('src', `${BASE}/assets/m/start.1a2b3c4d.webp`);
    expect(container.querySelector('source')).toHaveAttribute('srcset', `${BASE}/assets/m/pion.1a2b3c4d.webp`);
    expect(screen.getByRole('link', { name: 'Zakończ i wróć do listy kursów' })).toHaveAttribute('href', '/courses');
    // Blok jeszcze niewidoczny, bez paska odtwarzacza i bez nagrania (lektor gra dopiero po geście Start).
    expect(screen.queryByText('Pytanie pierwsze')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('bez okładki - ciemne tło bez obrazu; bez numeru sprawy - sam czas; kategoria spoza listy - surowa wartość', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ moduleInfo: info({ cover: null, caseNumber: null, category: 'NOWA' }) })} contentBase={BASE} />);
    expect(screen.queryByTestId('module-start-cover')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-start')).toHaveClass('bg-[#23232A]');
    expect(screen.getByText('ok. 6 min')).toBeInTheDocument();
    expect(screen.getByTestId('module-start-category')).toHaveTextContent('NOWA');
  });

  it('Start: pierwszy blok, fokus na nagłówku bloku i lektor gra od razu (Start to gest)', async () => {
    render(<CoursePlayer courseId="course-1" initial={course()} contentBase={BASE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByTestId('module-start')).not.toBeInTheDocument();
    expect(await screen.findByText('Pytanie pierwsze')).toBeInTheDocument();
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
  });

  it('moduł zaczynający się od filmu: Start uruchamia film od razu (uwaga właściciela 2026-11-17), bez tytułu obok filmu', async () => {
    const video = { id: 'film', type: 'VIDEO', title: 'Bezpieczeństwo sieci', src: 'assets/m/film.1a2b3c4d.mp4' } as CoursePlayerInitialState['contentBlocks'][number];
    render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: [video, course().contentBlocks[1]] })} contentBase={BASE} narrationEnabled={false} />);
    expect(playSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const player = await screen.findByTestId('video-player');
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    expect(playSpy.mock.contexts.at(-1)).toBe(player);
    expect(screen.queryByText('Bezpieczeństwo sieci', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('CC na ekranie startu to to samo ustawienie co w pasku odtwarzacza (zapamiętane w przeglądarce)', () => {
    render(<CoursePlayer courseId="course-1" initial={course()} contentBase={BASE} />);
    const cc = screen.getByRole('button', { name: 'Napisy' });
    expect(cc).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cc);
    expect(window.localStorage.getItem('unfooly.narration.captions')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('button', { name: 'Napisy' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('głośnik otwiera okienko głośności, Escape je zamyka', () => {
    render(<CoursePlayer courseId="course-1" initial={course()} contentBase={BASE} />);
    fireEvent.click(screen.getByRole('button', { name: /Głośność lektora/ }));
    expect(screen.getByTestId('volume-panel')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('volume-panel')).not.toBeInTheDocument();
  });

  it('bez ekranu startu: kurs w trakcie (blok > 0), ukończony albo odpowiedź API bez danych modułu', () => {
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1 })} contentBase={BASE} />);
    expect(screen.queryByTestId('module-start')).not.toBeInTheDocument();
    expect(screen.getByText('Pytanie drugie')).toBeInTheDocument();
    unmount();
    const second = render(<CoursePlayer courseId="course-1" initial={course({ moduleInfo: undefined })} contentBase={BASE} />);
    expect(screen.queryByTestId('module-start')).not.toBeInTheDocument();
    second.unmount();
    render(<CoursePlayer courseId="course-1" initial={course({ status: 'COMPLETED', currentBlockIndex: 2 })} contentBase={BASE} />);
    expect(screen.queryByTestId('module-start')).not.toBeInTheDocument();
  });
});
