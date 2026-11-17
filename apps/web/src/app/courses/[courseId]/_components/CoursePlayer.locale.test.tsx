import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Język kursu (D-133) w odtwarzaczu: `lang` obszaru treści i tytułu = język treści (z konta i przeglądarki - liczy API). Od D-162 (decyzja
// właściciela) bez plakietki „Available in Polish only” i bez przełącznika „Polski / English” na starcie kursu.

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

describe('CoursePlayer: język kursu', () => {
  afterEach(() => vi.restoreAllMocks());

  it('kurs dwujęzyczny na starcie: lang obszaru treści i tytułu = język treści, paski po polsku; bez przełącznika języka (D-162)', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'en', locales: ['pl', 'en'], localeFallback: false })} narrationEnabled={false} />);
    // Język treści tylko na treści bloku i tytule - paski ramki to polski interfejs (WCAG 3.1.2).
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('heading', { name: 'Sprawa' })).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('main')).not.toHaveAttribute('lang');
    expect(screen.queryByRole('button', { name: 'English' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Polski' })).not.toBeInTheDocument();
  });

  it('kurs bez języka gracza (localeFallback): treść PL, bez plakietki „Available in Polish only” (D-162)', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ locale: 'pl', locales: ['pl'], localeFallback: true })} narrationEnabled={false} />);
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'pl');
    expect(screen.queryByText('Available in Polish only')).not.toBeInTheDocument();
  });

  it('starsza odpowiedź /start bez pól języka: lang="pl"', () => {
    render(<CoursePlayer courseId="course-1" initial={course({})} narrationEnabled={false} />);
    expect(screen.getByTestId('player-content-area')).toHaveAttribute('lang', 'pl');
  });
});
