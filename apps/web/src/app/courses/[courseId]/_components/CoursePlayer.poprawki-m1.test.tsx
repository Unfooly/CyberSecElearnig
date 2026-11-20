import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';
import TextInputBlock from './blocks/TextInputBlock';
import DossierBlock from './blocks/DossierBlock';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Poprawki właściciela modułu 1 (D-181, 2026-11-20): drzwi tylko niebieską ramką (bez ikony), gazeta jako strona gazety, komunikator na
// ekranie telefonu ze sceny (nie w osobnym oknie), domena rozkładana w pasku adresu strony w monitorze („/”, potem „.”, potem wpisanie).

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

function stubFetch(attempt?: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).endsWith('/attempt')
        ? attempt
        : { assignmentId: 'a1', status: 'IN_PROGRESS', currentBlockIndex: 1, score: null, completedAt: null, lastResult: { blockIndex: 0 }, gamification: null },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const barNext = () => screen.getByRole('button', { name: /^Dalej/ });

afterEach(() => vi.unstubAllGlobals());

describe('CoursePlayer: poprawki modułu 1 (D-181)', () => {
  it('drzwi gotowe: niebieska ramka bez ikony drzwi', () => {
    stubFetch();
    const scene: ContentBlock = {
      type: 'SCENE_HOTSPOTS',
      id: 'biuro',
      image: 'img/biuro.webp',
      imageAlt: 'Biuro',
      hotspots: [{ id: 'komputer', label: 'Komputer', x: 5, y: 5, width: 20, height: 20, action: 'next' }],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    const door = screen.getByTestId('hotspot-overlay-komputer');
    expect(door).toHaveAttribute('data-state', 'ready');
    expect(door).toHaveClass('border-indigo-600');
    expect(door.className).not.toMatch(/amber/);
    expect(door.querySelector('svg')).toBeNull();
  });

  it('gazeta: zbliżenie jako strona gazety (winieta, data, nagłówek, akapity), nie ciemny panel', async () => {
    stubFetch();
    const scene: ContentBlock = {
      type: 'SCENE_HOTSPOTS',
      id: 'gazeta',
      image: 'img/gazeta.webp',
      imageAlt: 'Gazeta',
      hotspots: [
        {
          id: 'artykul',
          label: 'Gazeta',
          x: 10,
          y: 5,
          width: 80,
          height: 88,
          required: true,
          media: {
            kind: 'document',
            look: 'newspaper',
            masthead: 'Kurier Cyfrowy',
            date: 'Wydanie specjalne',
            title: 'Hakerzy podszywali się pod organizatorów',
            lines: ['Lead artykułu.', 'Drugi akapit.', 'Trzeci akapit.'],
          },
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    fireEvent.click(screen.getByTestId('hotspot-overlay-artykul'));
    const page = await screen.findByTestId('newspaper-page');
    expect(page).toHaveTextContent('Kurier Cyfrowy');
    expect(page).toHaveTextContent('Wydanie specjalne');
    expect(within(page).getByRole('heading', { name: 'Hakerzy podszywali się pod organizatorów' })).toBeInTheDocument();
    expect(within(page).getByText('Lead artykułu.')).toBeInTheDocument();
    expect(within(page).getByText('Trzeci akapit.')).toBeInTheDocument();
    expect(page.querySelector('pre')).toBeNull();
  });

  it('komunikator na ekranie telefonu ze sceny: grafika telefonu z contentBase, czat bez własnej ramki i bez karty teczki', async () => {
    const fetchMock = stubFetch();
    const chat: ContentBlock = {
      type: 'DOSSIER',
      id: 'komunikator',
      title: 'Smartfon Pawła',
      stamp: 'DOWÓD',
      phone: { image: 'assets/m/telefon.1.webp', screen: { x: 41, y: 13, width: 18, height: 72 } },
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
            { id: 'r2', cells: ['10:15', '—', 'Połączenie głosowe'], evidence: true, required: true, note: { text: 'Telefon.', kind: 'call' } },
          ],
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([chat])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const stage = screen.getByTestId('phone-stage');
    expect(stage.querySelector('img')).toHaveAttribute('src', 'https://content.example.test/assets/m/telefon.1.webp');
    const phoneScreen = within(stage).getByTestId('phone-screen');
    expect(phoneScreen).toHaveAccessibleName('Smartfon Pawła');
    const sheet = within(phoneScreen).getByTestId('chat-sheet');
    expect(sheet.innerHTML).not.toMatch(/border-\[10px\]/);
    // Bez karty teczki (spinacz, pieczątka „DOWÓD”) - sam telefon.
    expect(screen.queryByTestId('dossier-block')).toBeNull();
    expect(screen.queryByText('DOWÓD')).toBeNull();
    fireEvent.click(within(sheet).getAllByTestId('chat-bubble')[1]);
    fireEvent.click(barNext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string).answer).toEqual({ opened: ['czat'], noted: ['r2'] });
  });

  it('domena w monitorze: najpierw pierwszy pojedynczy „/”, potem druga „.” w lewo - dopiero wtedy pole; złe kliknięcia z komunikatem', async () => {
    const fetchMock = stubFetch({ blockId: 'domena', correct: true, attempt: 1, attemptsLeft: 3, done: true, points: 1 });
    const url = 'https://fundacja-analityki.formularz-online.net/prelegenci/48213';
    const domain: ContentBlock = {
      type: 'TEXT_INPUT_GUIDED',
      id: 'domena',
      prompt: 'Znajdź domenę w adresie.',
      placeholder: 'wpisz domenę',
      frame: 'monitor',
      markUrl: url,
      maxAttempts: 4,
      hintCount: 3,
    };
    render(<CoursePlayer courseId="course-1" initial={course([domain])} narrationEnabled={false} />);
    const monitor = screen.getByTestId('monitor-screen');
    expect(within(monitor).getByTestId('mark-instruction')).toHaveTextContent('Krok 1 z 3');
    expect(screen.queryByPlaceholderText('wpisz domenę')).toBeNull();
    const separator = (index: number) => monitor.querySelector(`[data-testid="address-separator"][data-index="${index}"]`) as HTMLElement;

    // Ukośnik z „https://” - podwójny, to nie ten.
    fireEvent.click(separator(url.indexOf('/')));
    expect(within(monitor).getByRole('status')).toHaveTextContent('POJEDYNCZEGO');
    const slash = url.indexOf('/', url.indexOf('://') + 3);
    fireEvent.click(separator(slash));
    expect(within(monitor).getByTestId('mark-instruction')).toHaveTextContent('Krok 2 z 3');
    // Pierwsza kropka w lewo (.net) - to nie ta.
    fireEvent.click(separator(url.lastIndexOf('.', slash)));
    expect(within(monitor).getByRole('status')).toHaveTextContent('To nie ta kropka');
    fireEvent.click(separator(url.indexOf('.')));
    expect(within(monitor).getByTestId('address-domain')).toHaveTextContent('formularz-online.net');
    expect(within(monitor).getByTestId('mark-instruction')).toHaveTextContent('Krok 3 z 3');

    // Kliknięcia separatorów niczego nie zapisują (bez kary, bez punktów), a po zaznaczeniu fokus jest na polu odpowiedzi.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('wpisz domenę')).toHaveFocus();
    expect(within(monitor).getByRole('status')).toHaveTextContent('Domena zaznaczona.');
    fireEvent.change(screen.getByPlaceholderText('wpisz domenę'), { target: { value: 'formularz-online.net' } });
    // „Sprawdź” w miejscu „Dalej” w dolnym pasku (D-187), nie w monitorze.
    expect(within(monitor).queryByRole('button', { name: 'Sprawdź' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Sprawdź$/ }));
    await within(monitor).findByText('Poprawna odpowiedź!');
    expect(fetchMock.mock.calls.some(([request]) => String(request).endsWith('/blocks/domena/attempt'))).toBe(true);
  });

  const domainBlock: ContentBlock = {
    type: 'TEXT_INPUT_GUIDED',
    id: 'domena',
    prompt: 'Znajdź domenę w adresie.',
    placeholder: 'wpisz domenę',
    frame: 'monitor',
    markUrl: 'https://fundacja-analityki.formularz-online.net/prelegenci/48213',
    maxAttempts: 4,
    hintCount: 3,
  };

  it('domena po odświeżeniu z wykonaną próbą: od razu zaznaczona, bez przycisków separatorów, pole widoczne', () => {
    render(<TextInputBlock block={domainBlock} courseId="course-1" progress={{ type: 'TEXT_INPUT_GUIDED', attempts: 1, done: false }} />);
    expect(screen.queryAllByTestId('address-separator')).toHaveLength(0);
    expect(screen.getByTestId('address-domain')).toHaveTextContent('formularz-online.net');
    expect(screen.getByPlaceholderText('wpisz domenę')).toBeInTheDocument();
  });

  it('domena w podglądzie „Wstecz”: zwykły podgląd bez monitora, z adresem pod poleceniem', () => {
    render(<TextInputBlock block={domainBlock} courseId="course-1" readOnly progress={{ type: 'TEXT_INPUT_GUIDED', attempts: 1, done: true, correct: true }} />);
    expect(screen.queryByTestId('monitor-screen')).toBeNull();
    expect(screen.getByTestId('text-input-address')).toHaveTextContent('formularz-online.net/prelegenci');
  });

  it('komunikator z telefonem w podglądzie „Wstecz” (review): zwykła karta rozmowy, bez telefonu ze sceny', () => {
    const chat: ContentBlock = {
      type: 'DOSSIER',
      id: 'komunikator',
      phone: { image: 'assets/m/telefon.1.webp', screen: { x: 41, y: 13, width: 18, height: 72 } },
      documents: [
        { id: 'czat', tab: 'Komunikator', org: 'S', title: 'K', layout: 'chat', self: 'Paweł', columns: ['Godz.', 'Kto', 'Wiadomość'], rows: [{ id: 'r1', cells: ['10:12', 'K', 'Hej'] }] },
      ],
    };
    render(<DossierBlock block={chat} contentBase="https://content.example.test" onSubmit={() => {}} onReady={() => {}} review />);
    expect(screen.queryByTestId('phone-stage')).toBeNull();
    expect(screen.getByTestId('dossier-block')).toBeInTheDocument();
    expect(screen.getByTestId('chat-sheet')).toBeInTheDocument();
  });
});
