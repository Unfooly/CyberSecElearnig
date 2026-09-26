import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NarrationBar, { TRANSCRIPT_TOGGLE_ID } from './NarrationBar';
import { useNarrationBar } from './useNarrationBar';

// Port z dawnego NarrationPlayer.test.tsx (usunięty razem z NarrationPlayer.tsx, feat/player-stage) - logika w
// useNarrationBar.test.ts, prezentacja tutaj. NIE przeniesione: przesuwanie długiego napisu w czasie (usunięte -
// zastąpione ellipsis, "1 linia" to wymóg nowego paska) i treść transkrypcji rozwiniętej inline (transkrypcja jest
// teraz osobnym pływającym panelem, TranscriptPanel.test.tsx - ten plik sprawdza tylko przycisk, który ją otwiera).

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

function Harness({ narrationProp, autoPlay, enabled = true, togglePending, toggleError = null, resetKey = 'b1' }: HarnessProps = {}) {
  const resolvedNarration = narrationProp === 'none' ? undefined : (narrationProp ?? narration);
  const state = useNarrationBar({ narration: resolvedNarration, contentBase: BASE, enabled, resetKey, autoPlay });
  const onToggle = vi.fn();
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
  return render(<Harness {...overrides} />);
}

const audioEl = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;
const lektor = () => screen.getByRole('switch', { name: 'Lektor' });

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
  });

  it('adres audio: <audio> ma src złożony z bazy i ścieżki, preload=metadata, bez autostartu', () => {
    const { container } = renderBar();
    expect(audioEl(container)).toHaveAttribute('src', 'https://content.example.com/audio/a.mp3');
    expect(audioEl(container)).toHaveAttribute('preload', 'metadata');
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('niepoprawna ścieżka (obcy host) - brak elementu audio, przycisk "Transkrypcja" zostaje', () => {
    const { container } = renderBar({ narrationProp: { ...narration, audioUrl: 'https://evil.test/a.mp3' } });
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
  });

  it('blok bez narracji: nic się nie renderuje', () => {
    const { container } = renderBar({ narrationProp: 'none' });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  describe('przełącznik "Lektor" (role=switch: stała nazwa, stan w aria-checked)', () => {
    it('włączony: aria-checked=true, kliknięcie woła onToggleEnabled', () => {
      renderBar();
      expect(lektor()).toBeChecked();
      expect(lektor()).toHaveAccessibleName('Lektor');
    });

    it('wyłączony: ta sama nazwa, aria-checked=false, bez audio/odtwarzania', () => {
      const { container } = renderBar({ enabled: false });
      expect(lektor()).not.toBeChecked();
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.queryByRole('button', { name: /Odtwórz narrację/ })).toBeNull();
    });

    it('błąd zapisu ustawienia jest ogłaszany (role=alert), przełącznik zablokowany w trakcie zapisu', () => {
      renderBar({ toggleError: 'Nie udało się zapisać ustawienia lektora.', togglePending: true });
      expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się zapisać ustawienia lektora.');
      expect(lektor()).toBeDisabled();
    });
  });

  describe('odtwarzanie', () => {
    it('play/pauza przełącza odtwarzanie i etykietę przycisku', () => {
      const { container } = renderBar();
      fireEvent.click(screen.getByRole('button', { name: 'Odtwórz narrację' }));
      expect(playSpy).toHaveBeenCalledTimes(1);

      fireEvent.play(audioEl(container));
      const pause = screen.getByRole('button', { name: 'Wstrzymaj narrację' });
      Object.defineProperty(audioEl(container), 'paused', { value: false, configurable: true });
      fireEvent.click(pause);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    });

    it('błąd ładowania elementu audio (onError): komunikat, znika sterowanie, transkrypcja zostaje', () => {
      const { container } = renderBar();
      fireEvent.error(audioEl(container));
      expect(screen.getByText(/nie udało się załadować nagrania/i)).toBeInTheDocument();
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
    });

    it('pasek postępu: zmiana ustawia currentTime, opis wartości pokazuje czas, krok 1 s', () => {
      const { container } = renderBar();
      const slider = screen.getByRole('slider', { name: 'Postęp nagrania' });
      expect(slider).toHaveAttribute('aria-valuetext', '0:00 z 0:04');
      expect(slider).toHaveAttribute('step', '1000');

      fireEvent.change(slider, { target: { value: '3000' } });
      expect(audioEl(container).currentTime).toBe(3);
      expect(screen.getByRole('slider', { name: 'Postęp nagrania' })).toHaveAttribute('aria-valuetext', '0:03 z 0:04');
    });
  });

  describe('pierścień postępu (telefon w pionie, feat/player-portrait) - dekoracyjny, bez roli', () => {
    it('renderuje się (aria-hidden), niezależnie od breakpointu - jsdom nie liczy CSS, przełączenie jest wyłącznie w globals.css', () => {
      const { container } = renderBar();
      const ring = container.querySelector('[data-testid="narration-progress-ring"]');
      expect(ring).toBeInTheDocument();
      expect(ring).toHaveAttribute('aria-hidden', 'true');
      // Bez roli/etykiety dostępności (czysto wizualny) - istniejący współdzielony slider zostaje JEDYNYM
      // interaktywnym kontrolerem postępu (zero duplikatów ról).
      expect(screen.getAllByRole('slider')).toHaveLength(1);
    });

    it('wypełnienie łuku odpowiada positionMs/durationMs (strokeDashoffset)', () => {
      const { container } = renderBar();
      const slider = screen.getByRole('slider', { name: 'Postęp nagrania' });
      fireEvent.change(slider, { target: { value: '2000' } }); // 2000/4000 = 50%

      const progressCircle = container.querySelectorAll('[data-testid="narration-progress-ring"] circle')[1];
      const circumference = 2 * Math.PI * 16;
      expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(circumference * 0.5));
    });

    it('brak audio (hasAudio=false): pierścień się nie renderuje (ten sam warunek co pasek liniowy/przycisk play)', () => {
      const { container } = renderBar({ narrationProp: { ...narration, audioUrl: 'https://evil.test/a.mp3' } });
      expect(container.querySelector('[data-testid="narration-progress-ring"]')).toBeNull();
    });
  });

  describe('napisy (jedna linia, ellipsis) i przycisk transkrypcji', () => {
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

    it('przycisk "Transkrypcja" ma aria-expanded zawsze, a aria-controls (wzorzec UserMenu.tsx) TYLKO gdy panel jest otwarty', () => {
      renderBar();
      const toggle = screen.getByRole('button', { name: 'Transkrypcja' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).not.toHaveAttribute('aria-controls');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-controls', TRANSCRIPT_TOGGLE_ID);
    });

    it('przycisk "Transkrypcja" jest widoczny nawet gdy nie ma aktywnego napisu (np. lektor wyłączony)', () => {
      renderBar({ enabled: false });
      expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Odtwórz narrację' })).toBeInTheDocument();
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
