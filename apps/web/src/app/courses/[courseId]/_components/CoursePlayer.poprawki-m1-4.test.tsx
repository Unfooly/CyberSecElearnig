import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Czwarta runda poprawek właściciela modułu 1 (D-186, D-187, 2026-11-20): okno przeglądarki wbudowane w ekran monitora, teczka o stałej
// wysokości, teczka i gazeta w kolorach Unfooly, akcja bloku („Sprawdź…”) w miejscu „Dalej”, bez „Zabierz”/„Odłóż”.

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

function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS', currentBlockIndex: 1, score: null, completedAt: null, lastResult: { blockIndex: 0, type: 'QUIZ', correct: true }, gamification: null }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('CoursePlayer: poprawki modułu 1, runda 4 (D-186, D-187)', () => {
  it('domena: okno przeglądarki w prostokącie ekranu monitora na tle (backgroundScreen) - zmienne ekranu na scenie', () => {
    stubFetch();
    const domain: ContentBlock = {
      type: 'TEXT_INPUT_GUIDED',
      id: 'domena',
      prompt: 'Znajdź domenę.',
      frame: 'monitor',
      markUrl: 'https://fundacja.przyklad-online.net/rejestracja/1',
      background: 'assets/m/pulpit.1.webp',
      backgroundScreen: { x: 17.64, y: 18.96, width: 65.08, height: 51.3 },
      maxAttempts: 4,
      hintCount: 3,
    };
    render(<CoursePlayer courseId="course-1" initial={course([domain])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const stage = screen.getByTestId('desktop-stage');
    expect(stage).toHaveAttribute('data-screen', 'true');
    expect(stage.style.getPropertyValue('--screen-left')).toBe('17.64%');
    expect(stage.style.getPropertyValue('--screen-height')).toBe('51.3%');
    expect(within(stage).getByTestId('desktop-window')).toContainElement(screen.getByTestId('browser-window'));
  });

  it('teczka na biurku: stała wysokość (kartka przewija się w środku), kolory Unfooly i biała pieczątka', () => {
    stubFetch();
    const tabs: ContentBlock = {
      type: 'TABS',
      id: 'teczka',
      look: 'folder',
      stamp: 'ŚCIŚLE TAJNE',
      background: 'assets/m/biurko.1.webp',
      tabs: [
        { id: 'a', title: 'Krótka', content: 'Jedno zdanie.' },
        { id: 'b', title: 'Długa', content: 'Akapit.\n\nAkapit.\n\nAkapit.\n\nAkapit.\n\nAkapit.' },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([tabs])} narrationEnabled={false} contentBase="https://content.example.test" />);
    const folder = screen.getByTestId('folder');
    expect(folder.className).toMatch(/bg-accent/);
    expect(folder.className).toMatch(/flex-1/);
    expect(screen.getByTestId('folder-column').className).toMatch(/h-full/);
    expect(screen.getByTestId('folder-sheet').className).toMatch(/overflow-y-auto/);
    expect(screen.getByTestId('folder-sheet').className).not.toMatch(/min-h-\[220px\]/);
    expect(screen.getByTestId('folder-stamp').className).toMatch(/text-white/);
    fireEvent.click(screen.getByRole('tab', { name: 'Długa' }));
    expect(screen.getByTestId('folder-sheet').className).toMatch(/flex-1/);
  });

  it('gazeta po otwarciu w kolorach Unfooly: winieta na fioletowym pasku, biała strona', async () => {
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
          x: 20,
          y: 20,
          width: 34,
          height: 66,
          content: 'Artykuł.',
          media: { kind: 'document', look: 'newspaper', masthead: 'Kurier Cyfrowy', title: 'Nagłówek', lines: ['Lead.', 'Akapit.'] },
        },
      ],
    };
    render(<CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} />);
    fireEvent.click(screen.getByTestId('hotspot-overlay-artykul'));
    const page = await screen.findByTestId('newspaper-page');
    expect(page.className).toMatch(/bg-surface/);
    expect(page.querySelector('header')!.className).toMatch(/bg-accent/);
    // Bez „Zabierz”/„Odłóż” (D-187) - zamyka „Zamknij”.
    expect(screen.queryByRole('button', { name: /Zabierz|Odłóż/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    await waitFor(() => expect(screen.queryByTestId('newspaper-page')).toBeNull());
  });

  it('quiz: „Wybierz odpowiedź” w miejscu „Dalej” - nieaktywny bez wyboru, po wyborze wysyła odpowiedź; w bloku brak własnego przycisku', async () => {
    const fetchMock = stubFetch();
    const quiz: ContentBlock = { type: 'QUIZ', id: 'zaufanie', prompt: 'Czy link jest godny zaufania?', options: [{ text: 'Tak' }, { text: 'Nie' }] };
    render(<CoursePlayer courseId="course-1" initial={course([quiz])} narrationEnabled={false} />);
    const action = screen.getByRole('button', { name: /^Wybierz odpowiedź/ });
    expect(action).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Dalej/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Wybierz odpowiedź/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Nie' }));
    expect(screen.getByRole('button', { name: /^Wybierz odpowiedź/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Wybierz odpowiedź/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string).answer).toBe(1);
    // Po odpowiedzi (wynik) pasek wraca do „Dalej”.
    expect(await screen.findByRole('button', { name: /^Dalej/ })).toBeEnabled();
  });

  it('akcja bloku w pasku: Enter i → (skrót „Dalej”) NIE wysyłają odpowiedzi - tylko świadomy klik (odpowiedzi nie da się cofnąć)', async () => {
    const fetchMock = stubFetch();
    const mail: ContentBlock = {
      type: 'EMAIL_ANALYSIS',
      id: 'zaproszenie',
      frame: 'monitor',
      prompt: 'Jakie cechy?',
      email: { fromName: 'F', fromAddress: 'k@f.test', subject: 'Zaproszenie', body: 'Treść.', links: [] },
      criteria: [{ id: 'c1', label: 'Oferta' }],
    };
    render(<CoursePlayer courseId="course-1" initial={course([mail])} narrationEnabled={false} />);
    expect(screen.getByRole('button', { name: /^Sprawdź odpowiedź/ })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 450)); // po karencji skrótu
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('podgląd „Wstecz” przy bieżącym bloku z akcją: w pasku „Dalej” (nawigacja), po powrocie znów akcja bieżącego bloku', () => {
    stubFetch();
    const done: ContentBlock = { type: 'QUIZ', id: 'q0', prompt: 'Wcześniejsze?', options: [{ text: 'A' }, { text: 'B' }] };
    const current: ContentBlock = { type: 'QUIZ', id: 'q1', prompt: 'Bieżące?', options: [{ text: 'A' }, { text: 'B' }] };
    render(
      <CoursePlayer
        courseId="course-1"
        narrationEnabled={false}
        initial={{
          ...course([done, current]),
          currentBlockIndex: 1,
          progress: { v: 2, blocks: { q0: { type: 'QUIZ', done: true, correct: true, points: 1 } }, notes: [] },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^Wybierz odpowiedź/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    expect(screen.getByRole('button', { name: /^Dalej/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Wybierz odpowiedź/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Dalej/ }));
    expect(screen.getByRole('button', { name: /^Wybierz odpowiedź/ })).toBeDisabled();
  });

  it('StrictMode (dev): dowód zebrany przy otwarciu trafia do `noted` raz - bez duplikatu (API odrzuca duplikat)', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    try {
      const fetchMock = stubFetch();
      const scene: ContentBlock = {
        type: 'SCENE_HOTSPOTS',
        id: 'scena',
        image: 'img/biuro.webp',
        imageAlt: 'Biuro',
        hotspots: [{ id: 'h1', label: 'Monitor', x: 5, y: 5, width: 20, height: 20, content: 'Kartka.', evidence: true, note: { text: 'Hasło.', kind: 'item' }, required: true }],
      };
      render(
        <StrictMode>
          <CoursePlayer courseId="course-1" initial={course([scene])} narrationEnabled={false} persistExploration={false} />
        </StrictMode>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
      fireEvent.click(screen.getByRole('button', { name: /^Dalej/ }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string);
      expect(body.answer).toEqual({ visited: ['h1'], noted: ['h1'] });
    } finally {
      window.matchMedia = original;
    }
  });
});
