import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Omówienie nagrania (ANNOTATED_REPLAY, D-115, security review 1b): /start wysyła je bez znaczników (withheld), pełny blok przychodzi w
// odpowiedzi /progress po dotarciu (revealedBlock) - odtwarzacz podmienia go w liście bloków.

const withheld: ContentBlock = { type: 'ANNOTATED_REPLAY', id: 'omowienie', title: 'Omówienie', withheld: true };
const revealed: ContentBlock = {
  type: 'ANNOTATED_REPLAY',
  id: 'omowienie',
  title: 'Omówienie',
  source: { kind: 'image', image: 'scenes/omowienie.svg', alt: 'Biuro z numerowanymi znacznikami' },
  markers: [
    { n: 1, anchor: { x: 20, y: 30 }, title: 'Strach', text: 'W stresie myślimy krócej.' },
    { n: 2, anchor: { x: 60, y: 40 }, title: 'Parowanie liczb', text: 'Liczbę zna tylko ten, kto się loguje.' },
  ],
};

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [{ type: 'NARRATIVE', id: 'wstep', text: 'Posłuchaj omówienia.' }, withheld],
    progress: null,
    score: null,
    ...overrides,
  };
}

const forward = () => screen.getByRole('button', { name: 'Dalej' });

describe('CoursePlayer: omówienie wstrzymane do dotarcia (revealedBlock)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('po dotarciu podmienia blok treścią z /progress: znaczniki widoczne, „Dalej” dopiero po wszystkich', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          assignmentId: 'a1',
          status: 'IN_PROGRESS',
          currentBlockIndex: 1,
          score: null,
          completedAt: null,
          lastResult: { blockIndex: 0, blockId: 'wstep', type: 'NARRATIVE' },
          revealedBlock: { blockIndex: 1, block: revealed },
          gamification: null,
        }),
      })),
    );
    render(<CoursePlayer courseId="course-1" initial={course()} contentBase="/content" />);

    await waitFor(() => expect(forward()).not.toBeDisabled());
    fireEvent.click(forward());

    await waitFor(() => expect(screen.getByTestId('replay-card')).toHaveTextContent('Znacznik 1 z 2'));
    expect(screen.queryByTestId('replay-withheld')).not.toBeInTheDocument();
    expect(forward()).toBeDisabled();
    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Parowanie liczb');
    await waitFor(() => expect(forward()).not.toBeDisabled());
  });

  it('blok wstrzymany bez ujawnienia (np. zgubiona odpowiedź) - komunikat o odświeżeniu, „Dalej” nieaktywny', () => {
    render(<CoursePlayer courseId="course-1" initial={course({ currentBlockIndex: 1 })} contentBase="/content" />);
    expect(screen.getByTestId('replay-withheld')).toHaveTextContent('Odśwież stronę');
    expect(forward()).toBeDisabled();
  });
});
