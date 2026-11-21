import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Piąta runda poprawek właściciela modułu 1 (D-190, 2026-11-21): pytanie Tak/Nie o link pokazuje się po zadaniu z domeną w tym samym
// widoku co fałszywa strona - i wynik pytania też na niej zostaje.

const look = {
  frame: 'monitor' as const,
  markUrl: 'https://fundacja.przyklad-online.net/rejestracja/1',
  background: 'assets/m/pulpit.1.webp',
  backgroundScreen: { x: 17.64, y: 18.96, width: 65.08, height: 51.3 },
  page: { tabTitle: 'Formularz prelegenta', brand: 'Fundacja', heading: 'Rejestracja', fields: ['E-mail', 'Hasło'], button: 'Zarejestruj się' },
};
const quiz: ContentBlock = { type: 'QUIZ', id: 'zaufanie', prompt: 'Czy link jest godny zaufania?', options: [{ text: 'Tak' }, { text: 'Nie' }], ...look };

function course(blocks: ContentBlock[]): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [...blocks, { type: 'NARRATIVE', id: 'dalej', text: 'Dalej.' }],
    progress: null,
    score: null,
  };
}

function stubFetch(correct: boolean) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      assignmentId: 'a1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 1,
      score: null,
      completedAt: null,
      lastResult: { blockIndex: 0, blockId: 'zaufanie', type: 'QUIZ', correct, points: correct ? 1 : 0, reaction: { text: 'Komentarz z treści.' } },
      gamification: null,
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('CoursePlayer: poprawki modułu 1, runda 5 (D-190)', () => {
  it('pytanie na fałszywej stronie: okno przeglądarki na pulpicie jak w zadaniu z domeną, odpowiedź w miejscu „Dalej”', async () => {
    const fetchMock = stubFetch(true);
    render(<CoursePlayer courseId="course-1" initial={course([quiz])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const stage = screen.getByTestId('desktop-stage');
    expect(stage.style.getPropertyValue('--screen-left')).toBe('17.64%');
    expect(within(stage).getByTestId('address-domain')).toHaveTextContent('przyklad-online.net');
    expect(within(screen.getByTestId('page-task')).getByText('Czy link jest godny zaufania?')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Wybierz odpowiedź/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Wybierz odpowiedź/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Nie' }));
    fireEvent.click(screen.getByRole('button', { name: /^Wybierz odpowiedź/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string).answer).toBe(1);
  });

  it('wynik zostaje na tej samej stronie (bez osobnego slajdu): wybrana odpowiedź, werdykt, komentarz; w pasku „Dalej”', async () => {
    stubFetch(false);
    render(<CoursePlayer courseId="course-1" initial={course([quiz])} narrationEnabled={false} contentBase="https://content.example.test" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Tak' }));
    fireEvent.click(screen.getByRole('button', { name: /^Wybierz odpowiedź/ }));
    const result = within(await screen.findByTestId('page-quiz-result'));
    expect(result.getByText('Niepoprawna odpowiedź.')).toBeInTheDocument();
    expect(result.getByText('Komentarz z treści.')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-stage')).toContainElement(screen.getByTestId('browser-window'));
    expect(screen.getByRole('radio', { name: 'Tak' })).toBeChecked();
    expect(await screen.findByRole('button', { name: /^Dalej/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Wybierz odpowiedź/ })).toBeNull();
  });

  it('teczka: zdjęcie przypięte do kartki zakładki ze zdjęciem (D-191) - z opisem, tylko na tej zakładce', () => {
    stubFetch(true);
    const tabs: ContentBlock = {
      type: 'TABS',
      id: 'teczka',
      look: 'folder',
      background: 'assets/m/biurko.1.webp',
      tabs: [
        { id: 'zadanie', title: 'Twoje zadanie', content: 'Ustal, co się stało.' },
        { id: 'ofiara', title: 'Ofiara ataku', content: 'Paweł Nowicki.', photo: 'assets/m/images/pawel.1.webp', photoAlt: 'Zdjęcie Pawła Nowickiego.' },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([tabs])} narrationEnabled={false} contentBase="https://content.example.test" />);
    expect(screen.queryByTestId('folder-photo')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Ofiara ataku/ }));
    const photo = within(screen.getByTestId('folder-sheet')).getByRole('img', { name: 'Zdjęcie Pawła Nowickiego.' });
    expect(photo).toHaveAttribute('src', 'https://content.example.test/assets/m/images/pawel.1.webp');
    expect(screen.getByTestId('folder-photo')).toContainElement(photo);
    fireEvent.click(screen.getByRole('tab', { name: /Twoje zadanie/ }));
    expect(screen.queryByTestId('folder-photo')).toBeNull();
  });

  it('zwykły quiz (bez oprawy) zostaje jak dotąd - bez okna przeglądarki', () => {
    stubFetch(true);
    const plain: ContentBlock = { type: 'QUIZ', id: 'zaufanie', prompt: 'Czy link jest godny zaufania?', options: [{ text: 'Tak' }, { text: 'Nie' }] };
    render(<CoursePlayer courseId="course-1" initial={course([plain])} narrationEnabled={false} />);
    expect(screen.queryByTestId('desktop-stage')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Nie' })).toBeInTheDocument();
  });
});
