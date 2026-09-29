import { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import InterrogationBlock, { InterrogationResult } from './InterrogationBlock';
import { NotesPanel, NotesProvider } from '../player/notes';
import { EvidenceCounter, EvidenceProvider } from '../player/evidence';
import { HintProvider } from '../player/hints';
import { OverlayStackProvider } from '../player/overlay-stack';
import type { ClientNote, ClientProgressBlock, ContentBlock, EvidenceSummary } from '@/lib/courses-types';

// Przesłuchanie (D-118): pytania i kwestie jak w komunikatorze, fragmenty do notatnika, podważanie dowodem z notatnika (/challenge),
// konsola z dokumentami. Testy z prefers-reduced-motion (kwestie po 300 ms - fałszywy zegar).

const block: ContentBlock = {
  type: 'INTERROGATION',
  id: 'przesluchanie',
  title: 'Przesłuchanie Karola',
  character: { name: 'Karol', role: 'handlowiec', opening: 'Myślałem, że pomagam.' },
  questions: [
    {
      id: 'glos',
      text: 'Skąd wiedziałeś, kto dzwoni?',
      required: true,
      lines: [
        { id: 'glos-1', text: 'To był jego głos.', fragment: { evidence: true, note: { text: 'Karol rozpoznał głos.', kind: 'person' } } },
        { id: 'glos-2', text: 'Na wyświetlaczu było IT Helpdesk.' },
      ],
    },
    { id: 'kod', text: 'Czy podawałeś kody?', lines: [{ id: 'kod-1', text: 'Nie, żadnych kodów.' }] },
    { id: 'konsola', text: 'Pokaż konsolę.', required: true, opensDocuments: true, lines: [{ id: 'konsola-1', text: 'Proszę, tu są logowania.' }] },
  ],
  documents: [
    {
      id: 'logowania',
      tab: 'Logowania',
      org: 'KONSOLA',
      title: 'Logowania',
      columns: ['Godzina', 'Zdarzenie'],
      rows: [
        { id: 'l1', cells: ['8:55', 'Odrzucone'] },
        { id: 'l2', cells: ['9:04', 'Zatwierdzone, Amsterdam'], evidence: true, required: true, note: { text: 'Logowanie z Amsterdamu.', kind: 'log' } },
      ],
    },
  ],
};

const NOTES: ClientNote[] = [
  { blockId: 'nagranie', text: 'Dzwoniący sam podał liczbę 47.', kind: 'call', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
  { blockId: 'biuro', text: 'Karteczka z ID sesji.', kind: 'item', ref: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
  // Notatka bez odnośnika (niezapisana przez serwer) nie jest do wyboru.
  { blockId: 'biuro', text: 'Bez odnośnika.' },
];
const SUMMARY: EvidenceSummary = { collected: 2, total: 5, perBlock: [{ blockId: 'przesluchanie', collected: 0, total: 2 }] };

function stubReducedMotion() {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

// Liczby dowodów w stanie jak w CoursePlayer: onEvidence z bloku podmienia summary w EvidenceProvider (lokalne dowody bloku wracają).
function Harness({
  progress,
  notes,
  onSubmit,
  onEvidence,
  onProgress,
  ready,
}: {
  progress?: ClientProgressBlock;
  notes: ClientNote[];
  onSubmit: (answer: unknown) => void;
  onEvidence: (summary: EvidenceSummary) => void;
  onProgress: (patch: Partial<ClientProgressBlock>) => void;
  ready: { current: (() => void) | null };
}) {
  const [summary, setSummary] = useState<EvidenceSummary>(SUMMARY);
  return (
    <OverlayStackProvider>
      <NotesProvider initial={notes} blockTitles={{ nagranie: 'Nagranie', przesluchanie: 'Przesłuchanie' }}>
        <EvidenceProvider summary={summary}>
          <HintProvider resetKey="k">
            <EvidenceCounter />
            <InterrogationBlock
              block={block}
              courseId="kurs-1"
              contentBase="/content"
              onSubmit={onSubmit}
              onReady={(submit) => {
                ready.current = submit;
              }}
              progress={progress}
              onProgress={onProgress}
              onEvidence={(next) => {
                onEvidence(next);
                setSummary(next);
              }}
            />
            <NotesPanel id="panel" />
          </HintProvider>
        </EvidenceProvider>
      </NotesProvider>
    </OverlayStackProvider>
  );
}

function setup(progress?: ClientProgressBlock, notes: ClientNote[] = NOTES) {
  const onSubmit = vi.fn();
  const onEvidence = vi.fn();
  const onProgress = vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(<Harness progress={progress} notes={notes} onSubmit={onSubmit} onEvidence={onEvidence} onProgress={onProgress} ready={ready} />);
  return { onSubmit, onEvidence, onProgress, ready };
}

const flush = () =>
  act(() => {
    vi.advanceTimersByTime(400);
  });
function ask(text: string, lines: number) {
  fireEvent.click(screen.getByRole('button', { name: text }));
  for (let i = 0; i < lines; i += 1) flush();
}
const line = (text: string) => screen.getByRole('button', { name: new RegExp(text) });

describe('InterrogationBlock', () => {
  let restore = () => {};
  const fetchMock = vi.fn();
  beforeEach(() => {
    restore = stubReducedMotion();
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restore();
  });

  it('pytanie i kwestie jak w komunikatorze; fragment „Dodaj do notatek” - notatka i dowód w liczniku', () => {
    setup();
    flush(); // otwarcie
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.click(line('To był jego głos'));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatek' }));
    expect(within(screen.getByRole('complementary', { name: 'Notatnik' })).getByText('Karol rozpoznał głos.')).toBeInTheDocument();
    expect(screen.getByTestId('evidence-counter')).toHaveAccessibleName('Dowody 3 z 5');
    expect(line('To był jego głos')).toHaveTextContent('W notatniku');
    // Zwykła kwestia - bez „Dodaj do notatek”, ale z „Podważ” (klient nie wie, która kwestia kłamie).
    fireEvent.click(line('Na wyświetlaczu'));
    expect(screen.queryByRole('button', { name: 'Dodaj do notatek' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Podważ' })).toBeInTheDocument();
  });

  it('podważenie: wybór dowodu (tylko notatki z odnośnikiem, z innych bloków), trafienie - przyznanie, notatka, liczby dowodów z serwera', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        blockId: 'przesluchanie',
        lineId: 'kod-1',
        correct: true,
        line: { text: '…No tak. Wpisałem liczbę.' },
        note: { blockId: 'przesluchanie', text: 'Karol przyznał się.', kind: 'person', ref: 'cccccccccccccccccccccccc' },
        evidence: { collected: 3, total: 6, perBlock: [] },
      }),
    });
    const { onEvidence, onProgress } = setup();
    flush();
    ask('Czy podawałeś kody?', 1);
    fireEvent.click(line('Nie, żadnych kodów'));
    fireEvent.click(screen.getByRole('button', { name: 'Podważ' }));
    const picker = screen.getByTestId('interrogation-picker');
    const options = within(picker).getAllByTestId('interrogation-evidence');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('liczbę 47'), expect.stringContaining('ID sesji')]);
    await act(async () => {
      fireEvent.click(options[0]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/courses/kurs-1/blocks/przesluchanie/challenge',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ lineId: 'kod-1', noteRef: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) }),
    );
    expect(screen.getByTestId('interrogation-admission')).toHaveTextContent('…No tak. Wpisałem liczbę.');
    expect(within(screen.getByRole('complementary', { name: 'Notatnik' })).getByText('Karol przyznał się.')).toBeInTheDocument();
    expect(onEvidence).toHaveBeenCalledWith({ collected: 3, total: 6, perBlock: [] });
    expect(onProgress).toHaveBeenCalledWith({ type: 'INTERROGATION', challenges: [{ lineId: 'kod-1', correct: true, line: { text: '…No tak. Wpisałem liczbę.' } }] });
    expect(line('Nie, żadnych kodów')).toHaveTextContent('Sprzeczność obalona');
    fireEvent.click(line('Nie, żadnych kodów'));
    // Jedna próba na kwestię - „Podważ” znika.
    expect(screen.queryByRole('button', { name: 'Podważ' })).not.toBeInTheDocument();
  });

  it('pudło: komunikat i oznaczenie kwestii, bez przyznania; klawisz P otwiera wybór dowodu, Esc/Anuluj go zamyka', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ blockId: 'przesluchanie', lineId: 'glos-2', correct: false, evidence: SUMMARY }) });
    setup();
    flush();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.keyDown(line('Na wyświetlaczu'), { key: 'p' });
    expect(screen.getByTestId('interrogation-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj podważenie' }));
    expect(screen.queryByTestId('interrogation-picker')).not.toBeInTheDocument();
    fireEvent.keyDown(line('Na wyświetlaczu'), { key: 'P' });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('interrogation-evidence')[1]);
    });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent('Ten dowód nie podważa tej kwestii.');
    expect(line('Na wyświetlaczu')).toHaveTextContent('Podważona - bez skutku');
    expect(screen.queryByTestId('interrogation-admission')).not.toBeInTheDocument();
  });

  it('klawisz N dodaje fragment do notatnika', () => {
    setup();
    flush();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.keyDown(line('To był jego głos'), { key: 'n' });
    expect(within(screen.getByRole('complementary', { name: 'Notatnik' })).getByText('Karol rozpoznał głos.')).toBeInTheDocument();
  });

  it('konsola: otwiera się po pytaniu; gotowe po wymaganych pytaniach, otwarciu dokumentów i zakreśleniu śladów; odpowiedź dla serwera', () => {
    const { ready, onSubmit } = setup();
    flush();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.click(line('To był jego głos'));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatek' }));
    ask('Pokaż konsolę.', 1);
    const consoleDialog = screen.getByTestId('interrogation-console');
    expect(ready.current).toBeNull();
    fireEvent.click(within(consoleDialog).getByRole('button', { name: /Zatwierdzone, Amsterdam/ }));
    expect(ready.current).not.toBeNull();
    fireEvent.click(within(consoleDialog).getByRole('button', { name: 'Zamknij konsolę' }));
    expect(screen.queryByTestId('interrogation-console')).not.toBeInTheDocument();
    expect(screen.getByTestId('interrogation-console-open')).toHaveTextContent('Konsola ✓');
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['glos', 'konsola'], noted: ['glos-1', 'l2'], opened: ['logowania'] });
  });

  it('po odświeżeniu: pytanie z podważoną kwestią (także nieobowiązkowe) od razu w wątku jako zadane - zapis je zawiera', () => {
    const { ready, onSubmit } = setup({ type: 'INTERROGATION', done: false, challenges: [{ lineId: 'kod-1', correct: true, line: { text: '…No tak.' } }] });
    // Bez pisania: pytanie `kod` i jego kwestie są od razu, z przyznaniem; chipu `kod` już nie ma.
    expect(screen.getByTestId('interrogation-admission')).toHaveTextContent('…No tak.');
    expect(screen.queryByRole('button', { name: 'Czy podawałeś kody?' })).not.toBeInTheDocument();
    fireEvent.click(line('Nie, żadnych kodów'));
    expect(screen.queryByRole('button', { name: 'Podważ' })).not.toBeInTheDocument();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    ask('Pokaż konsolę.', 1);
    fireEvent.click(within(screen.getByTestId('interrogation-console')).getByRole('button', { name: /Zatwierdzone, Amsterdam/ }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ asked: ['kod', 'glos', 'konsola'], noted: ['l2'], opened: ['logowania'] });
  });

  it('licznik dowodów: po trafieniu liczby z serwera + niezapisane dowody bloku (fragment) - nic nie znika', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ blockId: 'przesluchanie', lineId: 'kod-1', correct: true, line: { text: 'Przyznaję.' }, evidence: { collected: 3, total: 6, perBlock: [{ blockId: 'x', collected: 3, total: 6 }] } }),
    });
    setup();
    flush();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.click(line('To był jego głos'));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatek' }));
    expect(screen.getByTestId('evidence-counter')).toHaveAccessibleName('Dowody 3 z 5');
    ask('Czy podawałeś kody?', 1);
    fireEvent.click(line('Nie, żadnych kodów'));
    fireEvent.click(screen.getByRole('button', { name: 'Podważ' }));
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('interrogation-evidence')[0]);
    });
    // 3 z serwera (sprzeczność zebrana) + fragment z tego bloku, jeszcze niezapisany.
    expect(screen.getByTestId('evidence-counter')).toHaveAccessibleName('Dowody 4 z 6');
  });

  it.each([
    ['400 (np. już podważona po zerwanym połączeniu)', { ok: false, status: 400, json: async () => ({ message: 'Ta kwestia była już podważona' }) }, 'Odśwież stronę'],
    ['429', { ok: false, status: 429, json: async () => ({}) }, 'Zbyt wiele prób'],
  ])('błąd /challenge %s: komunikat, arkusz zamknięty, kwestia bez oznaczenia', async (_label, reply, text) => {
    fetchMock.mockResolvedValue(reply);
    setup();
    flush();
    ask('Czy podawałeś kody?', 1);
    fireEvent.click(line('Nie, żadnych kodów'));
    fireEvent.click(screen.getByRole('button', { name: 'Podważ' }));
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('interrogation-evidence')[0]);
    });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent(text);
    expect(screen.queryByTestId('interrogation-picker')).not.toBeInTheDocument();
    expect(line('Nie, żadnych kodów')).not.toHaveTextContent('Podważona');
  });

  it('błąd sieci: komunikat z odświeżeniem; podwójne kliknięcie dowodu wysyła jedno żądanie', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => (resolveFetch = resolve)));
    setup();
    flush();
    ask('Czy podawałeś kody?', 1);
    fireEvent.click(line('Nie, żadnych kodów'));
    fireEvent.click(screen.getByRole('button', { name: 'Podważ' }));
    const option = screen.getAllByTestId('interrogation-evidence')[0];
    fireEvent.click(option);
    fireEvent.click(option);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFetch(Promise.reject(new Error('offline')));
    });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent('Nie udało się połączyć z serwerem. Odśwież stronę');
  });

  it('bez dowodów z odnośnikiem: komunikat zamiast pustego wyboru; N na zwykłej kwestii i P na podważonej - komunikat', () => {
    setup({ type: 'INTERROGATION', done: false, challenges: [{ lineId: 'kod-1', correct: false }] }, [{ blockId: 'biuro', text: 'Bez odnośnika.' }]);
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.keyDown(line('Na wyświetlaczu'), { key: 'p' });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent('W notatniku nie ma jeszcze dowodów');
    expect(screen.queryByTestId('interrogation-picker')).not.toBeInTheDocument();
    fireEvent.keyDown(line('Na wyświetlaczu'), { key: 'n' });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent('Tej kwestii nie da się dodać do notatek.');
    fireEvent.keyDown(line('Nie, żadnych kodów'), { key: 'p' });
    expect(screen.getByTestId('interrogation-status')).toHaveTextContent('Ta kwestia była już podważona.');
  });

  it('fokus: wybór dowodu - na pierwszy dowód, po anulowaniu z powrotem na kwestię; po „Dodaj do notatek” - na kwestię', () => {
    setup();
    flush();
    ask('Skąd wiedziałeś, kto dzwoni?', 2);
    fireEvent.click(line('Na wyświetlaczu'));
    fireEvent.click(screen.getByRole('button', { name: 'Podważ' }));
    expect(screen.getAllByTestId('interrogation-evidence')[0]).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj podważenie' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(line('Na wyświetlaczu')).toHaveFocus();
    fireEvent.click(line('To był jego głos'));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj do notatek' }));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(line('To był jego głos')).toHaveFocus();
  });
});

describe('InterrogationResult', () => {
  it('rozstrzygnięcie: które kwestie kłamały, przyznanie, trafienia i pudła', () => {
    render(
      <InterrogationResult
        block={block}
        detail={{ contradictions: [{ lineId: 'kod-1', line: { text: '…No tak. Wpisałem liczbę.' } }] }}
        challenges={[
          { lineId: 'glos-2', correct: false },
          { lineId: 'kod-1', correct: true },
        ]}
        points={0.5}
      />,
    );
    const result = screen.getByTestId('interrogation-result');
    expect(result).toHaveTextContent('Obalone sprzeczności: 1 z 1 · pudła: 1 · wynik 50%.');
    expect(result).toHaveTextContent('„Nie, żadnych kodów.”');
    expect(result).toHaveTextContent('…No tak. Wpisałem liczbę.');
  });

  it('bez sprzeczności: zeznanie prawdziwe', () => {
    render(<InterrogationResult block={block} detail={{ contradictions: [] }} />);
    expect(screen.getByTestId('interrogation-result')).toHaveTextContent('nie każdy świadek kłamie');
  });
});
