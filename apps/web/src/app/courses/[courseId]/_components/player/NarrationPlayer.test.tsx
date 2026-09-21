import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NarrationPlayer from './NarrationPlayer';

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

function renderPlayer(overrides: Partial<React.ComponentProps<typeof NarrationPlayer>> = {}) {
  const onToggle = vi.fn();
  const view = render(
    <NarrationPlayer narration={narration} contentBase={BASE} enabled onToggleEnabled={onToggle} {...overrides} />,
  );
  return { onToggle, ...view };
}

const audioEl = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;
const lektor = () => screen.getByRole('switch', { name: 'Lektor' });

describe('NarrationPlayer', () => {
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

  describe('adres nagrania', () => {
    it('składa adres z bazy i ścieżki względnej i ładuje tylko metadane (bez autostartu)', () => {
      const { container } = renderPlayer();
      expect(audioEl(container)).toHaveAttribute('src', 'https://content.example.com/audio/a.mp3');
      expect(audioEl(container)).toHaveAttribute('preload', 'metadata');
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('niepoprawna ścieżka z treści (obcy host, "..", schemat) nie tworzy elementu audio, tekst zostaje w transkrypcji', () => {
      for (const audioUrl of ['https://evil.test/a.mp3', '../a.mp3', 'javascript:x.mp3', '//evil.test/a.mp3']) {
        const { container, unmount } = renderPlayer({ narration: { ...narration, audioUrl } });
        expect(container.querySelector('audio')).toBeNull();
        expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('przełącznik "Lektor" (role=switch: stała nazwa, stan w aria-checked)', () => {
    it('włączony: nazwa "Lektor", aria-checked=true; kliknięcie wywołuje zmianę', () => {
      const { onToggle } = renderPlayer();
      expect(lektor()).toBeChecked();
      expect(lektor()).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(lektor());
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('wyłączony: ta sama nazwa "Lektor", aria-checked=false (nazwa nie zależy od stanu)', () => {
      renderPlayer({ enabled: false });
      expect(lektor()).not.toBeChecked();
      expect(lektor()).toHaveAttribute('aria-checked', 'false');
      expect(lektor()).toHaveAccessibleName('Lektor');
    });

    it('widoczna etykieta to "Lektor" (WCAG 2.5.3: widoczny tekst zawarty w nazwie)', () => {
      renderPlayer();
      expect(lektor()).toHaveTextContent('Lektor');
    });

    it('błąd zapisu ustawienia jest ogłaszany (role=alert); przełącznik blokowany w trakcie zapisu', () => {
      renderPlayer({ toggleError: 'Nie udało się zapisać ustawienia lektora.', togglePending: true });
      expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się zapisać ustawienia lektora.');
      expect(lektor()).toBeDisabled();
    });

    it('wyłączony lektor: brak audio i przycisku odtwarzania, zostaje przełącznik i transkrypcja', () => {
      const { container } = renderPlayer({ enabled: false });
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.queryByRole('button', { name: /Odtwórz narrację/ })).toBeNull();
      expect(screen.queryByTestId('caption')).toBeNull();
      expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
    });
  });

  describe('blok bez narracji', () => {
    it('nie renderuje nic: znika cały rząd odtwarzacza (zostaje tylko nawigacja powłoki)', () => {
      const { container } = renderPlayer({ narration: undefined });
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('switch')).toBeNull();
    });
  });

  describe('odtwarzanie', () => {
    it('play/pauza przełącza odtwarzanie i etykietę przycisku', () => {
      const { container } = renderPlayer();
      fireEvent.click(screen.getByRole('button', { name: 'Odtwórz narrację' }));
      expect(playSpy).toHaveBeenCalledTimes(1);

      fireEvent.play(audioEl(container));
      const pause = screen.getByRole('button', { name: 'Wstrzymaj narrację' });
      Object.defineProperty(audioEl(container), 'paused', { value: false, configurable: true });
      fireEvent.click(pause);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    });

    it('AbortError z play() (szybkie Odtwórz i Wstrzymaj) NIE jest błędem ładowania: odtwarzacz zostaje', async () => {
      playSpy.mockRejectedValueOnce(new DOMException('interrupted by pause', 'AbortError'));
      const { container } = renderPlayer();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Odtwórz narrację' }));
      });

      expect(screen.queryByText(/nie udało się załadować nagrania/i)).toBeNull();
      expect(container.querySelector('audio')).not.toBeNull();
    });

    it('NotSupportedError z play() to nagranie nie do odtworzenia: komunikat, tekst zostaje', async () => {
      playSpy.mockRejectedValueOnce(new DOMException('no supported source', 'NotSupportedError'));
      const { container } = renderPlayer();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Odtwórz narrację' }));
      });

      expect(screen.getByText(/nie udało się załadować nagrania/i)).toBeInTheDocument();
      expect(container.querySelector('audio')).toBeNull();
    });

    it('błąd ładowania elementu audio (onError): komunikat, znika sterowanie, transkrypcja zostaje', () => {
      const { container } = renderPlayer();
      fireEvent.error(audioEl(container));
      expect(screen.getByText(/nie udało się załadować nagrania/i)).toBeInTheDocument();
      expect(container.querySelector('audio')).toBeNull();
      expect(screen.getByRole('button', { name: 'Transkrypcja' })).toBeInTheDocument();
    });

    it('pasek postępu: zmiana ustawia currentTime, opis wartości pokazuje czas, krok 1 s, cel dotykowy 44 px', () => {
      const { container } = renderPlayer();
      const slider = screen.getByRole('slider', { name: 'Postęp nagrania' });
      expect(slider).toHaveAttribute('aria-valuetext', '0:00 z 0:04');
      expect(slider).toHaveAttribute('step', '1000');
      expect(slider.className).toMatch(/h-11/);

      fireEvent.change(slider, { target: { value: '3000' } });
      expect(audioEl(container).currentTime).toBe(3);
      expect(screen.getByRole('slider', { name: 'Postęp nagrania' })).toHaveAttribute('aria-valuetext', '0:03 z 0:04');
    });

    it('wyłączenie lektora w trakcie odtwarzania usuwa nagranie, a po ponownym włączeniu stan to "wstrzymane"', () => {
      const { container, rerender } = renderPlayer();
      fireEvent.play(audioEl(container));
      expect(screen.getByRole('button', { name: 'Wstrzymaj narrację' })).toBeInTheDocument();

      rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled={false} onToggleEnabled={() => {}} />);
      expect(container.querySelector('audio')).toBeNull();

      rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled onToggleEnabled={() => {}} />);
      expect(screen.getByRole('button', { name: 'Odtwórz narrację' })).toBeInTheDocument();
      expect(playSpy).not.toHaveBeenCalled();
    });
  });

  describe('napisy (jedna linia) i transkrypcja', () => {
    it('aktywne zdanie zależy od pozycji nagrania (cues), w jednej linii bez zawijania', () => {
      const { container } = renderPlayer();
      expect(screen.getByTestId('caption')).toHaveTextContent('Pierwsze zdanie.');
      expect(screen.getByTestId('caption').className).toMatch(/whitespace-nowrap/);

      Object.defineProperty(audioEl(container), 'currentTime', { value: 2.5, configurable: true });
      fireEvent.timeUpdate(audioEl(container));
      expect(screen.getByTestId('caption')).toHaveTextContent('Drugie zdanie.');
    });

    it('pełny tekst napisu jest też w podpowiedzi (title), gdy linia go skraca', () => {
      renderPlayer();
      expect(screen.getByTestId('caption')).toHaveAttribute('title', 'Pierwsze zdanie.');
    });

    it('bez cues: napisy z podziału proporcjonalnego', () => {
      const { container } = renderPlayer({
        narration: { text: 'Krótkie. To jest znacznie dłuższe zdanie do podziału.', audioUrl: 'audio/a.mp3', durationMs: 10_000 },
      });
      expect(screen.getByTestId('caption')).toHaveTextContent('Krótkie.');
      Object.defineProperty(audioEl(container), 'currentTime', { value: 9, configurable: true });
      fireEvent.timeUpdate(audioEl(container));
      expect(screen.getByTestId('caption')).toHaveTextContent('To jest znacznie dłuższe zdanie do podziału.');
    });

    const measure = (clientWidth: number, scrollWidth: number) => {
      Object.defineProperty(screen.getByTestId('caption-box'), 'clientWidth', { value: clientWidth, configurable: true });
      Object.defineProperty(screen.getByTestId('caption'), 'scrollWidth', { value: scrollWidth, configurable: true });
    };
    const seekTo = (container: HTMLElement, seconds: number) => {
      Object.defineProperty(audioEl(container), 'currentTime', { value: seconds, configurable: true });
      fireEvent.timeUpdate(audioEl(container));
    };

    it('długie zdanie przesuwa się w czasie: wysunięcie = dokładna nadwyżka tekstu, rośnie z postępem w obrębie napisu', () => {
      const { container } = renderPlayer();
      measure(100, 300); // nadwyżka 200 px

      seekTo(container, 1); // połowa napisu 0-2 s
      expect(screen.getByTestId('caption').style.transform).toBe('translateX(-100px)');

      seekTo(container, 1.9);
      expect(screen.getByTestId('caption').style.transform).toBe('translateX(-190px)');
    });

    it('padding jest poza mierzonym elementem: kontener z overflow-hidden nie ma paddingu poziomego (inaczej ostatnie piksele tekstu były ucięte)', () => {
      renderPlayer();
      const box = screen.getByTestId('caption-box');
      expect(box.className).toMatch(/overflow-hidden/);
      expect(box.className).not.toMatch(/\bp[xlr]?-\d/);
      expect(box.parentElement!.className).toMatch(/px-3/);
    });

    it('tekst tylko odrobinę szerszy od pola (5 px) też się przesuwa - wcześniej padding zjadał tę nadwyżkę i tekst był obcięty bez przewijania', () => {
      const { container } = renderPlayer();
      measure(100, 105);

      seekTo(container, 1.9);

      const shift = Number(/-?([\d.]+)px/.exec(screen.getByTestId('caption').style.transform)![1]);
      expect(shift).toBeGreaterThan(0);
      expect(shift).toBeLessThanOrEqual(5);
    });

    it('tekst mieszczący się w polu nie jest przesuwany', () => {
      const { container } = renderPlayer();
      measure(300, 120);
      seekTo(container, 1.9);
      expect(screen.getByTestId('caption').style.transform).toBe('translateX(-0px)');
    });

    it('zmiana szerokości (ResizeObserver) przelicza przesunięcie bez zmiany pozycji nagrania', () => {
      let notify: () => void = () => {};
      class FakeResizeObserver {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      const { container } = renderPlayer();
      measure(100, 300);
      seekTo(container, 1);
      expect(screen.getByTestId('caption').style.transform).toBe('translateX(-100px)');

      // Obrót telefonu: pole węższe (nadwyżka 250 px), nagranie stoi w miejscu.
      measure(50, 300);
      act(() => notify());

      expect(screen.getByTestId('caption').style.transform).toBe('translateX(-125px)');
      vi.unstubAllGlobals();
    });

    it('bez ResizeObserver (np. jsdom) komponent działa: guard na dostępność API', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      expect(() => renderPlayer()).not.toThrow();
      vi.unstubAllGlobals();
    });

    it('po wyłączeniu i ponownym włączeniu lektora pozycja wraca do 0 (nowy element audio), napis do pierwszego zdania', () => {
      const { container, rerender } = renderPlayer();
      seekTo(container, 2.5);
      expect(screen.getByTestId('caption')).toHaveTextContent('Drugie zdanie.');

      rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled={false} onToggleEnabled={() => {}} />);
      rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled onToggleEnabled={() => {}} />);

      expect(screen.getByRole('slider', { name: 'Postęp nagrania' })).toHaveAttribute('aria-valuetext', '0:00 z 0:04');
      expect(screen.getByTestId('caption')).toHaveTextContent('Pierwsze zdanie.');
    });

    it('transkrypcja: przycisk z aria-expanded pokazuje pełny tekst; ma cel dotykowy 44 px', () => {
      renderPlayer();
      const toggle = screen.getByRole('button', { name: 'Transkrypcja' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // aria-controls tylko gdy sterowany element istnieje (zwinięty panel nie ma id w DOM).
      expect(toggle).not.toHaveAttribute('aria-controls');
      expect(toggle.className).toMatch(/min-h-\[44px\]/);
      expect(screen.queryByText('Pierwsze zdanie. Drugie zdanie.')).toBeNull();

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = screen.getByText('Pierwsze zdanie. Drugie zdanie.').parentElement as HTMLElement;
      expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
      expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(panel);
    });

    it('rozwinięta transkrypcja ma limit wysokości z przewijaniem (nie wypycha przycisków nawigacji)', () => {
      renderPlayer();
      fireEvent.click(screen.getByRole('button', { name: 'Transkrypcja' }));
      const panel = screen.getByText('Pierwsze zdanie. Drugie zdanie.').parentElement as HTMLElement;
      expect(panel.className).toMatch(/max-h-/);
      expect(panel.className).toMatch(/overflow-y-auto/);
    });
  });

  describe('autoodtwarzanie', () => {
    it('autoPlay: odtwarza po pojawieniu się bloku (raz)', async () => {
      await act(async () => {
        renderPlayer({ autoPlay: true });
      });
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/zablokowała autoodtwarzanie/i)).toBeNull();
    });

    it('zablokowane przez przeglądarkę (NotAllowedError): podpowiedź, przycisk "Odtwórz" zostaje', async () => {
      playSpy.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
      await act(async () => {
        renderPlayer({ autoPlay: true });
      });
      expect(await screen.findByText(/zablokowała autoodtwarzanie/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Odtwórz narrację' })).toBeInTheDocument();
    });

    it('ponowne włączenie lektora NIE restartuje autostartu (tylko raz na blok)', async () => {
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = renderPlayer({ autoPlay: true });
      });
      expect(playSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        view.rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled={false} onToggleEnabled={() => {}} autoPlay />);
      });
      await act(async () => {
        view.rerender(<NarrationPlayer narration={narration} contentBase={BASE} enabled onToggleEnabled={() => {}} autoPlay />);
      });

      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    it('bez autoPlay nic nie startuje samo', () => {
      renderPlayer({ autoPlay: false });
      expect(playSpy).not.toHaveBeenCalled();
    });
  });
});
