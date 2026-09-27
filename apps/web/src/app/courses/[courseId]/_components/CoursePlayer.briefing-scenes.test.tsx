import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import { IDLE_MS } from './blocks/BriefingScene';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Odprawa jako sceny z grafiką (feat/briefing-scenes, D-084) i bez przycisków cta (feat/scene-zoom, D-086): postęp WYŁĄCZNIE klikiem
// w przedmiot kroku - telefon (Odbierz), czerwona słuchawka (Rozłącz), zamknięta teczka (Otwórz), akta (Zamknij), legitymacja (Zabierz).
// Przedmiot to focusowalny przycisk z etykietą cta; krok ze sceną bez przedmiotu (treść sprzed D-086) nadal ma przycisk cta.

const briefing: ContentBlock = {
  type: 'BRIEFING',
  id: 'odprawa',
  steps: [
    {
      kind: 'typewriter',
      text: 'Wtorek, 9:40. Dzwoni telefon.',
      cta: 'Odbierz telefon',
      image: 'scenes/biurko.svg',
      hotspot: { id: 'telefon', x: 49, y: 21.6, w: 16.3, h: 54.2 },
    },
    {
      kind: 'call',
      caller: { name: 'Komisarz Adam Wolski', role: 'Wydział Cyberbezpieczeństwa' },
      text: 'Mamy sprawę w Unfooly.',
      cta: 'Rozłącz',
      image: 'scenes/rozmowa.svg',
      hotspot: { id: 'rozlacz', x: 21.4, y: 72.4, w: 8.5, h: 15.1 },
    },
    {
      kind: 'caseFile',
      caseNo: 'CS/2026/0915',
      title: 'Nieautoryzowany przelew',
      fields: [{ label: 'Strata', value: '14 000,00 PLN' }],
      stamp: 'Priorytet',
      tasks: [{ id: 'dowody', text: 'Zbierz dowody w biurze Anny.', completeWhen: ['biuro'] }],
      cta: 'Zamknij teczkę',
      closedImage: 'scenes/teczka.svg',
      image: 'scenes/akta.svg',
      hotspot: { id: 'teczka', x: 24.4, y: 17.4, w: 51.6, h: 69.5 },
      openHotspot: { id: 'akta', x: 3.9, y: 2.3, w: 92.1, h: 95.3 },
      slots: { tasks: { x: 54.1, y: 19.4, w: 37.1, h: 56.2 } },
    },
    {
      kind: 'badge',
      cta: 'Zabierz legitymację',
      image: 'scenes/legitymacja.svg',
      hotspot: { id: 'legitymacja', x: 8.8, y: 6, w: 82.5, h: 88 },
      slots: { photo: { x: 55, y: 30, w: 11, h: 25 }, name: { x: 68, y: 33, w: 17, h: 5 }, number: { x: 68, y: 44, w: 17, h: 5 } },
    },
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
const item = (name: string) => screen.getByRole('button', { name });
const progressCalls = (fetchMock: ReturnType<typeof stubFetch>) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/progress'));

describe('CoursePlayer: odprawa ze scenami, postęp klikiem w przedmiot (D-084, D-086)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('krok ze sceną: przedmiot to focusowalny przycisk z etykietą i widocznym focusem, bez przycisku cta; klik = następny krok', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    expect(screen.getByTestId('briefing-block')).toHaveAttribute('data-scene', 'true');
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/biurko.svg']);
    expect(screen.getByText('Wtorek, 9:40. Dzwoni telefon.', { selector: 'p.sr-only' })).toBeInTheDocument();
    const phone = screen.getByTestId('briefing-hotspot');
    expect(phone).toBe(item('Odbierz telefon'));
    expect(phone).not.toHaveAttribute('aria-hidden');
    expect(phone).not.toHaveAttribute('tabindex', '-1');
    expect(phone.className).toMatch(/focus-visible:outline-accent/);
    expect(phone).toHaveStyle({ left: '49%', top: '21.6%', width: '16.3%', height: '54.2%' });
    // Jedyny przycisk kroku to przedmiot - bez osobnego cta pod sceną.
    expect(screen.getAllByRole('button', { name: 'Odbierz telefon' })).toHaveLength(1);

    fireEvent.click(phone);
    const bubble = screen.getByTestId('briefing-bubble');
    expect(within(bubble).getByText('Komisarz Adam Wolski')).toBeInTheDocument();
    expect(within(bubble).getByText('Mamy sprawę w Unfooly.')).toBeInTheDocument();
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/rozmowa.svg']);
    expect(item('Rozłącz')).toHaveStyle({ left: '21.4%', top: '72.4%' });
  });

  it('po IDLE_MS bez akcji przedmiot delikatnie pulsuje (.briefing-hotspot--idle); nowy krok zaczyna odliczanie od nowa', () => {
    vi.useFakeTimers();
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    expect(item('Odbierz telefon')).not.toHaveClass('briefing-hotspot--idle');
    act(() => vi.advanceTimersByTime(IDLE_MS - 1));
    expect(item('Odbierz telefon')).not.toHaveClass('briefing-hotspot--idle');
    act(() => vi.advanceTimersByTime(1));
    expect(item('Odbierz telefon')).toHaveClass('briefing-hotspot--idle');

    fireEvent.click(item('Odbierz telefon'));
    expect(item('Rozłącz')).not.toHaveClass('briefing-hotspot--idle');
    act(() => vi.advanceTimersByTime(IDLE_MS));
    expect(item('Rozłącz')).toHaveClass('briefing-hotspot--idle');
  });

  it('prefers-reduced-motion: obraz sceny z #static (zatrzymuje animacje CSS w SVG), także obie fazy teczki', async () => {
    stubFetch();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    await waitFor(() => expect(sceneImages()).toEqual(['https://cdn.example/scenes/biurko.svg#static']));
    fireEvent.click(item('Odbierz telefon'));
    fireEvent.click(item('Rozłącz'));
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/akta.svg#static', 'https://cdn.example/scenes/teczka.svg#static']);
  });

  it('karta sprawy: klik w zamkniętą teczkę ("Otwórz teczkę") -> akta z zadaniami w slocie; klik w akta ("Zamknij teczkę") = dalej; dane karty dla czytnika', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    fireEvent.click(item('Odbierz telefon'));
    fireEvent.click(item('Rozłącz'));

    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'closed');
    expect(screen.queryByRole('button', { name: 'Zamknij teczkę' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('briefing-slot-tasks')).not.toBeInTheDocument();
    expect(screen.getByText('Sprawa nr CS/2026/0915: Nieautoryzowany przelew')).toBeInTheDocument();
    expect(screen.getByText('14 000,00 PLN')).toBeInTheDocument();
    // Obie fazy w DOM (crossfade): akta pod spodem, zamknięta teczka na wierzchu.
    expect(sceneImages()).toEqual(['https://cdn.example/scenes/akta.svg', 'https://cdn.example/scenes/teczka.svg']);

    fireEvent.click(item('Otwórz teczkę'));
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'open');
    expect(screen.getByTestId('briefing-closed-image')).toHaveClass('opacity-0');
    const slot = screen.getByTestId('briefing-slot-tasks');
    expect(slot).toHaveStyle({ left: '54.1%', top: '19.4%' });
    expect(within(slot).getByRole('listitem')).toHaveTextContent('Do zrobienia: Zbierz dowody w biurze Anny.');
    // Slot zadań leży NAD przedmiotem akt, ale nie łapie kliknięć (klik w akta w miejscu listy też zamyka teczkę).
    expect(slot).toHaveClass('pointer-events-none');
    expect(item('Zamknij teczkę')).toHaveStyle({ left: '3.9%', top: '2.3%' });

    fireEvent.click(item('Zamknij teczkę'));
    expect(screen.getByTestId('briefing-slot-name')).toBeInTheDocument();
  });

  it('podwójny klik nie przeskakuje kroku (drugi klik serii jest ignorowany); po otwarciu teczki fokus na treści kroku', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    fireEvent.click(item('Odbierz telefon'), { detail: 1 });
    fireEvent.click(item('Rozłącz'), { detail: 1 });

    fireEvent.click(item('Otwórz teczkę'), { detail: 1 });
    // Drugi klik serii trafia już w przedmiot akt - ignorowany, akta z zadaniami zostają.
    fireEvent.click(item('Zamknij teczkę'), { detail: 2 });
    expect(screen.getByTestId('briefing-slot-tasks')).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('role', 'group');
    // Klawiatura (detail 0) działa normalnie.
    fireEvent.click(item('Zamknij teczkę'), { detail: 0 });
    expect(screen.getByTestId('briefing-slot-name')).toBeInTheDocument();
  });

  it('legitymacja: inicjały, imię z inicjałem nazwiska i numer z caseNo w slotach; klik w legitymację ("Zabierz legitymację") zapisuje blok', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} userEmail="jan.p@firma.pl" contentBase="https://cdn.example" />);
    fireEvent.click(item('Odbierz telefon'));
    fireEvent.click(item('Rozłącz'));
    fireEvent.click(item('Otwórz teczkę'));
    fireEvent.click(item('Zamknij teczkę'));

    await waitFor(() => expect(screen.getByTestId('briefing-slot-name')).toHaveTextContent('Jan P.'));
    expect(screen.getByTestId('briefing-slot-number')).toHaveTextContent('0915-JP');
    expect(screen.getByTestId('briefing-slot-photo')).toHaveTextContent('JP');
    expect(screen.getByTestId('briefing-slot-photo')).toHaveClass('bg-accent-soft');
    expect(screen.getByText('Legitymacja śledczego: Jan P., nr legitymacji 0915-JP.')).toHaveClass('sr-only');
    expect(progressCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(item('Zabierz legitymację'));
    await waitFor(() => expect(progressCalls(fetchMock)).toHaveLength(1));
  });

  it('podgląd ukończonej odprawy: na ostatnim kroku przedmiot nieaktywny (nic nie zapisuje), dalej tylko "Dalej" w stopce', () => {
    const fetchMock = stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({
          currentBlockIndex: 1,
          progress: { v: 2, blocks: { odprawa: { type: 'BRIEFING', done: true } }, notes: [] },
        })}
        narrationEnabled={false}
        contentBase="https://cdn.example"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    fireEvent.click(item('Odbierz telefon'));
    fireEvent.click(item('Rozłącz'));
    // Teczka w podglądzie startuje zamknięta.
    expect(screen.getByTestId('briefing-scene')).toHaveAttribute('data-phase', 'closed');
    fireEvent.click(item('Otwórz teczkę'));
    fireEvent.click(item('Zamknij teczkę'));
    expect(screen.queryByRole('button', { name: 'Zabierz legitymację' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('briefing-hotspot')).not.toBeInTheDocument();
    expect(progressCalls(fetchMock)).toHaveLength(0);
  });

  it('obraz sceny się nie wczytał (404): zamiast niewidocznego przedmiotu przycisk cta pod sceną (awaryjna ścieżka)', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} contentBase="https://cdn.example" />);
    fireEvent.error(screen.getByTestId('briefing-scene').querySelector('img')!);
    expect(screen.queryByTestId('briefing-hotspot')).not.toBeInTheDocument();
    fireEvent.click(item('Odbierz telefon'));
    expect(within(screen.getByTestId('briefing-bubble')).getByText('Komisarz Adam Wolski')).toBeInTheDocument();
    // Następny krok ma swój obraz - znów przedmiot na scenie.
    expect(item('Rozłącz')).toBe(screen.getByTestId('briefing-hotspot'));
  });

  it('krok ze sceną BEZ przedmiotu (treść sprzed D-086): przycisk cta pod sceną', () => {
    stubFetch();
    const withoutHotspot: ContentBlock = { ...briefing, steps: [{ ...briefing.steps![0], hotspot: undefined }, ...briefing.steps!.slice(1)] };
    render(<CoursePlayer courseId="course-1" initial={course({ contentBlocks: [withoutHotspot, { type: 'NARRATIVE', id: 'biuro', text: 'Biuro Anny.' }] })} narrationEnabled={false} contentBase="https://cdn.example" />);
    expect(screen.queryByTestId('briefing-hotspot')).not.toBeInTheDocument();
    fireEvent.click(item('Odbierz telefon'));
    expect(item('Rozłącz')).toBe(screen.getByTestId('briefing-hotspot'));
  });
});
