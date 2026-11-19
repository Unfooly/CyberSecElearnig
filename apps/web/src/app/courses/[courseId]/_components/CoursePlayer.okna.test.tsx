import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Wygląd okien modułu 1 (D-178): teczka z przekładkami i pieczątką, poczta w monitorze, czat w ramce telefonu, miejsca obejrzane na scenie
// (✓, nieklikalne, poza pulą wymaganych) i tło modułu za ramką odtwarzacza.

function course(blocks: ContentBlock[], overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [...blocks, { type: 'NARRATIVE', id: 'dalej', text: 'Dalej.' }],
    progress: null,
    score: null,
    ...overrides,
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS', currentBlockIndex: 1, score: null, completedAt: null, lastResult: { blockIndex: 0 }, gamification: null }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const barNext = () => screen.getByRole('button', { name: /^Dalej/ });

afterEach(() => vi.unstubAllGlobals());

describe('CoursePlayer: okna w stylu Unfooly (D-178)', () => {
  it('TABS look folder: teczka z pieczątką i kartką; zaliczenie jak dotąd (wszystkie zakładki)', async () => {
    const fetchMock = stubFetch();
    const tabs: ContentBlock = {
      type: 'TABS',
      id: 'teczka',
      look: 'folder',
      stamp: 'ŚCIŚLE TAJNE',
      tabs: [
        { id: 'zadanie', title: 'Twoje zadanie', content: 'Ustal, co się stało.' },
        { id: 'ofiara', title: 'Ofiara ataku', content: 'Paweł Nowicki.' },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([tabs])} narrationEnabled={false} />);

    expect(screen.getByTestId('folder')).toBeInTheDocument();
    expect(screen.getByTestId('folder-stamp')).toHaveTextContent('ŚCIŚLE TAJNE');
    expect(screen.getByTestId('folder-sheet')).toHaveTextContent('Ustal, co się stało.');
    expect(barNext()).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Ofiara ataku' }));
    expect(screen.getByTestId('folder-sheet')).toHaveTextContent('Paweł Nowicki.');
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      blockIndex: 0,
      blockId: 'teczka',
      answer: { opened: ['zadanie', 'ofiara'] },
    });
  });

  it('EMAIL_ANALYSIS frame monitor: mail na ekranie monitora z paskiem „Poczta”; bez kotwic - bez podpowiedzi o klikaniu fragmentów', () => {
    stubFetch();
    const mail: ContentBlock = {
      type: 'EMAIL_ANALYSIS',
      id: 'zaproszenie',
      frame: 'monitor',
      prompt: 'Jakie cechy phishingu ma ta wiadomość?',
      email: { fromName: 'Fundacja', fromAddress: 'k@fundacja.test', subject: 'Zaproszenie', body: 'Treść.', links: [] },
      criteria: [
        { id: 'c1', label: 'Błędy' },
        { id: 'c2', label: 'Atrakcyjna oferta' },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([mail])} narrationEnabled={false} />);
    const screenArea = screen.getByTestId('monitor-screen');
    expect(within(screenArea).getByTestId('mail-app-bar')).toHaveTextContent('Poczta');
    expect(within(screenArea).getByText('Atrakcyjna oferta')).toBeInTheDocument();
    expect(screen.queryByText(/Kliknij fragmenty wiadomości/)).toBeNull();
  });

  it('DOSSIER layout chat: dymki w ramce telefonu (własne po prawej, połączenie na środku); klik w dymek zaznacza wiersz jak w arkuszu', async () => {
    const fetchMock = stubFetch();
    const chat: ContentBlock = {
      type: 'DOSSIER',
      id: 'komunikator',
      title: 'Smartfon Pawła',
      documents: [
        {
          id: 'czat',
          tab: 'Komunikator',
          org: 'SMARTFON',
          title: 'Katarzyna Zielińska',
          layout: 'chat',
          self: 'Paweł',
          columns: ['Godz.', 'Kto', 'Wiadomość'],
          rows: [
            { id: 'r1', cells: ['10:12', 'Katarzyna', 'Dzień dobry!'] },
            { id: 'r2', cells: ['10:14', 'Paweł', 'Chętnie posłucham.'] },
            { id: 'r3', cells: ['10:15', '—', 'Połączenie głosowe · 12 min 40 s'], evidence: true, required: true, note: { text: 'Telefon.', kind: 'call' } },
          ],
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([chat])} narrationEnabled={false} />);
    const bubbles = within(screen.getByTestId('chat-sheet')).getAllByTestId('chat-bubble');
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0].parentElement).toHaveClass('justify-start');
    expect(bubbles[0]).toHaveTextContent('Katarzyna');
    expect(bubbles[1].parentElement).toHaveClass('justify-end');
    expect(bubbles[2].parentElement).toHaveClass('justify-center');
    expect(barNext()).toBeDisabled();
    fireEvent.click(bubbles[2]);
    expect(bubbles[2]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string).answer).toEqual({ opened: ['czat'], noted: ['r3'] });
  });

  it('SCENE_HOTSPOTS done: ✓ bez przycisku, poza pulą wymaganych - „Dalej” po samym wymaganym przedmiocie', async () => {
    stubFetch();
    const scene: ContentBlock = {
      type: 'SCENE_HOTSPOTS',
      id: 'biuro',
      image: 'img/biuro.webp',
      imageAlt: 'Biuro',
      hotspots: [
        { id: 'komputer', label: 'Komputer', x: 5, y: 5, width: 20, height: 20, done: true },
        { id: 'smartfon', label: 'Smartfon', x: 50, y: 50, width: 20, height: 20, content: 'Telefon Pawła.', required: true },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    const done = screen.getByTestId('hotspot-overlay-komputer');
    expect(done.tagName).toBe('SPAN');
    expect(done).toHaveAttribute('data-state', 'done');
    expect(screen.getByRole('img', { name: 'Komputer (obejrzane wcześniej)' })).toBeInTheDocument();
    expect(barNext()).toBeDisabled();
    fireEvent.click(screen.getByTestId('hotspot-overlay-smartfon'));
    await screen.findByText('Telefon Pawła.');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(barNext()).toBeEnabled());
  });

  it('SCENE_HOTSPOTS done + drzwi (bez flag required): drzwi aktywne od razu - „done” poza pulą (bez wykluczenia blok byłby nie do ukończenia)', () => {
    stubFetch();
    const scene: ContentBlock = {
      type: 'SCENE_HOTSPOTS',
      id: 'biuro-3',
      image: 'img/biuro.webp',
      imageAlt: 'Biuro',
      hotspots: [
        { id: 'komputer', label: 'Komputer', x: 5, y: 5, width: 20, height: 20, done: true },
        { id: 'smartfon', label: 'Smartfon', x: 50, y: 50, width: 20, height: 20, action: 'next' },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    expect(screen.getByTestId('hotspot-overlay-smartfon')).toHaveAttribute('data-state', 'ready');
  });

  it('tło modułu (cover.backdrop) za ramką; bez tła - brak elementu', () => {
    stubFetch();
    const narrative: ContentBlock = { type: 'NARRATIVE', id: 'wstep', text: 'Wstęp.' };
    const moduleInfo = {
      category: 'PHISHING_SOCIAL_ENGINEERING',
      durationMinutes: 10,
      subtitle: null,
      caseNumber: 1,
      notice: null,
      cover: { start: 'a.webp', end: 'b.webp', startPortrait: null, endPortrait: null, backdrop: 'assets/m/tlo.1.webp' },
    };
    const { unmount } = render(
      <CoursePlayer courseId="course-1" initial={course([narrative], { currentBlockIndex: 1, moduleInfo })} narrationEnabled={false} contentBase="https://content.example.test" />,
    );
    expect(screen.getByTestId('player-backdrop')).toHaveAttribute('src', 'https://content.example.test/assets/m/tlo.1.webp');
    unmount();
    render(<CoursePlayer courseId="course-1" initial={course([narrative], { currentBlockIndex: 1 })} narrationEnabled={false} />);
    expect(screen.queryByTestId('player-backdrop')).toBeNull();
  });
});
