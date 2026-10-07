import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// B-137 (D-131): odrzucony zapis rozmowy na żywo (np. 400 - cisza na koncie „Bez limitów czasu”) - „Zadzwoń ponownie” w bloku zdejmuje
// komunikat o błędzie i wraca do ekranu przed połączeniem; przed kolejnym zapisem rozmowy nie da się powtórzyć.

const call: ContentBlock = {
  type: 'LIVE_CALL',
  id: 'na-zywo',
  title: 'Telefon',
  caller: { display: 'IT Helpdesk' },
  start: 'start',
  nodes: [
    {
      id: 'start',
      narration: { text: 'Wpisz w aplikacji 62.' },
      choices: [
        { id: 'oddzwonie', text: 'Oddzwonię na numer z intranetu.', next: '#koniec-a' },
        { id: 'wpisuje', text: 'Wpisuję 62.', next: '#koniec-b' },
      ],
    },
  ],
  endings: [
    { id: 'koniec-a', narration: { text: 'Paweł: nie dzwoniłem.' } },
    { id: 'koniec-b', narration: { text: 'Zatwierdziłeś jego logowanie.' } },
  ],
} as unknown as ContentBlock;

function course(): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [call, { type: 'NARRATIVE', id: 'koniec', text: 'Koniec.' }],
    progress: null,
    score: null,
  };
}

const forward = () => screen.getByRole('button', { name: 'Dalej' });

describe('CoursePlayer: rozmowa na żywo po odrzuconym zapisie (B-137)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('400 z /progress: komunikat i „Zadzwoń ponownie”; ponowienie zdejmuje komunikat i wraca do ekranu przed połączeniem', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Brak lub nieprawidłowa odpowiedź dla tego bloku' }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CoursePlayer courseId="course-1" initial={course()} contentBase="/content" narrationEnabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.queryByRole('button', { name: 'Zadzwoń ponownie' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wpisuję 62/ }));
    await waitFor(() => expect(forward()).not.toBeDisabled());
    fireEvent.click(forward());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Brak lub nieprawidłowa odpowiedź'));
    fireEvent.click(screen.getByRole('button', { name: 'Zadzwoń ponownie' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('live-call')).toHaveAttribute('data-stage', 'ring');

    // Druga rozmowa przed kolejnym zapisem - bez przycisku ponowienia.
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    expect(screen.queryByRole('button', { name: 'Zadzwoń ponownie' })).not.toBeInTheDocument();
  });
});
