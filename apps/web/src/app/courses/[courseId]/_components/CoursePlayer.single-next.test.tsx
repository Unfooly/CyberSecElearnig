import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Jeden „Dalej” (D-106) w KAŻDYM typie bloku (także spoza modułu 1): w obszarze bloku nie ma przycisku nawigacji dalej, w pasku jest
// dokładnie jeden; VIDEO / DRAG_AND_DROP / EMBEDDED_HTML - akcja w bloku zgłasza gotowość, a zapis rusza dopiero „Dalej” w pasku.
const IN_BLOCK_NEXT = /^(Dalej|Kontynuuj|Przejdź dalej|Zakończ scenę|Sprawdź i dalej|Zakończ sprawę|Zakończ szkolenie|Wróć do biblioteki|Wchodzę)$/;

const next: ContentBlock = { type: 'NARRATIVE', id: 'dalej', text: 'Kolejny blok.' };

function course(block: ContentBlock): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [block, next],
    progress: null,
    score: null,
  };
}

function stubProgress(block: ContentBlock) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      assignmentId: 'a1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 1,
      score: null,
      completedAt: null,
      lastResult: { blockIndex: 0, blockId: block.id, type: block.type },
      gamification: null,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bar = () => screen.getByTestId('player-bottombar');
const barNext = () => within(bar()).getByRole('button', { name: /^Dalej$/ });
const inBlockNext = () =>
  within(screen.getByTestId('player-content-area'))
    .queryAllByRole('button')
    .concat(within(screen.getByTestId('player-content-area')).queryAllByRole('link'))
    .filter((el) => IN_BLOCK_NEXT.test((el.getAttribute('aria-label') || el.textContent || '').trim()));

const video: ContentBlock = { type: 'VIDEO', id: 'wideo', url: 'https://example.test/video.mp4' };
const dnd: ContentBlock = { type: 'DRAG_AND_DROP', id: 'segreguj', prompt: 'Posegreguj', items: [{ text: 'a@bank.pl' }, { text: 'b@nagroda.biz' }] };
const embed: ContentBlock = { type: 'EMBEDDED_HTML', id: 'gra' };

describe('CoursePlayer: jeden „Dalej” w każdym typie bloku (D-106)', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const blocks: ContentBlock[] = [
    video,
    dnd,
    embed,
    { type: 'QUIZ', id: 'quiz', prompt: 'Pytanie?', options: [{ text: 'A' }, { text: 'B' }] },
    { type: 'BRANCHING_SCENARIO', id: 'wybor', prompt: 'Co robisz?', options: [{ text: 'Klikam' }, { text: 'Sprawdzam' }] },
    { type: 'TABS', id: 'zakladki', title: 'Zasady', tabs: [{ id: 'x', title: 'Hasła', content: 'Długie hasła.' }] },
    { type: 'NOTEPAD', id: 'notatnik', prompt: 'Zapisz wnioski' },
    { type: 'NARRATIVE', id: 'narracja', text: 'Opowieść.' },
    { type: 'SUMMARY', id: 'podsumowanie', text: 'Koniec.' },
  ];
  it.each(blocks.map((block) => [block.type, block] as const))('%s: brak przycisku dalej w bloku, dokładnie jeden w pasku', (_type, block) => {
    stubProgress(block);
    render(<CoursePlayer courseId="course-1" initial={course(block)} narrationEnabled={false} />);
    expect(inBlockNext()).toEqual([]);
    expect(bar().querySelectorAll('.pbar-next')).toHaveLength(1);
  });

  it('B-126: ostatni krok odprawy ze sceną, której obraz się nie wczytał - gotowy od razu (bez akcji na przedmiocie), bez cta w bloku', async () => {
    const briefing = {
      type: 'BRIEFING',
      id: 'odprawa',
      steps: [{ kind: 'badge', image: 'scenes/legitymacja.svg', hotspot: { id: 'legitymacja', x: 30, y: 30, w: 40, h: 40 }, cta: 'Zabierz legitymację' }],
    } as unknown as ContentBlock;
    stubProgress(briefing);
    render(<CoursePlayer courseId="course-1" initial={course(briefing)} contentBase="/content" narrationEnabled={false} />);

    // Obraz jest: przedmiot na scenie jest akcją - „Dalej” czeka na nią.
    expect(barNext()).toBeDisabled();
    const image = screen.getByTestId('player-content-area').querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    // Obraz się nie wczytał: przedmiot to pusty prostokąt, więc odprawa jest gotowa od razu, a jedyne przejście to „Dalej” w pasku.
    await waitFor(() => expect(barNext()).toBeEnabled());
    expect(inBlockNext()).toEqual([]);
  });

  it('VIDEO: po obejrzeniu „Dalej” w pasku aktywny i zapisuje blok bez odpowiedzi', async () => {
    const fetchMock = stubProgress(video);
    render(<CoursePlayer courseId="course-1" initial={course(video)} narrationEnabled={false} />);
    expect(barNext()).toBeDisabled();
    fireEvent.ended(document.querySelector('video')!);
    expect(barNext()).toBeEnabled();
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/progress', expect.objectContaining({ body: JSON.stringify({ blockIndex: 0 }) })));
    // Blok bez oceny (D-129): bez pustego ekranu „Blok ukończony.” - od razu kolejny blok, bez przycisku dalej w bloku.
    await screen.findByText('Kolejny blok.');
    expect(screen.queryByText('Blok ukończony.')).not.toBeInTheDocument();
    expect(inBlockNext()).toEqual([]);
  });

  it.each([
    // Odpowiedź API dla przesłuchania bez sprzeczności (waga 0): rozstrzygnięcie z pustą listą kłamstw, bez punktów.
    ['przesłuchanie bez sprzeczności (waga 0) - od razu dalej', { type: 'INTERROGATION', detail: { contradictions: [] } }, null],
    ['blok bez oceny i bez rozstrzygnięcia (np. VIDEO) - od razu dalej', { type: 'VIDEO' }, null],
    // Przesłuchanie ze sprzecznościami i wagą 0: bez punktów, ale z rozstrzygnięciem (kłamstwa) - ekran wyniku zostaje (tu: blok w
    // atrapie to VIDEO, więc ogólny panel wyniku).
    [
      'przesłuchanie ze sprzecznościami bez wagi - ekran wyniku zostaje',
      { type: 'INTERROGATION', detail: { contradictions: [{ lineId: 'k1', line: { text: 'Przyznaję.' } }] } },
      'Blok ukończony.',
    ],
    ['wynik z oceną - ekran wyniku zostaje', { type: 'QUIZ', correct: true, points: 1 }, 'Poprawna odpowiedź!'],
    ['bez oceny, ale z komentarzem z treści - ekran wyniku zostaje', { type: 'QUIZ', reaction: { text: 'Dobrze wiedzieć.' } }, 'Dobrze wiedzieć.'],
  ])('D-129: pusty ekran wyniku pominięty (%s)', async (_name, lastResult, shown) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assignmentId: 'a1',
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        score: null,
        completedAt: null,
        lastResult: { blockIndex: 0, blockId: video.id, ...lastResult },
        gamification: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course(video)} narrationEnabled={false} />);
    fireEvent.ended(document.querySelector('video')!);
    fireEvent.click(barNext());
    if (shown === null) {
      await screen.findByText('Kolejny blok.');
      expect(screen.queryByText('Blok ukończony.')).not.toBeInTheDocument();
    } else {
      await screen.findByText(shown);
      expect(screen.queryByText('Kolejny blok.')).not.toBeInTheDocument();
    }
  });

  it('DRAG_AND_DROP: „Dalej” aktywny dopiero po posegregowaniu wszystkiego', async () => {
    const fetchMock = stubProgress(dnd);
    render(<CoursePlayer courseId="course-1" initial={course(dnd)} narrationEnabled={false} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Bezpieczne' })[0]);
    expect(barNext()).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Phishing' })[1]);
    expect(barNext()).toBeEnabled();
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/progress', expect.objectContaining({ body: JSON.stringify({ blockIndex: 0 }) })));
  });

  it('EMBEDDED_HTML: „Ukończyłem” aktywuje „Dalej”, odznaczenie je wyłącza; zapis dopiero po „Dalej”', async () => {
    const fetchMock = stubProgress(embed);
    render(<CoursePlayer courseId="course-1" initial={course(embed)} narrationEnabled={false} />);
    const finished = screen.getByRole('button', { name: 'Ukończyłem' });
    expect(barNext()).toBeDisabled();
    fireEvent.click(finished);
    expect(barNext()).toBeEnabled();
    fireEvent.click(finished);
    expect(barNext()).toBeDisabled();
    fireEvent.click(finished);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/course-1/progress', expect.objectContaining({ body: JSON.stringify({ blockIndex: 0 }) })));
  });
});
