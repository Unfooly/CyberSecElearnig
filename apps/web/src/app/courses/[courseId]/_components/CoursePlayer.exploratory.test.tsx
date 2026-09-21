import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [
      {
        type: 'TABS',
        id: 'tabs1',
        title: 'Zasady',
        tabs: [
          { id: 'x', title: 'Hasła', content: 'Długie hasła.' },
          { id: 'y', title: 'Maile', content: 'Sprawdzaj linki.' },
        ],
      },
      { type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] },
    ],
    progress: null,
    score: null,
    ...overrides,
  };
}

const progressResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    assignmentId: 'a1',
    status: 'IN_PROGRESS',
    currentBlockIndex: 1,
    score: null,
    completedAt: null,
    lastResult: { blockIndex: 0, blockId: 'tabs1', type: 'TABS', points: 1 },
    gamification: null,
  }),
};

describe('CoursePlayer: bloki eksploracyjne', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wysyła { opened } dla bloku TABS, a po "Dalej" i "Wstecz" można przejść blok ponownie bez żadnego zapisu na serwerze', async () => {
    const fetchMock = vi.fn().mockResolvedValue(progressResponse);
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Maile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/courses/course-1/progress');
    expect(JSON.parse(init.body)).toEqual({ blockIndex: 0, answer: { opened: ['x', 'y'] } });

    // Wynik bloku, "Dalej" (pierwszy w DOM: pod wynikiem), następnie "Wstecz" do podglądu.
    await screen.findByText('Blok ukończony.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dalej' })[0]);
    expect(await screen.findByText('Pytanie?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Maile' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Sprawdzaj linki.');
    expect(screen.queryByRole('button', { name: 'Kontynuuj' })).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
