import { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import LiveCallBlock, { walkLiveCall } from './LiveCallBlock';
import { HintProvider } from '../player/hints';
import { OverlayStackProvider, useOverlayLayer } from '../player/overlay-stack';
import type { ContentBlock, LiveCallContent, ResultDetail } from '@/lib/courses-types';

// Rozmowa na żywo (D-122/D-123): ekran przed połączeniem z przełącznikiem limitu, kwestie i odpowiedzi (klawisze 1-4), cisza po limicie,
// zapis `{ path, timed }` po zakończeniu, wynik z transkrypcją i rozstrzygnięciem serwera.

const content: LiveCallContent = {
  caller: { display: 'IT Helpdesk', number: '12 3XX XX 41' },
  choiceTimeLimitSec: 12,
  start: 'start',
  nodes: [
    {
      id: 'start',
      narration: { text: 'Wpisz w aplikacji 62.' },
      choices: [
        { id: 'oddzwonie', text: 'Oddzwonię na numer z intranetu.', next: '#koniec-a' },
        { id: 'jaka-liczba', text: 'Jaką liczbę mam wpisać?', next: 'nacisk' },
      ],
      silence: 'nacisk',
    },
    {
      id: 'nacisk',
      narration: { text: '62, szybko!' },
      choices: [
        { id: 'rozlaczam', text: 'Rozłączam się.', next: '#koniec-a' },
        { id: 'wpisuje', text: 'Wpisuję 62.', next: '#koniec-c' },
      ],
    },
  ],
  endings: [
    { id: 'koniec-a', narration: { text: 'Paweł: nie dzwoniłem.' } },
    { id: 'koniec-c', narration: { text: 'Zatwierdziłeś jego logowanie.' } },
  ],
};
const block = { id: 'na-zywo', type: 'LIVE_CALL', title: 'Telefon', ...content } as unknown as ContentBlock;

// jsdom nie implementuje odtwarzania - pause() przy odmontowaniu nagrania (także po teście) atrapą w całym pliku.
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Notatnik jako warstwa zasłaniająca (overlay-stack) - przełączany przyciskiem w teście.
function Notebook() {
  const [open, setOpen] = useState(false);
  useOverlayLayer('notebook', open, () => setOpen(false));
  return (
    <button type="button" onClick={() => setOpen((value) => !value)}>
      Notatnik {open ? 'otwarty' : 'zamknięty'}
    </button>
  );
}

function setup(
  props: {
    result?: { detail?: ResultDetail; answer?: { path: string[]; timed: boolean }; points?: number };
    noTimeLimitDefault?: boolean;
    disabled?: boolean;
    block?: ContentBlock;
  } = {},
) {
  const onSubmit = vi.fn();
  const ready: { current: (() => void) | null } = { current: null };
  render(
    <OverlayStackProvider>
      <HintProvider resetKey="k">
        <Notebook />
        <LiveCallBlock
          block={block}
          contentBase="/content"
          onSubmit={onSubmit}
          onReady={(submit) => {
            ready.current = submit;
          }}
          {...props}
        />
      </HintProvider>
    </OverlayStackProvider>,
  );
  return { onSubmit, ready };
}

const withAudio = {
  ...block,
  nodes: content.nodes.map((node) => ({ ...node, narration: { ...node.narration, audioUrl: `audio/${node.id}.mp3`, durationMs: 2000 } })),
} as unknown as ContentBlock;

describe('LiveCallBlock', () => {
  it('ekran przed połączeniem: dzwoniący, przełącznik limitu (domyślnie wyłączony), „Odbierz” otwiera rozmowę', () => {
    setup();
    expect(screen.getByTestId('live-call-caller')).toHaveTextContent('IT Helpdesk');
    expect(screen.getByRole('switch', { name: /Wyłącz limit czasu/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('Wpisz w aplikacji 62.');
    expect(screen.getAllByTestId('live-call-choice')).toHaveLength(2);
  });

  it('konto z „Bez limitów czasu” (D-124): bez przełącznika i bez odliczania - limitu nie da się włączyć (serwer i tak odrzuciłby ciszę)', () => {
    vi.useFakeTimers();
    const { onSubmit, ready } = setup({ noTimeLimitDefault: true });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByTestId('live-call-no-limit-account')).toHaveTextContent('Bez limitu czasu');
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['oddzwonie'], timed: false });
  });

  it('odpowiedzi prowadzą przez drzewo; po zakończeniu „Dalej” zapisuje ścieżkę i tryb czasu', () => {
    const { onSubmit, ready } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(ready.current).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Jaką liczbę mam wpisać/ }));
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('62, szybko!');
    fireEvent.click(screen.getByRole('button', { name: /Rozłączam się/ }));
    expect(screen.getByTestId('live-call-ending')).toHaveTextContent('Paweł: nie dzwoniłem.');
    expect(screen.getByTestId('live-call-transcript')).toHaveTextContent('Jaką liczbę mam wpisać?');
    expect(ready.current).not.toBeNull();
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['jaka-liczba', 'rozlaczam'], timed: true });
  });

  it('klawisze 1-4 wybierają odpowiedź', () => {
    const { onSubmit, ready } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.keyDown(document, { key: '1' });
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['oddzwonie'], timed: true });
  });

  it('klawisze nie działają przy otwartym notatniku, z pola edycji ani przy przytrzymanym klawiszu', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: /Notatnik zamknięty/ }));
    fireEvent.keyDown(document, { key: '1' });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('Wpisz w aplikacji 62.');
    fireEvent.click(screen.getByRole('button', { name: /Notatnik otwarty/ }));
    fireEvent.keyDown(document, { key: '2', repeat: true });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('Wpisz w aplikacji 62.');
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '2' });
    input.remove();
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('Wpisz w aplikacji 62.');
    fireEvent.keyDown(document, { key: '2' });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('62, szybko!');
  });

  it('po zakończeniu fokus na zakończeniu (klawiatura nie gubi miejsca)', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.getAllByTestId('live-call-choice')[0]).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    expect(screen.getByTestId('live-call-ending')).toHaveFocus();
  });

  it('zapis w toku (disabled): „Odbierz” zablokowane - rozmowa się nie zaczyna', () => {
    setup({ disabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.getByTestId('live-call')).toHaveAttribute('data-stage', 'ring');
  });

  it('rozmowa bez krawędzi ciszy: bez przełącznika i odliczania, zapis z timed: false', () => {
    const noSilence = { ...block, nodes: content.nodes.map(({ silence: _silence, ...node }) => node) } as unknown as ContentBlock;
    const { onSubmit, ready } = setup({ block: noSilence });
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['oddzwonie'], timed: false });
  });

  it('nagranie kwestii: limit rusza dopiero po końcu nagrania; „Wycisz” wycisza kwestie i zakończenie', async () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const withEndingAudio = {
      ...withAudio,
      endings: content.endings.map((ending) => ({ ...ending, narration: { ...ending.narration, audioUrl: `audio/${ending.id}.mp3` } })),
    } as unknown as ContentBlock;
    setup({ block: withEndingAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(play).toHaveBeenCalled();
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Wycisz' }));
    expect((screen.getByTestId('live-call-audio') as HTMLAudioElement).muted).toBe(true);
    fireEvent.ended(screen.getByTestId('live-call-audio'));
    expect(screen.getByTestId('live-call-timer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    expect(screen.getByTestId('live-call-ending')).toBeInTheDocument();
    expect((screen.getByTestId('live-call-audio') as HTMLAudioElement).muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Wycisz' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('nagranie zablokowane przez przeglądarkę (odrzucone play()): limit rusza mimo to', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    setup({ block: withAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('live-call-timer')).toBeInTheDocument();
  });

  it('nagranie zawieszone (bez końca i bez błędu): limit po długości kwestii + zapas', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(() => {}));
    setup({ block: withAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByTestId('live-call-timer')).toBeInTheDocument();
  });

  it('wolne ładowanie: zapas liczony od nowa od startu odtwarzania (playing)', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(() => {}));
    setup({ block: withAudio });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // Nagranie ruszyło po 4 s ładowania: 2 s kwestii + 3 s zapasu liczone od teraz.
    fireEvent.playing(screen.getByTestId('live-call-audio'));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByTestId('live-call-timer')).toBeInTheDocument();
  });

  it('odrzucone play() po przejściu do następnej kwestii (z ciszą) nie uruchamia jej limitu', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let rejectFirst: (reason: unknown) => void = () => {};
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
      .mockImplementation(() => new Promise(() => {}));
    // Węzeł „nacisk” dostaje krawędź ciszy - bez strażnika `cancelled` odrzucenie z poprzedniej kwestii uruchomiłoby jego limit.
    const naciskWithSilence = {
      ...withAudio,
      nodes: (withAudio as unknown as LiveCallContent).nodes.map((node, i) => (i === 1 ? { ...node, silence: '#koniec-c' } : node)),
    } as unknown as ContentBlock;
    setup({ block: naciskWithSilence });
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    fireEvent.click(screen.getByRole('button', { name: /Jaką liczbę/ }));
    await act(async () => {
      rejectFirst(new Error('AbortError'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('62, szybko!');
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
  });

  it('limit czasu: po kwestii odlicza, po upływie cisza prowadzi dalej; węzeł bez krawędzi ciszy nie odlicza', () => {
    vi.useFakeTimers();
    const { onSubmit, ready } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.getByTestId('live-call-timer')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(12_100);
    });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('62, szybko!');
    expect(screen.getByTestId('live-call-transcript')).toHaveTextContent('Cisza…');
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Wpisuję 62/ }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['silence', 'wpisuje'], timed: true });
  });

  it('„Wyłącz limit czasu”: bez odliczania, zapis z timed: false', () => {
    vi.useFakeTimers();
    const { onSubmit, ready } = setup();
    fireEvent.click(screen.getByRole('switch', { name: /Wyłącz limit czasu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz' }));
    expect(screen.queryByTestId('live-call-timer')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('live-call-line')).toHaveTextContent('Wpisz w aplikacji 62.');
    fireEvent.click(screen.getByRole('button', { name: /Oddzwonię/ }));
    act(() => ready.current!());
    expect(onSubmit).toHaveBeenCalledWith({ path: ['oddzwonie'], timed: false });
  });

  it('wynik: rozmowa odtworzona ze ścieżki, zakończenie, ocena z serwera i odpowiedź, która oddała informację', () => {
    const { ready } = setup({
      result: { answer: { path: ['silence', 'wpisuje'], timed: true }, detail: { ending: 'koniec-c', outcome: 'bad', gaveInfo: ['wpisuje'] }, points: 0 },
    });
    expect(ready.current).toBeNull();
    expect(screen.getByTestId('live-call-outcome')).toHaveTextContent('Oszust dopiął swego');
    const transcript = screen.getByTestId('live-call-transcript');
    expect(transcript).toHaveTextContent('Wpisz w aplikacji 62.');
    expect(transcript).toHaveTextContent('Cisza…');
    expect(within(transcript).getByTestId('live-call-gave-info')).toHaveTextContent('Tu oddałeś informację.');
    expect(screen.getByTestId('live-call-ending')).toHaveTextContent('Zatwierdziłeś jego logowanie.');
    expect(screen.queryByTestId('live-call-choice')).toBeNull();
  });

  it('walkLiveCall: transkrypcja i zakończenie ze ścieżki; niezgodna ścieżka - bez zakończenia', () => {
    expect(walkLiveCall(content, ['oddzwonie'])).toEqual({
      lines: [
        { who: 'caller', text: 'Wpisz w aplikacji 62.' },
        { who: 'me', text: 'Oddzwonię na numer z intranetu.', choiceId: 'oddzwonie' },
      ],
      ending: 'koniec-a',
    });
    expect(walkLiveCall(content, ['nie-ma']).ending).toBeUndefined();
  });
});
