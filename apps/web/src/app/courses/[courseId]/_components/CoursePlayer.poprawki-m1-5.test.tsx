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

  it('komunikator: fragment wiadomości oznaczony jako link (D-192) jest wyróżniony w dymku - bez adresu, klik zaznacza cały dymek', () => {
    stubFetch(true);
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
            { id: 'r2', cells: ['10:29', 'Katarzyna', 'Prosimy przez ten formularz: Rejestracja'], link: 'Rejestracja', evidence: true, required: true, note: { text: 'Link.', kind: 'web' } },
          ],
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([chat])} narrationEnabled={false} />);
    const bubbles = within(screen.getByTestId('chat-sheet')).getAllByTestId('chat-bubble');
    expect(within(bubbles[0]).queryByTestId('chat-link')).toBeNull();
    const link = within(bubbles[1]).getByTestId('chat-link');
    expect(link).toHaveTextContent('Rejestracja');
    expect(link.tagName).toBe('SPAN');
    expect(bubbles[1].querySelector('a')).toBeNull();
    expect(bubbles[1]).toHaveTextContent('Prosimy przez ten formularz: Rejestracja');
    fireEvent.click(link);
    expect(bubbles[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('teczka: poziome zdjęcie dostaje szerszą ramkę po wczytaniu, pionowe zostaje wąskie (D-196)', () => {
    stubFetch(true);
    const tabs: ContentBlock = {
      type: 'TABS',
      id: 'teczka',
      look: 'folder',
      background: 'assets/m/biurko.1.webp',
      tabs: [{ id: 'incydent', title: 'Incydent', content: 'Raport.', photo: 'assets/m/images/monitor.1.webp', photoAlt: 'Monitor.' }],
    };
    render(<CoursePlayer courseId="course-1" initial={course([tabs])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const figure = screen.getByTestId('folder-photo');
    const img = within(figure).getByRole('img', { name: 'Monitor.' }) as HTMLImageElement;
    expect(figure).not.toHaveAttribute('data-wide');
    Object.defineProperty(img, 'naturalWidth', { value: 560, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 411, configurable: true });
    fireEvent.load(img);
    expect(screen.getByTestId('folder-photo')).toHaveAttribute('data-wide', 'true');
    // Pionowe (480x600) po wczytaniu zostaje w wąskiej ramce.
    Object.defineProperty(img, 'naturalWidth', { value: 480, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    fireEvent.load(img);
    expect(screen.getByTestId('folder-photo')).not.toHaveAttribute('data-wide');
  });

  it('gazeta: strona sięga do dołu obszaru kursu - bez dolnego marginesu zbliżenia i pustego paska pod spodem (D-195)', async () => {
    stubFetch(true);
    const scene: ContentBlock = {
      type: 'SCENE_HOTSPOTS',
      id: 'gazeta',
      image: 'assets/m/gazeta.1.webp',
      imageAlt: 'Gazeta na biurku.',
      hotspots: [
        {
          id: 'artykul',
          label: 'Gazeta',
          x: 20,
          y: 20,
          width: 30,
          height: 60,
          required: true,
          content: 'Artykuł.',
          media: { kind: 'document', look: 'newspaper', masthead: 'Kurier Cyfrowy', title: 'Hakerzy', lines: ['Lead.', 'Akapit pierwszy.', 'Akapit drugi.'] },
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} contentBase="https://content.example.test" />);
    fireEvent.click(screen.getByRole('button', { name: /Gazeta/ }));
    const page = await screen.findByTestId('newspaper-page');
    expect(page).toHaveTextContent('Akapit drugi.');
    expect(screen.getByTestId('scene-zoom-graphic').className).toContain('-mb-3');
    expect(screen.getByTestId('scene-zoom-actions')).not.toBeVisible();
    // Dół strony bez zaokrągleń - kartka wychodzi poza kadr.
    expect(page.className).toContain('rounded-t-card');
    expect(page.className).not.toMatch(/(^|\s)rounded-card(\s|$)/);
  });

  it('pytanie na fałszywej stronie: odpowiedzi węższe niż okno (D-197) - limit szerokości na szerokim ekranie', () => {
    stubFetch(true);
    render(<CoursePlayer courseId="course-1" initial={course([quiz])} narrationEnabled={false} contentBase="https://content.example.test" />);
    for (const option of screen.getAllByTestId('page-quiz-option')) {
      // classList, nie podciąg - sklejone klasy (brak spacji) nie mogą przejść.
      expect(option.classList.contains('sm:max-w-[380px]')).toBe(true);
      expect(option.classList.contains('border-border')).toBe(true);
    }
    // Wybrana odpowiedź ma ramkę w akcencie (regresja ze sklejonych klas - code review D-197).
    fireEvent.click(screen.getByRole('radio', { name: 'Nie' }));
    expect(screen.getAllByTestId('page-quiz-option')[1].classList.contains('border-accent')).toBe(true);
  });

  it('zwykły quiz (bez oprawy) zostaje jak dotąd - bez okna przeglądarki', () => {
    stubFetch(true);
    const plain: ContentBlock = { type: 'QUIZ', id: 'zaufanie', prompt: 'Czy link jest godny zaufania?', options: [{ text: 'Tak' }, { text: 'Nie' }] };
    render(<CoursePlayer courseId="course-1" initial={course([plain])} narrationEnabled={false} />);
    expect(screen.queryByTestId('desktop-stage')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Nie' })).toBeInTheDocument();
  });
});
