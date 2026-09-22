import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ExploratoryBlock from './ExploratoryBlock';
import { NotesProvider, NotesPanel, useNotes } from '../player/notes';
import { EvidenceCounter, EvidenceProvider, useEvidence } from '../player/evidence';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
import type { ContentBlock, EvidenceSummary } from '@/lib/courses-types';

// Mechaniki "śledztwa": dowody, hotspoty z kartą, dialog po jednej kwestii, rozwiązanie sprawy.

const scene: ContentBlock = {
  type: 'SCENE_HOTSPOTS',
  id: 'scena',
  title: 'Biuro',
  image: 'scenes/office.png',
  imageAlt: 'Biuro',
  hotspots: [
    {
      id: 'h1',
      label: 'Monitor',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      content: 'Kartka z hasłem.',
      required: true,
      evidence: true,
      note: { text: 'Hasło na kartce.', kind: 'item' },
    },
    { id: 'h2', label: 'Drzwi', x: 50, y: 50, width: 20, height: 20, content: 'Drzwi bez zamka.', required: false },
    {
      id: 'h3',
      label: 'Kubek',
      x: 70,
      y: 10,
      width: 10,
      height: 10,
      content: 'Zwykły kubek.',
      required: false,
      evidence: true,
      note: { text: 'Kubek z logo firmy.', kind: 'place' },
    },
  ],
};

const dialogue: ContentBlock = {
  type: 'DIALOGUE',
  id: 'rozmowa',
  title: 'Rozmowa z Anną',
  character: { name: 'Anna', role: 'Księgowa', avatar: 'img/anna.png' },
  questions: [
    {
      id: 'q1',
      text: 'Skąd ten mail?',
      lines: [{ text: 'Przyszedł rano.' }, { text: 'Wyglądał jak od banku.' }, { text: 'Kliknęłam w link.' }],
      note: { text: 'Mail przyszedł rano.', kind: 'mail' },
      evidence: true,
      required: true,
    },
    { id: 'q2', text: 'Kto go wysłał?', answer: 'Nie znam nadawcy.', required: false, note: { text: 'Nieznany nadawca.', kind: 'person' } },
  ],
};

function Probe() {
  const { notes } = useNotes();
  const { reaction } = useMascotReaction();
  return (
    <>
      <output data-testid="notes">{notes.map((n) => `${n.kind ?? '-'}:${n.text}`).join('|')}</output>
      <output data-testid="reaction">{reaction?.pose ?? ''}</output>
    </>
  );
}

function setup(
  block: ContentBlock,
  options: { review?: boolean; summary?: EvidenceSummary; titles?: Record<string, string>; onSubmit?: (a?: unknown) => void } = {},
) {
  const onSubmit = options.onSubmit ?? vi.fn();
  render(
    <NotesProvider initial={[]} blockTitles={options.titles ?? { scena: 'Biuro', rozmowa: 'Rozmowa z Anną' }}>
      <EvidenceProvider summary={options.summary}>
        <MascotReactionProvider resetKey="k">
          <EvidenceCounter />
          <ExploratoryBlock block={block} contentBase="/content" onSubmit={onSubmit} disabled={false} review={options.review} />
          <Probe />
          <NotesPanel id="panel" />
        </MascotReactionProvider>
      </EvidenceProvider>
    </NotesProvider>,
  );
  return onSubmit;
}

const list = () => screen.getByRole('list', { name: 'Elementy sceny' });
const pick = (name: string) => fireEvent.click(within(list()).getByRole('button', { name }));

describe('SCENE_HOTSPOTS: punkty, karta i dowody', () => {
  const summary: EvidenceSummary = { collected: 0, total: 2, perBlock: [{ blockId: 'scena', collected: 0, total: 2 }] };

  it('puls-podpowiedź do pierwszego kliknięcia: potem nakładki są niewidoczne, odkryta ma znacznik', () => {
    setup(scene, { summary });
    expect(screen.getByTestId('hotspot-overlay-h1')).toHaveAttribute('data-state', 'hint');
    expect(screen.getByTestId('hotspot-overlay-h1').className).toContain('motion-safe:animate-pulse');
    expect(screen.getByTestId('hotspot-overlay-h1').className).not.toMatch(/(^|\s)animate-pulse/); // animacja tylko bez prefers-reduced-motion

    pick('Monitor');
    expect(screen.getByTestId('hotspot-overlay-h1')).toHaveAttribute('data-state', 'discovered');
    expect(screen.getByTestId('hotspot-overlay-h2')).toHaveAttribute('data-state', 'hidden');
    expect(screen.getByTestId('hotspot-overlay-h2').className).not.toContain('animate-pulse');
  });

  it('nakładki są aria-hidden i poza kolejnością Tab (jedna ścieżka: lista)', () => {
    setup(scene, { summary });
    const overlay = screen.getByTestId('hotspot-overlay-h1');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveAttribute('tabindex', '-1');
  });

  it('kliknięty punkt otwiera kartę; "Dodaj do notatnika" tylko przy dowodzie, wpis z ikoną rodzaju, licznik i maskotka reagują', () => {
    const onSubmit = setup(scene, { summary });
    pick('Monitor');
    const card = screen.getByTestId('hotspot-card');
    expect(card).toHaveTextContent('Kartka z hasłem.');

    fireEvent.click(within(card).getByRole('button', { name: 'Dodaj do notatnika' }));
    expect(within(card).queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
    expect(within(card).getByText('Dodano do notatnika')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('item:Hasło na kartce.');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');

    // Panel notatnika: grupa z nazwą sceny, ikona (etykieta) rodzaju.
    const panel = screen.getByRole('complementary', { name: 'Notatnik' });
    expect(within(panel).getByRole('region', { name: 'Biuro' })).toHaveTextContent('Przedmiot: Hasło na kartce.');

    pick('Drzwi'); // wymagany tylko Monitor
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1', 'h2'], noted: ['h1'] });
  });

  it('punkt bez evidence nie ma "Dodaj do notatnika"', () => {
    setup(scene, { summary });
    pick('Drzwi');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
  });

  it('ukończenie po wymaganych (required), nie po wszystkich: opcjonalne punkty ("smaczki") nie blokują', () => {
    const onSubmit = setup(scene, { summary });
    expect(screen.getByText('Obejrzano 0 z 1 elementów.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kontynuuj' })).toBeDisabled();
    pick('Monitor');
    expect(screen.getByRole('button', { name: 'Kontynuuj' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    expect(onSubmit).toHaveBeenCalledWith({ visited: ['h1'], noted: [] });
  });

  it('podgląd: brak dodawania do notatnika, brak zmian w notatniku i liczniku', () => {
    setup(scene, { summary, review: true });
    pick('Monitor');
    expect(screen.queryByRole('button', { name: 'Dodaj do notatnika' })).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 0/2');
  });
});

describe('DIALOGUE: kwestie po jednej', () => {
  it('odpowiedź pojawia się kwestia po kwestii (klik "Dalej"); pytanie liczy się po ostatniej, wtedy notatka i dowód', () => {
    const onSubmit = setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));

    expect(screen.getByText('Przyszedł rano.')).toBeInTheDocument();
    expect(screen.queryByText('Wyglądał jak od banku.')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Kontynuuj' })).toBeDisabled();
    expect(screen.getByText('Zadano 0 z 1 pytań.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByText('Wyglądał jak od banku.')).toBeInTheDocument();
    expect(screen.queryByText('Kliknęłam w link.')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByText('Kliknęłam w link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Następna kwestia' })).not.toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('mail:Mail przyszedł rano.');
    expect(screen.getByTestId('reaction')).toHaveTextContent('cheer');
    // Zadane pytanie ma znacznik ✓ jak odkryte hotspoty; licznik "Zadano".
    expect(within(screen.getByRole('list', { name: 'Pytania do zadania' })).getByRole('button', { name: /Skąd ten mail/ })).toHaveTextContent('✓');
    expect(screen.getByText('Wszystkie wymagane pytania zadane.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' }));
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('podczas rozmowy inne pytania są nieaktywne, po niej znów dostępne; odpowiedź bez lines to jedna kwestia', () => {
    setup(dialogue);
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    const other = screen.getByRole('button', { name: 'Kto go wysłał?' });
    expect(other).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(other);
    expect(screen.queryByText('Nie znam nadawcy.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' }));
    expect(screen.getByRole('button', { name: 'Kto go wysłał?' })).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Kto go wysłał?' }));
    expect(screen.getByText('Nie znam nadawcy.')).toBeInTheDocument();
    expect(screen.getByTestId('notes')).toHaveTextContent('person:Nieznany nadawca.');
    // Notatka bez evidence nie rusza licznika (brak reakcji poza tą z q1).
  });

  it('porzucona rozmowa nie liczy się: bez ostatniej kwestii pytanie nie jest w odpowiedzi', () => {
    const onSubmit = setup(dialogue); // q1 (3 kwestie) jest wymagane
    fireEvent.click(screen.getByRole('button', { name: 'Skąd ten mail?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Następna kwestia' })); // 2 z 3 kwestii i koniec
    expect(screen.getByRole('button', { name: 'Kontynuuj' })).toBeDisabled();
    expect(screen.getByTestId('notes')).toHaveTextContent('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('porzucone w połowie pytanie OPCJONALNE nie trafia do odpowiedzi, ukończone tak', () => {
    const block: ContentBlock = {
      ...dialogue,
      questions: [
        { id: 'q1', text: 'Pierwsze?', answer: 'Tak.', required: true },
        { id: 'q2', text: 'Drugie?', lines: [{ text: 'Raz.' }, { text: 'Dwa.' }], required: false },
      ],
    };
    const onSubmit = setup(block);
    fireEvent.click(screen.getByRole('button', { name: 'Pierwsze?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drugie?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kontynuuj' })); // wymagane q1 zrobione, q2 w połowie
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['q1'] });
  });

  it('avatar tylko przez <img> z bazy zasobów; niepoprawna ścieżka = brak obrazu', () => {
    const { unmount } = render(
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <MascotReactionProvider resetKey="k">
            <ExploratoryBlock block={dialogue} contentBase="/content" onSubmit={() => {}} disabled={false} />
          </MascotReactionProvider>
        </EvidenceProvider>
      </NotesProvider>,
    );
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', '/content/img/anna.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    unmount();

    render(
      <NotesProvider initial={[]}>
        <EvidenceProvider summary={undefined}>
          <MascotReactionProvider resetKey="k">
            <ExploratoryBlock
              block={{ ...dialogue, character: { name: 'Anna', avatar: 'https://evil.example/a.png' } }}
              contentBase="/content"
              onSubmit={() => {}}
              disabled={false}
            />
          </MascotReactionProvider>
        </EvidenceProvider>
      </NotesProvider>,
    );
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('SUMMARY: rozwiązanie sprawy', () => {
  const summary: EvidenceSummary = {
    collected: 3,
    total: 6,
    perBlock: [
      { blockId: 'scena', collected: 1, total: 3 },
      { blockId: 'rozmowa', collected: 2, total: 2 },
      { blockId: 'mail', collected: 0, total: 1 },
    ],
  };

  it('zebrane vs wszystkie, przeoczone tylko liczbowo per scena (bez treści), przycisk "Zakończ sprawę"', () => {
    const onSubmit = setup({ type: 'SUMMARY', id: 's', text: 'Wnioski: zawsze sprawdzaj nadawcę.' }, { summary, titles: { scena: 'Biuro', rozmowa: 'Rozmowa z Anną', mail: 'Analiza maila' } });
    const evidence = screen.getByTestId('case-evidence');
    expect(evidence).toHaveTextContent('Zebrane dowody: 3 z 6');
    expect(evidence).toHaveTextContent('Biuro: 1 z 3 (2 dowody w tej scenie pozostały nieodkryte)');
    expect(evidence).toHaveTextContent('Rozmowa z Anną: 2 z 2');
    expect(evidence).not.toHaveTextContent('Rozmowa z Anną: 2 z 2 (');
    expect(evidence).toHaveTextContent('Analiza maila: 0 z 1 (1 dowód w tej scenie pozostał nieodkryty)');
    // Ani nazwy, ani treści przeoczonych elementów (tekst notatek hotspotów, których nie zebrano, nie trafia do klienta w ogóle).
    expect(evidence.textContent).not.toMatch(/Kubek|Drzwi|Monitor/);
    expect(screen.getByText('Wnioski: zawsze sprawdzaj nadawcę.')).toBeInTheDocument();
    expect(screen.getByText('Wynik z zadań zobaczysz po zakończeniu sprawy.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zakończ szkolenie' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zakończ sprawę' }));
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('liczba mnoga: 1 dowód, 2-4 dowody, 5+ dowodów, 12 dowodów', () => {
    setup(
      { type: 'SUMMARY', id: 's' },
      {
        summary: {
          collected: 0,
          total: 24,
          perBlock: [
            { blockId: 'a', collected: 0, total: 1 },
            { blockId: 'b', collected: 0, total: 4 },
            { blockId: 'c', collected: 0, total: 5 },
            { blockId: 'd', collected: 0, total: 12 },
          ],
        },
        titles: { a: 'A', b: 'B', c: 'C', d: 'D' },
      },
    );
    const text = screen.getByTestId('case-evidence').textContent ?? '';
    expect(text).toContain('1 dowód w tej scenie pozostał nieodkryty');
    expect(text).toContain('4 dowody w tej scenie pozostały nieodkryte');
    expect(text).toContain('5 dowodów w tej scenie pozostało nieodkrytych');
    expect(text).toContain('12 dowodów w tej scenie pozostało nieodkrytych');
  });

  it('bez dowodów w module: "Zakończ szkolenie", bez sekcji dowodów', () => {
    setup({ type: 'SUMMARY', id: 's', text: 'Dziękujemy.' });
    expect(screen.queryByTestId('case-evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zakończ szkolenie' })).toBeInTheDocument();
  });
});

describe('EvidenceCounter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const withSummary = (summary: EvidenceSummary | undefined) => (
    <EvidenceProvider summary={summary}>
      <EvidenceCounter />
    </EvidenceProvider>
  );
  const s = (collected: number, total: number): EvidenceSummary => ({ collected, total, perBlock: [{ blockId: 'a', collected, total }] });

  it('nie pokazuje się w module bez dowodów', () => {
    render(withSummary(undefined));
    expect(screen.queryByTestId('evidence-counter')).not.toBeInTheDocument();
  });

  it('nowy dowód: krótkie +1 (znika po chwili), animacja tylko motion-safe; brak +1 przy pierwszym renderze', () => {
    const { rerender } = render(withSummary(s(1, 5)));
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/5');
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();

    rerender(withSummary(s(2, 5)));
    const plusOne = screen.getByTestId('evidence-plus-one');
    expect(plusOne.className).toContain('motion-safe:animate-bounce');
    expect(plusOne.className).not.toMatch(/(^|\s)animate-/);
    // "+1" jest W WIERSZU licznika (zarezerwowane miejsce, nie pozycjonowane absolutnie poza pasek postępu).
    expect(screen.getByTestId('evidence-counter')).toContainElement(plusOne);
    expect(plusOne.className).not.toContain('absolute');
    expect(plusOne.parentElement?.className).not.toContain('absolute');
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 2/5');

    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();
  });

  it('po zapisie bloku (nowe liczby z serwera) dowód lokalny nie liczy się podwójnie i nie daje drugiego +1', () => {
    let add: (key: string) => void = () => {};
    function Grab() {
      add = useEvidence().addPending;
      return null;
    }
    const tree = (summary: EvidenceSummary) => (
      <EvidenceProvider summary={summary}>
        <EvidenceCounter />
        <Grab />
      </EvidenceProvider>
    );
    const { rerender } = render(tree(s(0, 2)));

    act(() => add('scena.h1')); // dowód w niezapisanym bloku: 1/2 i jedno +1
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.getAllByTestId('evidence-plus-one')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1700);
    });

    rerender(tree(s(1, 2))); // serwer zapisał blok: te same liczby, bez podwójnego liczenia i bez nowego +1
    expect(screen.getByTestId('evidence-counter')).toHaveTextContent('Dowody 1/2');
    expect(screen.queryByTestId('evidence-plus-one')).not.toBeInTheDocument();
  });
});
