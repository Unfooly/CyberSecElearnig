import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NarrationBar from './NarrationBar';
import { useNarrationBar } from './useNarrationBar';
import { OverlayStackProvider, useCloseTopOverlay } from './overlay-stack';

// Port z dawnego NarrationPlayer.test.tsx (usunięty razem z NarrationPlayer.tsx, feat/player-stage) - logika w
// useNarrationBar.test.ts, prezentacja tutaj. Od D-162: zamiast „Transkrypcja” przycisk CC (napisy), zamiast „Lektor” ikona głośnika z
// okienkiem głośności i wyciszenia.

const narration = {
  text: 'Pierwsze zdanie. Drugie zdanie.',
  audioUrl: 'audio/a.mp3',
  durationMs: 4000,
  cues: [
    { text: 'Pierwsze zdanie.', startMs: 0 },
    { text: 'Drugie zdanie.', startMs: 2000 },
  ],
};
const BASE = 'https://content.example.com';

interface HarnessProps {
  narrationProp?: typeof narration | 'none';
  autoPlay?: boolean;
  enabled?: boolean;
  togglePending?: boolean;
  toggleError?: string | null;
  resetKey?: string;
}

const onToggle = vi.fn();

function Harness({ narrationProp, autoPlay, enabled = true, togglePending, toggleError = null, resetKey = 'b1' }: HarnessProps = {}) {
  const resolvedNarration = narrationProp === 'none' ? undefined : (narrationProp ?? narration);
  const state = useNarrationBar({ narration: resolvedNarration, contentBase: BASE, enabled, resetKey, autoPlay });
  return (
    <NarrationBar
      narration={resolvedNarration}
      state={state}
      enabled={enabled}
      onToggleEnabled={onToggle}
      togglePending={togglePending}
      toggleError={toggleError}
    />
  );
}

function renderBar(overrides: HarnessProps = {}) {
  return render(<Harness {...overrides} />, { wrapper: OverlayStackProvider });
}

const audioEl = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;
const speaker = () => screen.getByRole('button', { name: /^(Głośność lektora|Lektor wyciszony)/ });
const cc = () => screen.getByRole('button', { name: 'Napisy' });

describe('NarrationBar', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    onToggle.mockClear();
    window.localStorage.clear();
  });

  it('adres audio: <audio> ma src złożony z bazy i ścieżki, preload=metadata, bez autostartu', () => {
    const { container } = renderBar();
    expect(audioEl(container)).toHaveAttribute('src', 'https://content.example.com/audio/a.mp3');
    expect(audioEl(container)).toHaveAttribute('preload', 'metadata');
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('niepoprawna ścieżka (obcy host) - brak elementu audio, CC i głośnik zostają', () => {
    const { container } = renderBar({ narrationProp: { ...narration, audioUrl: 'https://evil.test/a.mp3' } });
    expect(container.querySelector('audio')).toBeNull();
    expect(cc()).toBeInTheDocument();
    expect(speaker()).toBeInTheDocument();
  });

  it('blok bez narracji: nic się nie renderuje', () => {
    const { container } = renderBar({ narrationProp: 'none' });
    expect(container).toBeEmptyDOMElement();
  });

  it('D-162: bez przycisków „Transkrypcja” i „Lektor”', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Transkrypcja' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lektor' })).toBeNull();
  });

  describe('głośnik (D-162): okienko z głośnością i wyciszeniem lektora', () => {
    it('włączony lektor: nazwa z głośnością, ikona głośnika; klik otwiera okienko (aria-expanded/aria-controls), klik obok zamyka', () => {
      renderBar();
      expect(speaker()).toHaveAccessibleName('Głośność lektora: 100%');
      expect(speaker().querySelector('.lucide-volume-2')).not.toBeNull();
      expect(speaker()).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(speaker());
      const panel = screen.getByTestId('volume-panel');
      expect(speaker()).toHaveAttribute('aria-controls', panel.id);
      expect(screen.getByRole('slider')).toHaveValue('100');
      // Nazwa suwaka stała (procent tylko dla oka, wartość w aria-valuetext).
      expect(screen.getByRole('slider')).toHaveAccessibleName('Głośność');
      fireEvent.pointerDown(document.body);
      expect(screen.queryByTestId('volume-panel')).toBeNull();
    });

    it('Escape (nasłuch PlayerStage przez overlay-stack) zamyka okienko i oddaje fokus głośnikowi', () => {
      function WithEscape() {
        const closeTop = useCloseTopOverlay();
        return (
          <>
            <Harness />
            <button type="button" onClick={() => closeTop()}>
              escape
            </button>
          </>
        );
      }
      render(<WithEscape />, { wrapper: OverlayStackProvider });
      fireEvent.click(speaker());
      fireEvent.click(screen.getByRole('button', { name: 'escape' }));
      expect(screen.queryByTestId('volume-panel')).toBeNull();
      expect(speaker()).toHaveFocus();
    });

    it('iOS (głośność elementu audio tylko do odczytu): zamiast suwaka informacja o przyciskach urządzenia, „Wycisz lektora” zostaje', () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
      vi.spyOn(window.HTMLMediaElement.prototype, 'volume', 'set').mockImplementation(() => {});
      renderBar();
      fireEvent.click(speaker());
      expect(screen.queryByRole('slider')).toBeNull();
      expect(screen.getByText('Głośność ustawisz przyciskami urządzenia.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Wycisz lektora' })).toBeInTheDocument();
    });

    it('suwak zmienia głośność elementu audio i zapamiętuje ją w przeglądarce; ikona przy cichym dźwięku', () => {
      const { container } = renderBar();
      fireEvent.click(speaker());
      fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
      expect(audioEl(container).volume).toBeCloseTo(0.3);
      expect(window.localStorage.getItem('unfooly.narration.volume')).toBe('0.3');
      expect(speaker()).toHaveAccessibleName('Głośność lektora: 30%');
      expect(speaker().querySelector('.lucide-volume-1')).not.toBeNull();
      fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
      expect(speaker().querySelector('.lucide-volume-x')).not.toBeNull();
    });

    it('„Wycisz lektora” wywołuje przełącznik lektora z konta; wyciszony - nazwa „Lektor wyciszony”, przekreślony głośnik, bez audio', () => {
      renderBar();
      fireEvent.click(speaker());
      fireEvent.click(screen.getByRole('button', { name: 'Wycisz lektora' }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('wyciszony lektor: „Lektor wyciszony”, przekreślony głośnik, bez audio i odtwarzania; „Wycisz lektora” wciśnięty (stała etykieta), suwak nieaktywny', () => {
      const { container } = renderBar({ enabled: false });
      expect(speaker()).toHaveAccessibleName('Lektor wyciszony');
      expect(speaker().querySelector('.lucide-volume-off')).not.toBeNull();
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.queryByRole('button', { name: /Odtwórz nagranie/ })).toBeNull();
      fireEvent.click(speaker());
      expect(screen.getByRole('button', { name: 'Wycisz lektora' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('slider')).toBeDisabled();
    });

    it('zapisana głośność wraca po zamontowaniu i trafia na element audio; pusta wartość w przeglądarce - domyślne 100%', () => {
      window.localStorage.setItem('unfooly.narration.volume', '0.4');
      const { container, unmount } = renderBar();
      expect(speaker()).toHaveAccessibleName('Głośność lektora: 40%');
      expect(audioEl(container).volume).toBeCloseTo(0.4);
      unmount();
      window.localStorage.setItem('unfooly.narration.volume', '');
      renderBar();
      expect(speaker()).toHaveAccessibleName('Głośność lektora: 100%');
    });

    it('głośność trafia też na NOWY element audio (ponowne włączenie lektora)', () => {
      const { container, rerender } = renderBar();
      fireEvent.click(speaker());
      fireEvent.change(screen.getByRole('slider'), { target: { value: '25' } });
      rerender(<Harness enabled={false} />);
      rerender(<Harness enabled />);
      expect(audioEl(container).volume).toBeCloseTo(0.25);
    });

    it('nowy blok zamyka otwarte okienko (inna narracja) - bez niewidocznej warstwy po przejściu dalej', () => {
      const { rerender } = renderBar();
      fireEvent.click(speaker());
      expect(screen.getByTestId('volume-panel')).toBeInTheDocument();
      rerender(<Harness narrationProp={{ ...narration, text: 'Kolejny blok.' }} resetKey="b2" />);
      expect(screen.queryByTestId('volume-panel')).toBeNull();
    });

    it('błąd zapisu ustawienia jest ogłaszany (role=alert), wyciszanie zablokowane w trakcie zapisu', () => {
      renderBar({ toggleError: 'Nie udało się zapisać ustawienia lektora.', togglePending: true });
      expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się zapisać ustawienia lektora.');
      fireEvent.click(speaker());
      expect(screen.getByRole('button', { name: 'Wycisz lektora' })).toBeDisabled();
    });
  });

  describe('odtwarzanie', () => {
    it('play/pauza przełącza odtwarzanie i etykietę przycisku ("Odtwórz nagranie"/"Wstrzymaj nagranie" - fix/dialogue-polish)', () => {
      const { container } = renderBar();
      fireEvent.click(screen.getByRole('button', { name: 'Odtwórz nagranie' }));
      expect(playSpy).toHaveBeenCalledTimes(1);

      fireEvent.play(audioEl(container));
      const pause = screen.getByRole('button', { name: 'Wstrzymaj nagranie' });
      Object.defineProperty(audioEl(container), 'paused', { value: false, configurable: true });
      fireEvent.click(pause);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    });

    it('błąd ładowania elementu audio (onError): znika sterowanie odtwarzaniem; przy CC - tekst narracji, bez CC - komunikat o błędzie', () => {
      const { container } = renderBar();
      fireEvent.error(audioEl(container));
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.getByTestId('narration-text')).toBeInTheDocument();
      fireEvent.click(cc());
      expect(screen.getByText(/nie udało się załadować nagrania/i)).toBeInTheDocument();
    });

    it('fix/dialogue-polish: bez paska postępu/suwaka/czasu i bez pierścienia dekoracyjnego - sam przycisk play/pause renderuje się', () => {
      renderBar();
      // Jedyny suwak to głośność w zamkniętym okienku (D-162).
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      expect(screen.queryByTestId('narration-progress-ring')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument();
    });

    it('fix/dialogue-polish: po zakończeniu nagrania przycisk wraca do "Odtwórz nagranie", klik odtwarza od początku (currentTime resetowany na 0)', () => {
      const { container } = renderBar();
      const audio = audioEl(container);
      fireEvent.click(screen.getByRole('button', { name: 'Odtwórz nagranie' }));
      fireEvent.play(audio);
      Object.defineProperty(audio, 'paused', { value: true, configurable: true });
      Object.defineProperty(audio, 'ended', { value: true, configurable: true });
      Object.defineProperty(audio, 'currentTime', { value: 4, configurable: true, writable: true });
      fireEvent.ended(audio);

      const replay = screen.getByRole('button', { name: 'Odtwórz nagranie' });
      fireEvent.click(replay);

      expect(audio.currentTime).toBe(0);
      expect(playSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('napisy (jedna linia, ellipsis) i przycisk CC', () => {
    it('aktywne zdanie zależy od pozycji nagrania (cues)', () => {
      const { container } = renderBar();
      expect(screen.getByText('Pierwsze zdanie.')).toBeInTheDocument();

      Object.defineProperty(audioEl(container), 'currentTime', { value: 2.5, configurable: true });
      fireEvent.timeUpdate(audioEl(container));
      expect(screen.getByText('Drugie zdanie.')).toBeInTheDocument();
    });

    it('napis jest w jednym elemencie z title (pełny tekst, dla ucięcia CSS-em)', () => {
      renderBar();
      expect(screen.getByText('Pierwsze zdanie.')).toHaveAttribute('title', 'Pierwsze zdanie.');
    });

    it('D-162: CC (aria-pressed) wyłącza i włącza napisy; wybór zapamiętany w przeglądarce; ikona dekoracyjna', () => {
      renderBar();
      expect(cc()).toHaveAttribute('aria-pressed', 'true');
      expect(cc().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('Pierwsze zdanie.')).toBeInTheDocument();
      fireEvent.click(cc());
      expect(cc()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByText('Pierwsze zdanie.')).toBeNull();
      expect(window.localStorage.getItem('unfooly.narration.captions')).toBe('off');
      fireEvent.click(cc());
      expect(screen.getByText('Pierwsze zdanie.')).toBeInTheDocument();
    });

    it('napisy wyłączone wcześniej (przeglądarka) - po zamontowaniu bez napisów', () => {
      window.localStorage.setItem('unfooly.narration.captions', 'off');
      renderBar();
      expect(cc()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByText('Pierwsze zdanie.')).toBeNull();
    });

    it('tekst narracji już na ekranie (krok odprawy, textOnScreen) - bez tekstu zastępczego w pasku', () => {
      const state = { current: null as ReturnType<typeof useNarrationBar> | null };
      function OnScreen() {
        state.current = useNarrationBar({ narration, contentBase: BASE, enabled: false, resetKey: 'b1' });
        return <NarrationBar narration={narration} state={state.current} enabled={false} onToggleEnabled={onToggle} textOnScreen />;
      }
      render(<OnScreen />, { wrapper: OverlayStackProvider });
      expect(screen.queryByTestId('narration-text')).toBeNull();
      expect(cc()).toBeInTheDocument();
    });

    it('CC jest widoczny nawet gdy nie ma aktywnego napisu (np. lektor wyciszony)', () => {
      renderBar({ enabled: false });
      expect(cc()).toBeInTheDocument();
    });

    it('D-162: bez nagrania (wyciszony lektor, błąd ładowania, blok bez pliku) i z CC - cały tekst narracji w linijce napisów; CC wyłączone - nic', () => {
      const { container, unmount } = renderBar({ enabled: false });
      expect(screen.getByTestId('narration-text')).toHaveTextContent('Pierwsze zdanie. Drugie zdanie.');
      // Zawijany i przewijany w środku (bez wielokropka), osiągalny klawiaturą.
      expect(screen.getByTestId('narration-text')).toHaveClass('overflow-y-auto', 'whitespace-normal');
      expect(screen.getByTestId('narration-text')).toHaveAttribute('tabindex', '0');
      fireEvent.click(cc());
      expect(screen.queryByTestId('narration-text')).toBeNull();
      expect(container.querySelector('audio')).toBeNull();
      unmount();
      window.localStorage.clear();

      const failed = renderBar();
      fireEvent.error(audioEl(failed.container));
      expect(screen.getByTestId('narration-text')).toHaveTextContent('Pierwsze zdanie.');
      failed.unmount();

      renderBar({ narrationProp: { ...narration, audioUrl: undefined } as unknown as typeof narration });
      expect(screen.getByTestId('narration-text')).toHaveTextContent('Drugie zdanie.');
    });
  });

  describe('autoodtwarzanie', () => {
    it('autoPlay: odtwarza po pojawieniu się bloku (raz)', async () => {
      await act(async () => {
        renderBar({ autoPlay: true });
      });
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/zablokowała autoodtwarzanie/i)).toBeNull();
    });

    it('zablokowane przez przeglądarkę (NotAllowedError): podpowiedź, przycisk "Odtwórz" zostaje', async () => {
      playSpy.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
      await act(async () => {
        renderBar({ autoPlay: true });
      });
      expect(await screen.findByText(/zablokowała autoodtwarzanie/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Odtwórz nagranie' })).toBeInTheDocument();
    });

    it('bez autoPlay nic nie startuje samo', () => {
      renderBar({ autoPlay: false });
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('ponowne włączenie lektora NIE restartuje autostartu (tylko raz na blok - resetKey się nie zmienia)', async () => {
      const { rerender } = await act(async () => {
        return renderBar({ autoPlay: true });
      });
      expect(playSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        rerender(<Harness enabled={false} autoPlay />);
      });
      await act(async () => {
        rerender(<Harness enabled autoPlay />);
      });

      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    it('krytyczny błąd z code review PR #44: przejście blok eksploracyjny A -> B, oba z narracją i autoPlay=true (autoPlay/hasAudio się NIE zmieniają) - autostart musi odpalić się OSOBNO dla każdego bloku, bo resetKey jest w deps efektu autostartu', async () => {
        const { rerender } = await act(async () => {
          return renderBar({ autoPlay: true, resetKey: 'block-a' });
        });
        expect(playSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          rerender(<Harness autoPlay resetKey="block-b" />);
        });

        // Bez resetKey w deps efektu autostartu (Krytyczny błąd #3, kod review PR #44) autoPlay/hasAudio zostają
        // niezmienione między blokami, więc efekt w ogóle by się nie przeliczył i drugie play() nigdy by nie padło.
        expect(playSpy).toHaveBeenCalledTimes(2);
      });
  });
});
