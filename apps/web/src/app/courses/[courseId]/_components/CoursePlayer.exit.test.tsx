import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

// Wyjście X i powrót do kursu (D-142): zapis bloku albo stanu sceny w toku nie może zostać za wyjściem - inaczej lista kursów i
// „Kontynuuj naukę” pobiorą postęp sprzed ostatniego zapisu. Bez zapisów w toku X jest zwykłym linkiem (nawigacja Next, nowa karta
// z modyfikatorem). Odtwarzacz przywrócony „Wstecz” przeglądarki pobiera świeży postęp (router.refresh).

const block = { id: 'wstep', type: 'NARRATIVE', text: 'Treść.' } as ContentBlock;
const scene = {
  type: 'SCENE_HOTSPOTS',
  id: 'scena',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [{ id: 'h1', label: 'Monitor', x: 10, y: 10, width: 20, height: 20, content: 'Kartka z hasłem.', required: true }],
} as unknown as ContentBlock;

function course(blocks: ContentBlock[] = [block, { ...block, id: 'dalej' }, { ...block, id: 'koniec' }]): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: blocks,
    progress: null,
    score: null,
  };
}

const saved = {
  ok: true,
  status: 200,
  json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS', currentBlockIndex: 1, score: null, completedAt: null, lastResult: { blockIndex: 0, blockId: 'wstep', type: 'NARRATIVE' }, gamification: null }),
};
const exitLink = () => screen.getByRole('link', { name: 'Zakończ i wróć do listy kursów' });
const next = () => within(screen.getByTestId('player-bottombar')).getByRole('button', { name: /^Dalej$/ });

// Zwykły link w jsdom: nawigacja niezaimplementowana (szum na stderr) - po asercji wyniku kliknięcia zatrzymujemy domyślną akcję.
const swallowNavigation = (event: Event) => event.preventDefault();

describe('CoursePlayer: wyjście X przy zapisie w toku (D-142)', () => {
  beforeEach(() => document.addEventListener('click', swallowNavigation));
  afterEach(() => {
    document.removeEventListener('click', swallowNavigation);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    push.mockClear();
    refresh.mockClear();
  });

  // fireEvent.click zwraca false, gdy ktoś wywołał preventDefault - tu: CoursePlayer (wstrzymane wyjście), nie swallowNavigation
  // (ta działa na document, po handlerze Reacta, ale też ustawia defaultPrevented - dlatego „zwykły link” sprawdzamy brakiem push
  // i aria-busy, a wstrzymanie - wywołaniem push dopiero po zapisie).
  it('bez zapisu w toku X to zwykły link do /courses: bez push i bez stanu czekania', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(exitLink()).toHaveAttribute('href', '/courses');
    fireEvent.click(exitLink());
    expect(push).not.toHaveBeenCalled();
    expect(exitLink()).not.toHaveAttribute('aria-busy');
  });

  it('X podczas udanego zapisu „Dalej”: czeka (aria-busy, drugie kliknięcie nic nie dokłada), po odpowiedzi /progress - jedno przejście do /courses', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    fireEvent.click(exitLink());
    await act(async () => {});
    expect(push).not.toHaveBeenCalled();
    expect(exitLink()).toHaveAttribute('aria-busy', 'true');
    await act(async () => finish(saved));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/courses');
    expect(screen.queryByText('Nie udało się połączyć z serwerem. Spróbuj ponownie.')).not.toBeInTheDocument();
  });

  it('zapis zakończony błędem (500) też zwalnia wyjście', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    await act(async () => finish({ ok: false, status: 500, json: async () => ({}) }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/courses'));
  });

  it('wygasła sesja (401) w trakcie czekania: tylko przejście do logowania, bez /courses', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    await act(async () => finish({ ok: false, status: 401, json: async () => ({}) }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    await act(async () => {});
    expect(push).not.toHaveBeenCalledWith('/courses');
  });

  it('zapis, który nie odpowiada: wyjście po limicie (5 s), nie wisi', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    await act(async () => vi.advanceTimersByTime(4900));
    expect(push).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(200));
    expect(push).toHaveBeenCalledWith('/courses');
  });

  it('nawigacja po wyjściu się nie odbyła: X odblokowuje się po limicie (nie zostaje zablokowany na stałe)', async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    await act(async () => finish(saved));
    expect(push).toHaveBeenCalledTimes(1);
    expect(exitLink()).toHaveAttribute('aria-busy', 'true');
    await act(async () => vi.advanceTimersByTime(5000));
    expect(exitLink()).not.toHaveAttribute('aria-busy');
  });

  it('X przy samym zapisie stanu sceny (/explore) w toku: czeka na niego, potem /courses', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    render(<CoursePlayer courseId="course-1" initial={course([scene, block])} narrationEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/courses/course-1/blocks/scena/explore', expect.anything()));
    fireEvent.click(exitLink());
    await act(async () => {});
    expect(push).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, status: 200, json: async () => ({}) }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/courses'));
  });

  it('kliknięcie X z modyfikatorem (nowa karta) nie jest wstrzymywane nawet przy zapisie w toku', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink(), { ctrlKey: true });
    await act(async () => {});
    expect(push).not.toHaveBeenCalled();
    expect(exitLink()).not.toHaveAttribute('aria-busy');
  });

  it('odmontowanie w trakcie czekania (gracz poszedł gdzie indziej): bez późnego przejścia do /courses', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    const { unmount } = render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    fireEvent.click(exitLink());
    unmount();
    await act(async () => finish(saved));
    await act(async () => {});
    expect(push).not.toHaveBeenCalled();
  });
});

describe('CoursePlayer: powrót „Wstecz” przeglądarki (D-142)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  it('odtwarzacz zamontowany po popstate (przywrócony z pamięci routera) pobiera świeży postęp - także po długim montażu, raz', () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    window.dispatchEvent(new PopStateEvent('popstate'));
    // Flaga, nie okno czasowe: ciężki blok na słabym telefonie montuje się dłużej niż sekundę.
    vi.advanceTimersByTime(3000);
    const first = render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    first.unmount();
    // Flaga zużyta: kolejne zwykłe wejście bez odświeżenia.
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('zwykłe wejście (bez popstate) - bez dodatkowego odświeżenia', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('400 z /progress (nieaktualny postęp, „Bloki trzeba ukończyć po kolei”): komunikat i świeży postęp z serwera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Bloki trzeba ukończyć po kolei' }) })));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    fireEvent.click(next());
    expect(await screen.findByText('Bloki trzeba ukończyć po kolei')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
