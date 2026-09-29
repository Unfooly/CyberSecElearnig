import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import OsintBlock from './OsintBlock';
import { NotesPanel, NotesProvider } from '../player/notes';
import { HintProvider } from '../player/hints';
import { OverlayStackProvider } from '../player/overlay-stack';
import type { ContentBlock, ResultDetail } from '@/lib/courses-types';

// OSINT (D-120/D-121): zaznaczanie obszarów (aria-pressed), zapis {marked, heard?}, nagranie przy obszarze - transkrypcja doczytana do
// końca = ukryte zakończenie w notatniku, wynik z serwera na tej samej stronie (przeoczone i pułapki z wyjaśnieniem).

const block: ContentBlock = {
  type: 'OSINT_SPOT',
  id: 'osint',
  title: 'Strona firmy',
  prompt: 'Zaznacz, co wykorzystał oszust.',
  image: 'scenes/strona.svg',
  spots: [
    { id: 'pawel', label: 'Paweł Nowicki, helpdesk', x: 8, y: 30, w: 26, h: 34 },
    {
      id: 'webinar',
      label: 'Webinar',
      x: 70,
      y: 30,
      w: 24,
      h: 30,
      media: {
        kind: 'audio',
        title: 'Webinar - Paweł Nowicki',
        narration: { text: 'Dzień dobry.\n...prosimy o ID sesji.' },
        secretEnding: { id: 'off-the-record', label: 'Off the Record', note: 'Usłyszane do końca.' },
      },
    },
    { id: 'godziny', label: 'Godziny otwarcia', x: 70, y: 94, w: 22, h: 5 },
  ],
};

// IntersectionObserver w jsdom nie istnieje - atrapa pozwala „doczytać” transkrypcję do końca.
let observers: { callback: IntersectionObserverCallback; target?: Element }[] = [];
class FakeObserver {
  entry: { callback: IntersectionObserverCallback; target?: Element };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.target = target;
  }
  disconnect() {
    observers = observers.filter((entry) => entry !== this.entry);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Ten sam blok z nagraniem audio (transkrypcja zamknięta od startu, wysłuchane = koniec nagrania).
const withAudio: ContentBlock = {
  ...block,
  spots: block.spots!.map((spot) =>
    spot.media ? { ...spot, media: { ...spot.media, narration: { ...spot.media.narration, audioUrl: 'audio/webinar.mp3' } } } : spot,
  ),
};

function setup(
  result?: { detail?: ResultDetail; points?: number },
  { content = block, disabled = false }: { content?: ContentBlock; disabled?: boolean } = {},
) {
  const onSubmit = vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(
    <OverlayStackProvider>
      <NotesProvider initial={[]}>
        <HintProvider resetKey="k">
          <OsintBlock
            block={content}
            contentBase="/content"
            onSubmit={onSubmit}
            onReady={(submit) => {
              ready.current = submit;
            }}
            disabled={disabled}
            result={result}
          />
          <NotesPanel id="panel" />
        </HintProvider>
      </NotesProvider>
    </OverlayStackProvider>,
  );
  return { onSubmit, ready };
}

function readTranscriptToEnd() {
  const entry = observers.find((candidate) => candidate.target?.getAttribute('data-testid') === 'osint-transcript-end');
  expect(entry).toBeDefined();
  act(() => {
    entry!.callback([{ isIntersecting: true, target: entry!.target! } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

describe('OsintBlock', () => {
  it('zaznaczanie obszarów przełącza aria-pressed; „Dalej” dostępne dopiero po zaznaczeniu, zapis wysyła same id', () => {
    const { onSubmit, ready } = setup();
    expect(ready.current).toBeNull();
    const pawel = screen.getByRole('button', { name: 'Paweł Nowicki, helpdesk' });
    fireEvent.click(pawel);
    expect(pawel).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Godziny otwarcia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Godziny otwarcia' }));
    expect(screen.getByRole('button', { name: 'Godziny otwarcia' })).toHaveAttribute('aria-pressed', 'false');
    expect(ready.current).not.toBeNull();
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ marked: ['pawel'] });
  });

  it('odznaczenie ostatniego obszaru wyłącza zapis', () => {
    const { ready } = setup();
    const pawel = screen.getByRole('button', { name: 'Paweł Nowicki, helpdesk' });
    fireEvent.click(pawel);
    expect(ready.current).not.toBeNull();
    fireEvent.click(pawel);
    expect(ready.current).toBeNull();
  });

  it('nagranie: transkrypcja doczytana do końca = wyróżnienie w notatniku (raz) i `heard` w zapisie; zamknięcie wraca fokusem na przycisk', () => {
    const { onSubmit, ready } = setup();
    const play = screen.getByRole('button', { name: 'Odtwórz: Webinar - Paweł Nowicki' });
    fireEvent.click(play);
    const player = screen.getByTestId('osint-player');
    expect(within(player).getByTestId('osint-transcript')).toHaveTextContent('prosimy o ID sesji');
    expect(within(player).queryByTestId('osint-secret-ending')).toBeNull();
    readTranscriptToEnd();
    readTranscriptToEnd();
    expect(within(player).getByTestId('osint-secret-ending')).toHaveTextContent('Off the Record');
    const distinctions = screen.getByTestId('notebook-distinctions');
    expect(within(distinctions).getAllByText('Off the Record')).toHaveLength(1);
    expect(distinctions).toHaveTextContent('Usłyszane do końca.');

    vi.useFakeTimers();
    try {
      fireEvent.click(within(player).getByRole('button', { name: 'Zamknij nagranie' }));
      act(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByTestId('osint-player')).toBeNull();
    expect(play).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Webinar' }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ marked: ['webinar'], heard: ['off-the-record'] });
  });

  it('nagranie audio: fokus na „Zamknij nagranie”, transkrypcja zamknięta od startu, koniec nagrania = wyróżnienie', () => {
    setup(undefined, { content: withAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odtwórz: Webinar - Paweł Nowicki' }));
    const player = screen.getByTestId('osint-player');
    expect(within(player).getByRole('button', { name: 'Zamknij nagranie' })).toHaveFocus();
    expect(within(player).queryByTestId('osint-transcript')).toBeNull();
    fireEvent.ended(player.querySelector('audio')!);
    expect(within(player).getByTestId('osint-secret-ending')).toHaveTextContent('Off the Record');
    expect(screen.getByTestId('notebook-distinctions')).toHaveTextContent('Off the Record');
    fireEvent.click(within(player).getByRole('button', { name: 'Transkrypcja' }));
    expect(within(player).getByTestId('osint-transcript')).toBeInTheDocument();
  });

  it('Tab w nakładce nagrania krąży po jej elementach', () => {
    setup(undefined, { content: withAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odtwórz: Webinar - Paweł Nowicki' }));
    const player = screen.getByTestId('osint-player');
    const close = within(player).getByRole('button', { name: 'Zamknij nagranie' });
    const last = within(player).getByRole('button', { name: 'Transkrypcja' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
  });

  it('zapis w toku (disabled): obszary zablokowane, zaznaczenie się nie zmienia', () => {
    const { ready } = setup(undefined, { disabled: true });
    const pawel = screen.getByRole('button', { name: 'Paweł Nowicki, helpdesk' });
    expect(pawel).toBeDisabled();
    fireEvent.click(pawel);
    expect(pawel).toHaveAttribute('aria-pressed', 'false');
    expect(ready.current).toBeNull();
  });

  it('w widoku wyniku nagranie da się odsłuchać, ale bez wyróżnienia (blok już zapisany - `heard` nie dotarłby do serwera)', () => {
    setup({ points: 1, detail: { spots: [{ id: 'webinar', used: true, marked: true }] } });
    fireEvent.click(screen.getByRole('button', { name: 'Odtwórz: Webinar - Paweł Nowicki' }));
    readTranscriptToEnd();
    expect(screen.queryByTestId('osint-secret-ending')).toBeNull();
    expect(screen.queryByTestId('notebook-distinctions')).toBeNull();
    expect(screen.getByTestId('osint-status')).toBeEmptyDOMElement();
  });

  it('wynik: podsumowanie z serwera, przeoczone i pułapki z wyjaśnieniem, obszary zablokowane, bez zapisu', () => {
    const { ready } = setup({
      points: 0.25,
      detail: {
        spots: [
          { id: 'pawel', used: true, marked: false },
          { id: 'webinar', used: true, marked: true },
          { id: 'godziny', used: false, marked: true, trapText: 'Godziny otwarcia nic oszustowi nie dały.' },
        ],
      },
    });
    expect(ready.current).toBeNull();
    expect(screen.getByTestId('osint-summary')).toHaveTextContent('Wykorzystane informacje: 1 z 2 · pułapki: 1 · wynik 25%.');
    const explanations = screen.getByTestId('osint-explanations');
    expect(explanations).toHaveTextContent('Paweł Nowicki, helpdesk');
    expect(explanations).toHaveTextContent('Godziny otwarcia nic oszustowi nie dały.');
    expect(screen.getByRole('button', { name: 'Webinar (wykorzystane - zaznaczone)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Godziny otwarcia (pułapka - zaznaczona)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Paweł Nowicki, helpdesk (wykorzystane - przeoczone)' })).toHaveAttribute('aria-pressed', 'false');
  });
});
