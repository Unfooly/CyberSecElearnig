import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('CoursePlayer: śledztwo (dowody, maskotka)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sceneCourse = (overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState =>
    course({
      contentBlocks: [
        {
          type: 'SCENE_HOTSPOTS',
          id: 'scena',
          title: 'Biuro',
          image: 'scenes/office.png',
          imageAlt: 'Biuro',
          hotspots: [
            {
              id: 'h1',
              label: 'Monitor',
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              content: 'Kartka z hasłem.',
              required: true,
              evidence: true,
              note: { text: 'Hasło na kartce.', kind: 'item' },
            },
          ],
        },
        { type: 'QUIZ', id: 'quiz1', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] },
      ],
      progress: { v: 2, blocks: {}, notes: [], evidence: { collected: 0, total: 1, perBlock: [{ blockId: 'scena', collected: 0, total: 1 }] } },
      ...overrides,
    });

  it('licznik startuje z serwera, dowód z hotspotu podbija go od razu, maskotka się cieszy, odpowiedź niesie noted, a po zapisie liczby są z serwera', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: 'scena', type: 'SCENE_HOTSPOTS', points: 1 },
        evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
        gamification: null,
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={sceneCourse()} narrationEnabled={false} />);

    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/1');
    // Domyślna poza spoczynkowa dla scen z punktami.
    expect(screen.getByAltText('Maskotka Unfooly wskazuje')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('list', { name: 'Elementy sceny' })).getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
    expect(screen.getByAltText('Maskotka Unfooly się cieszy')).toBeInTheDocument();
    expect(screen.getByText('Mamy dowód! Trafił do notatnika.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notatnik \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockIndex: 0, answer: { visited: ['h1'], noted: ['h1'] } });

    await screen.findByText('Blok ukończony.');
    // Liczby z serwera (1/1), bez podwójnego liczenia dowodu lokalnego.
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
  });

  it('Wstecz z niezapisanego bloku i powrót: stan bloku (odwiedzone, noted) przeżywa, licznik i notatnik zgadzają się z tym, co poleci na serwer', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 2,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 1, blockId: 'scena', type: 'SCENE_HOTSPOTS', points: 1 },
        evidence: { collected: 1, total: 1, perBlock: [{ blockId: 'scena', collected: 1, total: 1 }] },
        gamification: null,
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const base = sceneCourse();
    const quiz = { type: 'QUIZ' as const, id: 'quiz0', prompt: 'Wcześniejsze pytanie', options: [{ text: 'A' }, { text: 'B' }] };
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={sceneCourse({
          currentBlockIndex: 1,
          contentBlocks: [quiz, base.contentBlocks[0], base.contentBlocks[1], base.contentBlocks[1]],
          progress: {
            v: 2,
            blocks: { quiz0: { type: 'QUIZ', done: true, correct: true, points: 1 } },
            notes: [],
            evidence: { collected: 0, total: 1, perBlock: [{ blockId: 'scena', collected: 0, total: 1 }] },
          },
        })}
      />,
    );

    fireEvent.click(within(screen.getByRole('list', { name: 'Elementy sceny' })).getByRole('button', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');

    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Elementy sceny' })).not.toBeInTheDocument(); // ukryty blok jest poza drzewem dostępności
    fireEvent.click(screen.getByRole('button', { name: /^Dalej$/ }));

    // Ten sam blok, ten sam stan: "Dodano do notatnika", wszystko obejrzane, licznik bez zmian.
    expect(screen.getByText('Dodano do notatnika')).toBeInTheDocument();
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/1');
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ blockIndex: 1, answer: { visited: ['h1'], noted: ['h1'] } });
  });

  it('autor może nadpisać pozę spoczynkową w treści (block.mascot wygrywa z domyślną dla typu)', () => {
    const base = sceneCourse();
    const blocks = [{ ...base.contentBlocks[0], mascot: { pose: 'thinking', text: 'Rozejrzyj się.' } }, base.contentBlocks[1]];
    render(<CoursePlayer courseId="course-1" initial={sceneCourse({ contentBlocks: blocks })} narrationEnabled={false} />);
    expect(screen.getByAltText('Maskotka Unfooly się zastanawia')).toBeInTheDocument();
    expect(screen.queryByAltText('Maskotka Unfooly wskazuje')).not.toBeInTheDocument();
    expect(screen.getByText('Rozejrzyj się.')).toBeInTheDocument();
  });

  it('bez dowodów w module licznik się nie pokazuje', () => {
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(screen.queryByTestId('evidence-counter')).not.toBeInTheDocument();
  });
});

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
