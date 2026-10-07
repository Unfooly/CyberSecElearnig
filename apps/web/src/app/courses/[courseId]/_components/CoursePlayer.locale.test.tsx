import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

// Język kursu (D-133): plakietka „Available in Polish only” (kurs bez języka gracza), przełącznik na starcie kursu z więcej niż jednym
// językiem (zapis na koncie, przeładowanie treści, fokus na nowym języku po przeładowaniu), `lang` obszaru treści i tytułu = język treści.
// Dwie kopie kontrolki: pasek górny (od 640 px, `hidden sm:flex`) i wiersz nad treścią (węziej, `sm:hidden`) - jsdom nie liczy CSS, więc
// testy biorą kopię z paska i sprawdzają klasy obu miejsc.

const block = { id: 'wstep', type: 'NARRATIVE', text: 'Treść.' } as ContentBlock;

function course(overrides: Partial<CoursePlayerInitialState>): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [block, { ...block, id: 'dalej' }],
    progress: null,
    score: null,
    ...overrides,
  };
}

const bar = () => screen.getByTestId('course-language');

describe('CoursePlayer: język kursu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockClear();
    window.sessionStorage.clear();
  });

  it('kurs locales [pl] dla gracza EN: treść PL z plakietką „Available in Polish only” (pasek i wiersz na telefonie), bez przełącznika', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'pl', locales: ['pl'], localeFallback: true })} narrationEnabled={false} />);
    expect(screen.getByTestId('polish-only-badge')).toHaveTextContent('Available in Polish only');
    expect(screen.getByTestId('polish-only-badge-row')).toHaveTextContent('Available in Polish only');
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'pl');
    expect(screen.queryByTestId('course-language')).not.toBeInTheDocument();
  });

  it('miejsca kontrolki: kopia w pasku górnym od 640 px, kopia nad treścią węziej (polski interfejs, na całą szerokość)', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'en', locales: ['pl', 'en'] })} narrationEnabled={false} />);
    expect(bar().closest('.player-topbar')).not.toBeNull();
    expect(bar().closest('.hidden')).toHaveClass('sm:flex');
    const row = screen.getByTestId('course-language-place-row');
    expect(row).toHaveClass('sm:hidden', 'w-full');
    expect(row).toHaveAttribute('lang', 'pl');
    expect(screen.getByTestId('player-content-area')).toContainElement(screen.getByTestId('course-language-row'));
  });

  it('kurs dwujęzyczny na starcie: przełącznik zapisuje język na koncie i przeładowuje treść; lang obszaru treści i tytułu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'en', locales: ['pl', 'en'], localeFallback: false })} narrationEnabled={false} />);
    // Język treści tylko na treści bloku i tytule - paski ramki to polski interfejs (WCAG 3.1.2).
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('heading', { name: 'Sprawa' })).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('main')).not.toHaveAttribute('lang');
    expect(screen.queryByTestId('polish-only-badge')).not.toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    // Bieżący język - bez zapisu.
    fireEvent.click(within(bar()).getByRole('button', { name: 'English' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Polski' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/preferences', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ contentLocale: 'pl' }) }));
    expect(window.sessionStorage.getItem('course-language-focus')).toBe('pl');
  });

  // jsdom nie liczy układu - widoczność kopii (getClientRects) podstawiona: pasek ukryty (telefon), wiersz nad treścią widoczny.
  function onlyRowVisible() {
    return vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      return (this.closest('[data-testid="course-language-row"]') ? [{}] : []) as unknown as DOMRectList;
    });
  }

  it('po przeładowaniu w nowym języku: fokus na przycisku nowego języka w WIDOCZNEJ kopii (wiersz na telefonie), znacznik zdjęty', () => {
    window.sessionStorage.setItem('course-language-focus', 'pl');
    onlyRowVisible();
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'pl', locales: ['pl', 'en'] })} narrationEnabled={false} />);
    expect(within(screen.getByTestId('course-language-row')).getByRole('button', { name: 'Polski' })).toHaveFocus();
    expect(window.sessionStorage.getItem('course-language-focus')).toBeNull();
  });

  it('znacznik innego języka niż bieżący - fokus się nie przesuwa, znacznik zostaje', () => {
    window.sessionStorage.setItem('course-language-focus', 'en');
    onlyRowVisible();
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'pl', locales: ['pl', 'en'] })} narrationEnabled={false} />);
    expect(document.body).toHaveFocus();
    expect(window.sessionStorage.getItem('course-language-focus')).toBe('en');
  });

  it('plakietka na telefonie tylko na starcie kursu (wiersz nad treścią), w pasku - na każdym bloku', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1, locale: 'pl', locales: ['pl'], localeFallback: true })} narrationEnabled={false} />);
    expect(screen.getByTestId('polish-only-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('polish-only-badge-row')).not.toBeInTheDocument();
  });

  it('błąd zapisu języka - widoczny komunikat (alert), przełącznik zostaje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'en', locales: ['pl', 'en'] })} narrationEnabled={false} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Polski' }));
    await waitFor(() => expect(within(bar().parentElement!).getByRole('alert')).toHaveTextContent('Nie udało się zmienić języka.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('kurs dwujęzyczny w trakcie (nie pierwszy blok): bez przełącznika - język nie zmienia się w połowie kursu', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1, locale: 'en', locales: ['pl', 'en'] })} narrationEnabled={false} />);
    expect(screen.queryByTestId('course-language')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-language-place-row')).not.toBeInTheDocument();
  });

  it('starsza odpowiedź /start bez pól języka: lang="pl", bez plakietki i przełącznika', () => {
    render(<CoursePlayer courseId="course-1" initial={course({})} narrationEnabled={false} />);
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'pl');
    expect(screen.queryByTestId('polish-only-badge')).not.toBeInTheDocument();
  });
});
