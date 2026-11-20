import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock, FakePage } from '@/lib/courses-types';
import DialogueBlock from './blocks/DialogueBlock';
import TextInputBlock from './blocks/TextInputBlock';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Druga runda poprawek właściciela modułu 1 (D-184, 2026-11-20): GTA6 bez najazdu kamery (same okienka), Internet otwiera fałszywą stronę
// logowania, wynik maila zostaje w monitorze, rozmowa z Pawłem na telefonie z biurka, zadanie z domeną wbudowane w fałszywą stronę na
// pulpicie (scena z przybliżeniem pod oknem).

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

function stubFetch(body: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      assignmentId: 'a1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 1,
      score: null,
      completedAt: null,
      lastResult: { blockIndex: 0 },
      gamification: null,
      ...body,
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const page: FakePage = {
  tabTitle: 'Formularz prelegenta – rejestracja',
  url: 'https://fundacja-analityki.formularz-online.net/prelegenci/48213',
  brand: 'Fundacja Analityki Stosowanej',
  heading: 'Rejestracja prelegenta',
  text: 'Potwierdź tożsamość.',
  fields: ['Służbowy e-mail', 'Hasło'],
  button: 'Zarejestruj się',
};

function desktop(media: NonNullable<ContentBlock['hotspots']>[number]['media'], content = 'Opis.'): ContentBlock {
  return {
    type: 'SCENE_HOTSPOTS',
    id: 'pulpit',
    image: 'img/pulpit.webp',
    imageAlt: 'Pulpit',
    hotspots: [
      { id: 'poczta', label: 'Poczta', x: 5, y: 5, width: 10, height: 10, action: 'next' },
      { id: 'ikona', label: 'Ikona', x: 40, y: 40, width: 10, height: 10, content, media, required: false },
    ],
  };
}

describe('CoursePlayer: poprawki modułu 1, runda 2 (D-184)', () => {
  it('GTA6 (okienka easter egga na scenie głównej): od razu okienka, bez najazdu kamery i bez przyciemnienia sceny', async () => {
    stubFetch();
    const scene = desktop({ kind: 'popups', items: [{ title: 'Wirusy!', body: 'Chory komputer.', button: 'Wylecz' }], outro: 'To tylko ćwiczenie.' });
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    fireEvent.click(screen.getByTestId('hotspot-overlay-ikona'));
    const overlay = screen.getByTestId('scene-zoom');
    // Najazd kamery zaczyna się fazą 'in' - tu okno jest otwarte od razu.
    expect(overlay).toHaveAttribute('data-phase', 'open');
    expect(overlay).toHaveClass('bg-transparent');
    expect(overlay.className).not.toMatch(/backdrop-blur/);
    expect(await screen.findByText(/Wirusy!/)).toBeInTheDocument();
  });

  it('Internet: okno przeglądarki z fałszywą stroną logowania (karta, adres, makieta bez pól), opis pod oknem, bez najazdu kamery', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course([desktop({ kind: 'page', page }, 'W historii przeglądarki: formularz.')])} narrationEnabled={false} />);
    fireEvent.click(screen.getByTestId('hotspot-overlay-ikona'));
    expect(screen.getByTestId('scene-zoom')).toHaveAttribute('data-phase', 'open');
    const window = screen.getByTestId('fake-page-window');
    expect(window).toHaveTextContent('Formularz prelegenta – rejestracja');
    expect(window).toHaveTextContent('formularz-online.net/prelegenci/48213');
    const mock = within(window).getByTestId('fake-login-page');
    expect(mock).toHaveAccessibleName(/Fundacja Analityki Stosowanej – Rejestracja prelegenta.*Służbowy e-mail, Hasło.*Zarejestruj się/);
    // Makieta to obrazek: nic nie da się wpisać ani wysłać.
    expect(window.querySelector('input, form, textarea, button')).toBeNull();
    expect(screen.getByText('W historii przeglądarki: formularz.')).toBeInTheDocument();
  });

  it('Internet: „Zamknij” (D-187, zamiast „Odłóż”) i klik w tło zamykają okno od razu (bez fazy oddalania), fokus wraca na przedmiot', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course([desktop({ kind: 'page', page })])} narrationEnabled={false} />);
    const item = screen.getByTestId('hotspot-overlay-ikona');
    fireEvent.click(item);
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByTestId('scene-zoom')).toBeNull();
    expect(item).toHaveFocus();
    fireEvent.click(item);
    fireEvent.click(screen.getByTestId('scene-zoom'));
    expect(screen.queryByTestId('scene-zoom')).toBeNull();
  });

  it('mail w monitorze: wynik po „Sprawdź odpowiedź” zostaje w tym samym monitorze', async () => {
    stubFetch({
      lastResult: {
        blockIndex: 0,
        type: 'EMAIL_ANALYSIS',
        correct: true,
        points: 1,
        detail: { criteria: [{ id: 'c1', correct: false, selected: false }, { id: 'c2', correct: true, selected: true, explanation: 'Oferta z nieba.' }] },
      },
    });
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
    fireEvent.click(screen.getByLabelText('Atrakcyjna oferta'));
    // „Sprawdź odpowiedź” w miejscu „Dalej” (D-187) - jedyny taki przycisk.
    expect(screen.getAllByRole('button', { name: 'Sprawdź odpowiedź' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź odpowiedź' }));
    const result = await screen.findByText(/Świetnie: wszystkie oznaki trafione/);
    expect(screen.getByTestId('monitor-screen')).toContainElement(result);
    expect(within(screen.getByTestId('monitor-screen')).getByText('Oferta z nieba.')).toBeInTheDocument();
  });

  const dialogue: ContentBlock = {
    type: 'DIALOGUE',
    id: 'rozmowa-pawel',
    title: 'Rozmowa z Pawłem',
    tip: 'Pytaj i słuchaj.',
    phone: { image: 'assets/m/telefon.1.webp', screen: { x: 41, y: 13, width: 18, height: 72 } },
    character: { name: 'Paweł Nowicki', role: 'analityk danych', opening: 'Głupio mi.' },
    questions: [{ id: 'q1', text: 'Co się wydarzyło?', answer: 'Kliknąłem link.', required: true }],
  };

  it('rozmowa z Pawłem na ekranie telefonu z biurka: pasek komunikatora z rozmówcą, pytania na ekranie, podpowiedź nie paskiem', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course([dialogue])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const stage = screen.getByTestId('phone-stage');
    expect(stage.querySelector('img')).toHaveAttribute('src', 'https://content.example.test/assets/m/telefon.1.webp');
    const phoneScreen = within(stage).getByTestId('phone-screen');
    expect(phoneScreen).toHaveAccessibleName('Rozmowa z Pawłem');
    expect(within(phoneScreen).getByTestId('dialogue-on-phone')).toHaveTextContent('Paweł Nowicki');
    expect(within(phoneScreen).getByRole('button', { name: 'Co się wydarzyło?' })).toBeInTheDocument();
    expect(within(phoneScreen).queryByText(/Rozmawiasz z:/)).toBeNull();
    expect(within(phoneScreen).queryByText('Pytaj i słuchaj.')).toBeNull();
    // Pytania jedno pod drugim, zawijane (D-185) - stopka w wariancie telefonu (globals.css .dialogue-footer-phone).
    expect(within(phoneScreen).getByRole('group', { name: 'Pytania i postęp rozmowy' })).toHaveClass('dialogue-footer-phone');
  });

  it('rozmowa z telefonem w podglądzie „Wstecz” (review): zwykła rozmowa, bez telefonu ze sceny', () => {
    render(<DialogueBlock block={dialogue} contentBase="https://content.example.test" onSubmit={() => {}} onReady={() => {}} review />);
    expect(screen.queryByTestId('phone-stage')).toBeNull();
    expect(screen.getByText(/Rozmawiasz z:/)).toBeInTheDocument();
  });

  const domain: ContentBlock = {
    type: 'TEXT_INPUT_GUIDED',
    id: 'domena',
    prompt: 'Znajdź domenę w adresie.',
    placeholder: 'wpisz domenę',
    frame: 'monitor',
    markUrl: 'https://fundacja-analityki.formularz-online.net/prelegenci/48213',
    background: 'assets/m/pulpit.1.webp',
    page: { ...page, url: undefined },
    maxAttempts: 4,
    hintCount: 3,
  };

  it('domena na pulpicie: scena pod oknem przeglądarki, pasek adresu do zaznaczenia, zadanie nad fałszywą stroną logowania', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course([domain])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const stage = screen.getByTestId('desktop-stage');
    expect(stage.querySelector('img')).toHaveAttribute('src', 'https://content.example.test/assets/m/pulpit.1.webp');
    expect(screen.queryByTestId('monitor-stage')).toBeNull();
    const window = within(stage).getByTestId('desktop-window');
    expect(window).toHaveAccessibleName('Przeglądarka');
    expect(within(window).getByTestId('browser-window')).toHaveTextContent('Formularz prelegenta – rejestracja');
    expect(within(window).getByTestId('page-task')).toHaveTextContent('Krok 1 z 3');
    expect(within(window).getByTestId('fake-login-page')).toBeInTheDocument();
    // Zaznaczanie domeny działa jak w monitorze (D-181): „/”, potem „.”, dopiero wtedy pole.
    const url = domain.markUrl!;
    const separator = (index: number) => window.querySelector(`[data-testid="address-separator"][data-index="${index}"]`) as HTMLElement;
    fireEvent.click(separator(url.indexOf('/', url.indexOf('://') + 3)));
    fireEvent.click(separator(url.indexOf('.')));
    expect(within(window).getByTestId('address-domain')).toHaveTextContent('formularz-online.net');
    await waitFor(() => expect(screen.getByPlaceholderText('wpisz domenę')).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    // Na fałszywej stronie nie ma pól - jedyne pole to odpowiedź zadania.
    expect(within(window).getAllByRole('textbox')).toHaveLength(1);
  });

  it('domena z tłem w podglądzie „Wstecz”: zwykły podgląd bez pulpitu', () => {
    render(<TextInputBlock block={domain} courseId="course-1" readOnly progress={{ type: 'TEXT_INPUT_GUIDED', attempts: 1, done: true, correct: true }} />);
    expect(screen.queryByTestId('desktop-stage')).toBeNull();
    expect(screen.getByTestId('text-input-address')).toBeInTheDocument();
  });
});
