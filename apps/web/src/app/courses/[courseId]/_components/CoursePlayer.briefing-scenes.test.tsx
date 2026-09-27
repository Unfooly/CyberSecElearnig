import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Odprawa jako sceny z grafiką (feat/briefing-scenes, D-084): obraz kroku, wariant bez animacji, hotspot = cta, dwie fazy
// karty sprawy (zamknięta teczka -> akta ze slotem zadań), sloty legitymacji z danych sesji.

const briefing: ContentBlock = {
  type: 'BRIEFING',
  id: 'odprawa',
  steps: [
    {
      kind: 'typewriter',
      text: 'Wtorek, 9:40. Dzwoni telefon.',
      cta: 'Odbierz',
      image: 'scenes/biurko.svg',
      hotspot: { id: 'telefon', x: 49, y: 21.6, w: 16.3, h: 54.2 },
    },
    { kind: 'call', caller: { name: 'Komisarz Adam Wolski', role: 'Wydział Cyberbezpieczeństwa' }, text: 'Mamy sprawę w Unfooly.', cta: 'Przyjmuję', image: 'scenes/rozmowa.svg' },
    {
      kind: 'caseFile',
      caseNo: 'CS/2026/0915',
      title: 'Nieautoryzowany przelew',
      fields: [{ label: 'Strata', value: '14 000,00 PLN' }],
      stamp: 'Priorytet',
      tasks: [{ id: 'dowody', text: 'Zbierz dowody w biurze Anny.', completeWhen: ['biuro'] }],
      cta: 'Biorę sprawę',
      closedImage: 'scenes/teczka.svg',
      image: 'scenes/akta.svg',
      hotspot: { id: 'teczka', x: 24.4, y: 17.4, w: 51.6, h: 69.5 },
      slots: { tasks: { x: 54.1, y: 19.4, w: 37.1, h: 56.2 } },
    },
    {
      kind: 'badge',
      cta: 'Ruszam na miejsce',
      image: 'scenes/legitymacja.svg',
      slots: { photo: { x: 55, y: 30, w: 11, h: 25 }, name: { x: 68, y: 33, w: 17, h: 5 }, number: { x: 68, y: 44, w: 17, h: 5 } },
    },
    { kind: 'start', text: 'Unfooly, drugie piętro.', cta: 'Wchodzę', image: 'scenes/korytarz.svg' },
  ],
};

function course(overrides: Partial<CoursePlayerInitialState> = {}): CoursePlayerInitialState {
  return {
    assignmentId: 'a1',
    courseId: 'course-1',
    title: 'Sprawa testowa',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [briefing, { type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.' }],
    progress: null,
    score: null,
    ...overrides,
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/users/me/display-name') return { ok: true, status: 200, json: async () => ({ firstName: 'Jan', lastInitial: 'P' }) };
    if (url === '/api/users/me/avatar') return { ok: true, status: 200, json: async () => ({ avatarUrl: null }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS', currentBlockIndex: 1, score: null, completedAt: null, lastResult: { blockIndex: 0, blockId: 'odprawa', type: 'BRIEFING' }, gamification: null }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sceneImages = () => [...screen.getByTestId('briefing-scene').querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('CoursePlayer: odprawa ze scenami (D-084)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('krok ze sceną: obraz kroku, hotspot to skrót myszy (poza Tab, aria-hidden), klik w hotspot = cta', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    expect(screen.getByTestId('briefing-block')).toHaveAttribute('data-scene', 'true');
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/biurko.svg']);
    // Pełny tekst dla czytnika, przycisk cta dla klawiatury.
    expect(screen.getByText('Wtorek, 9:40. Dzwoni telefon.', { selector: 'p.sr-only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Odbierz' })).toBeInTheDocument();
    const hotspot = screen.getByTestId('briefing-hotspot');
    expect(hotspot).toHaveAttribute('aria-hidden', 'true');
    expect(hotspot).toHaveAttribute('tabindex', '-1');
    expect(hotspot).toHaveStyle({ left: '49%', top: '21.6%', width: '16.3%', height: '54.2%' });

    fireEvent.click(hotspot);
    const bubble = screen.getByTestId('briefing-bubble');
    expect(within(bubble).getByText('Komisarz Adam Wolski')).toBeInTheDocument();
    expect(within(bubble).getByText('Mamy sprawę w Unfooly.')).toBeInTheDocument();
    expect(bubble).toHaveStyle({ left: '46%' });
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/rozmowa.svg']);
  });

  it('prefers-reduced-motion: obraz sceny z #static (zatrzymuje animacje CSS w SVG), także obie fazy teczki', async () => {
    stubFetch();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    await waitFor(() => expect(sceneImages()).toEqual(['https://cdn.example/scenes/biurko.svg#static']));
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję' }));
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/akta.svg#static', 'https://cdn.example/scenes/teczka.svg#static']);
  });

  it('karta sprawy: zamknięta teczka ("Otwórz teczkę" albo hotspot) -> akta z zadaniami w slocie; dane karty dla czytnika', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję' }));

    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'closed');
    expect(screen.queryByRole('button', { name: 'Biorę sprawę' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('briefing-slot-tasks')).not.toBeInTheDocument();
    expect(screen.getByText('Sprawa nr CS/2026/0915: Nieautoryzowany przelew')).toBeInTheDocument();
    expect(screen.getByText('14 000,00 PLN')).toBeInTheDocument();
    // Obie fazy w DOM (crossfade): akta pod spodem, zamknięta teczka na wierzchu.
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/akta.svg', 'https://cdn.example/scenes/teczka.svg']);

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz teczkę' }));
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'open');
    expect(screen.getByTestId('briefing-closed-image')).toHaveClass('opacity-0');
    expect(screen.queryByTestId('briefing-hotspot')).not.toBeInTheDocument();
    const slot = screen.getByTestId('briefing-slot-tasks');
    expect(slot).toHaveStyle({ left: '54.1%', top: '19.4%' });
    expect(within(slot).getByRole('listitem')).toHaveTextContent('Do zrobienia: Zbierz dowody w biurze Anny.');
    expect(screen.getByRole('button', { name: 'Biorę sprawę' })).toBeInTheDocument();
  });

  it('podwójny klik nie przeskakuje kroku (drugi klik serii jest ignorowany); po otwarciu teczki fokus na treści kroku', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }), { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję' }), { detail: 1 });

    const open = screen.getByRole('button', { name: 'Otwórz teczkę' });
    fireEvent.click(open, { detail: 1 });
    // Ten sam przycisk (teraz "Biorę sprawę") dostaje drugi klik serii - akta z zadaniami zostają.
    fireEvent.click(screen.getByRole('button', { name: 'Biorę sprawę' }), { detail: 2 });
    expect(screen.getByTestId('briefing-slot-tasks')).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('role', 'group');
    // Klawiatura (detail 0) działa normalnie.
    fireEvent.click(screen.getByRole('button', { name: 'Biorę sprawę' }), { detail: 0 });
    expect(screen.getByTestId('briefing-slot-name')).toBeInTheDocument();
  });

  it('podgląd ukończonej odprawy: na ostatnim kroku ani przycisku, ani hotspotu (nic nie zapisuje)', () => {
    const fetchMock = stubFetch();
    const withLastHotspot: ContentBlock = {
      ...briefing,
      steps: briefing.steps!.map((step) => (step.kind === 'start' ? { ...step, hotspot: { id: 'drzwi', x: 40, y: 30, w: 20, h: 40 } } : step)),
    };
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({
          currentBlockIndex: 1,
          contentBlocks: [withLastHotspot, { type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.' }],
          progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true } }, notes: [] },
        })}
        narrationEnabled={false}
        contentBase="https://cdn.example"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję' }));
    // Teczka w podglądzie startuje zamknięta.
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'closed');
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz teczkę' }));
    fireEvent.click(screen.getByRole('button', { name: 'Biorę sprawę' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ruszam na miejsce' }));
    expect(screen.queryByRole('button', { name: 'Wchodzę' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('briefing-hotspot')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/progress'))).toHaveLength(0);
  });

  it('teczkę otwiera też klik w hotspot; legitymacja: inicjały, imię z inicjałem nazwiska i numer z caseNo w slotach; ostatni krok zapisuje blok', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} userEmail="jan.p@firma.pl" contentBase="https://cdn.example" />);
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Przyjmuję' }));
    fireEvent.click(screen.getByTestId('briefing-hotspot'));
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'open');
    fireEvent.click(screen.getByRole('button', { name: 'Biorę sprawę' }));

    await waitFor(() => expect(screen.getByTestId('briefing-slot-name')).toHaveTextContent('Jan P.'));
    expect(screen.getByTestId('briefing-slot-number')).toHaveTextContent('0915-JP');
    expect(screen.getByTestId('briefing-slot-photo')).toHaveTextContent('JP');
    expect(screen.getByTestId('briefing-slot-photo')).toHaveClass('bg-accent-soft');
    expect(screen.getByText('Legitymacja śledczego: Jan P., nr legitymacji 0915-JP.')).toHaveClass('sr-only');

    fireEvent.click(screen.getByRole('button', { name: 'Ruszam na miejsce' }));
    expect(within(screen.getByTestId('briefing-scene-text')).getByText('Unfooly, drugie piętro.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wchodzę' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/progress'))).toHaveLength(1));
  });
});
