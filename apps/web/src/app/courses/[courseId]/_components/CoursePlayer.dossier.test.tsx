import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoursePlayer, { type CoursePlayerInitialState } from './CoursePlayer';
import type { ContentBlock } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Teczka sprawy (DOSSIER, schemaVersion 5, D-083): przekładki, zakreślanie dowodów, zwykła linijka, odpowiedź { opened, noted }.

const dossier: ContentBlock = {
  type: 'DOSSIER',
  id: 'akta',
  title: 'Teczka sprawy',
  stamp: 'POUFNE',
  documents: [
    {
      id: 'wyciag',
      tab: 'Wyciąg bankowy',
      org: 'BANK WEKTOR',
      title: 'Wyciąg z rachunku',
      meta: 'Rachunek firmowy',
      columns: ['Godzina', 'Opis', 'Kwota'],
      rows: [
        { id: 'w1', cells: ['08:02', 'Opłata za kartę', '−5,00 PLN'] },
        { id: 'w2', cells: ['09:12', 'Wektor Rozliczenia', '−14 000,00 PLN'], evidence: true, required: true, note: { text: 'Przelew 9:12.', kind: 'item' } },
      ],
    },
    {
      id: 'logi',
      tab: 'Logi logowania',
      org: 'BANK WEKTOR',
      title: 'Logowania',
      columns: ['Godzina', 'Zdarzenie'],
      rows: [
        { id: 'l1', cells: ['07:58', 'Logowanie, Kraków'] },
        { id: 'l2', cells: ['08:53', 'Logowanie, Bukareszt'], evidence: true, note: { text: 'Bukareszt 8:53.', kind: 'place' } },
      ],
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
    contentBlocks: [dossier, { type: 'NARRATIVE', id: 'dalej', text: 'Rozmowa z IT.' }],
    progress: { v: 2, blocks: {}, notes: [], evidence: { collected: 0, total: 2, perBlock: [{ blockId: 'akta', collected: 0, total: 2 }] } },
    score: null,
    ...overrides,
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      assignmentId: 'a1',
      status: 'IN_PROGRESS',
      currentBlockIndex: 1,
      score: null,
      completedAt: null,
      lastResult: { blockIndex: 0, blockId: 'akta', type: 'DOSSIER' },
      gamification: null,
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const row = (text: string) => screen.getByText(text).closest('button')!;

describe('CoursePlayer: teczka sprawy (DOSSIER)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('zwykła linijka: komunikat i brak zaznaczenia; wiersz-dowód: zakreślony, notatka w notatniku, licznik +1', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    expect(screen.getByText('POUFNE')).toHaveTextContent('Pieczątka: POUFNE');
    expect(screen.getByText('08:02')).toHaveClass('font-bold');

    fireEvent.click(row('Opłata za kartę'));
    expect(screen.getByRole('status')).toHaveTextContent('Ta linijka wygląda na zwykłą operację.');
    expect(row('Opłata za kartę')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/2');

    fireEvent.click(row('Wektor Rozliczenia'));
    expect(row('Wektor Rozliczenia')).toHaveAttribute('aria-pressed', 'true');
    expect(row('Wektor Rozliczenia')).toHaveClass('bg-highlight');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getByRole('button', { name: /Notatnik \(1\)/ })).toBeInTheDocument();
    // Drugi klik niczego nie dubluje.
    fireEvent.click(row('Wektor Rozliczenia'));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
  });

  it('"Dalej" dopiero po otwarciu wszystkich dokumentów i zakreśleniu wymaganych; odpowiedź { opened, noted }', async () => {
    const fetchMock = stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    const next = () => screen.getByRole('button', { name: /^Dalej$/ });
    expect(next()).toBeDisabled();

    fireEvent.click(row('Wektor Rozliczenia'));
    expect(next()).toBeDisabled(); // drugi dokument nieotwarty
    fireEvent.click(screen.getByRole('tab', { name: 'Logi logowania' }));
    expect(screen.getByRole('tab', { name: 'Logi logowania' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(row('Logowanie, Bukareszt')); // dowód nieobowiązkowy
    expect(next()).toBeEnabled();

    fireEvent.click(next());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      blockIndex: 0,
      answer: { opened: ['wyciag', 'logi'], noted: ['w2', 'l2'] },
    });
  });

  it('przekładki klawiaturą (strzałki, Home/End), roving tabindex; arkusz przewija tylko listę wierszy', () => {
    stubFetch();
    render(<CoursePlayer courseId="course-1" initial={course()} narrationEnabled={false} />);
    const tabs = within(screen.getByRole('tablist', { name: 'Dokumenty w teczce' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1']);
    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: 'Home' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('dossier-rows')).toHaveClass('overflow-y-auto');
  });

  it('podgląd ukończonej teczki ("Wstecz"): zakreślenie niczego nie zapisuje ani nie dopisuje notatek', () => {
    const fetchMock = stubFetch();
    render(
      <CoursePlayer
        courseId="course-1"
        initial={course({ currentBlockIndex: 1, progress: { v: 2, blocks: { akta: { type: 'DOSSIER', done: true } }, notes: [] } })}
        narrationEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Wstecz/ }));
    fireEvent.click(row('Wektor Rozliczenia'));
    expect(screen.getByRole('status')).toHaveTextContent('zakreślenia się nie zapisują');
    expect(screen.getByRole('button', { name: /Notatnik \(0\)/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
