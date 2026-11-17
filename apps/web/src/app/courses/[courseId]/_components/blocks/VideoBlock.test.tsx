import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VideoBlock from './VideoBlock';

const block = { type: 'VIDEO' as const, url: 'https://example.test/video.mp4' };

// Jeden „Dalej” (D-106): blok nie ma własnego przycisku - po obejrzeniu zgłasza gotowość do „Dalej” w pasku.
describe('VideoBlock', () => {
  it('renderuje odtwarzacz wideo z poprawnym źródłem, bez własnego przycisku dalej', () => {
    render(<VideoBlock block={block} onReady={vi.fn()} />);

    const video = screen.getByTestId('video-player');
    expect(video).toHaveAttribute('src', block.url);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('przed obejrzeniem nie zgłasza gotowości (podpowiedź „Obejrzyj film do końca”)', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByText(/Obejrzyj film do końca/)).toBeVisible();
  });

  it('po zdarzeniu "ended" zgłasza gotowość', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    fireEvent.ended(screen.getByTestId('video-player'));
    expect(onReady).toHaveBeenCalledWith(true);
  });

  it('zgłasza gotowość też przy błędzie wczytywania wideo (nie blokuje na stałe)', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    fireEvent.error(screen.getByTestId('video-player'));

    expect(onReady).toHaveBeenCalledWith(true);
  });

  it('autoPlay (po geście gracza) uruchamia film od razu; bez niego - nie; odrzucone odtwarzanie nie wywraca bloku', async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { unmount } = render(<VideoBlock block={block} onReady={vi.fn()} autoPlay />);
    expect(play).toHaveBeenCalledTimes(1);
    // Odrzucone play() (NotAllowedError) - blok zostaje, z kontrolkami.
    await Promise.resolve();
    expect(screen.getByTestId('video-player')).toHaveAttribute('controls');
    unmount();
    render(<VideoBlock block={block} onReady={vi.fn()} />);
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  describe('telefon: pełny ekran w poziomie (decyzja właściciela 2026-11-17)', () => {
    const matchMedia = (matches: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    // Oryginały globali podmienianych w testach - przywracane po każdym (bez przecieku do innych plików testów).
    const originalOrientation = Object.getOwnPropertyDescriptor(window.screen, 'orientation');
    const originalExit = document.exitFullscreen;
    afterEach(() => {
      vi.unstubAllGlobals();
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      if (originalOrientation) Object.defineProperty(window.screen, 'orientation', originalOrientation);
      else delete (window.screen as unknown as Record<string, unknown>).orientation;
      document.exitFullscreen = originalExit;
    });

    it('odmowa pełnego ekranu: bez blokady orientacji i bez nieobsłużonego błędu, film gra w kursie; ponowny play w pełnym ekranie - bez drugiej prośby', async () => {
      matchMedia(true);
      const lock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock: vi.fn() } });
      render(<VideoBlock block={block} onReady={vi.fn()} />);
      const video = screen.getByTestId('video-player') as HTMLVideoElement;
      const request = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'TypeError' }));
      video.requestFullscreen = request;
      fireEvent.play(video);
      await Promise.resolve();
      await Promise.resolve();
      expect(lock).not.toHaveBeenCalled();
      expect(screen.getByTestId('video-player')).toBeInTheDocument();
      // Już w pełnym ekranie - kolejne play (np. wznowienie) nie prosi drugi raz.
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
      fireEvent.play(video);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('wyjście z pełnego ekranu gestem (fullscreenchange bez elementu) zwalnia blokadę orientacji; „Wstecz” (suspended) wychodzi z pełnego ekranu', () => {
      const unlock = vi.fn();
      Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock: vi.fn(), unlock } });
      const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      const { rerender } = render(<VideoBlock block={block} onReady={vi.fn()} />);
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(unlock).toHaveBeenCalledTimes(1);
      const video = screen.getByTestId('video-player') as HTMLVideoElement;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
      const exit = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = exit;
      rerender(<VideoBlock block={block} onReady={vi.fn()} suspended />);
      expect(exit).toHaveBeenCalledTimes(1);
      pause.mockRestore();
    });

    it('telefon: start filmu -> pełny ekran i blokada orientacji poziomej; koniec filmu -> wyjście z pełnego ekranu', async () => {
      matchMedia(true);
      const lock = vi.fn().mockResolvedValue(undefined);
      const unlock = vi.fn();
      // window.screen (nie `screen` z Testing Library).
      Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock } });
      render(<VideoBlock block={block} onReady={vi.fn()} />);
      const video = screen.getByTestId('video-player') as HTMLVideoElement;
      const request = vi.fn().mockResolvedValue(undefined);
      video.requestFullscreen = request;
      fireEvent.play(video);
      expect(request).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(lock).toHaveBeenCalledWith('landscape'));
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
      const exit = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = exit;
      fireEvent.ended(video);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(unlock).toHaveBeenCalled();
    });

    it('iPhone (bez Fullscreen API na elemencie): natywny odtwarzacz pełnoekranowy; komputer - bez pełnego ekranu', () => {
      matchMedia(true);
      const { unmount } = render(<VideoBlock block={block} onReady={vi.fn()} />);
      const video = screen.getByTestId('video-player') as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      Object.defineProperty(video, 'requestFullscreen', { configurable: true, value: undefined });
      video.webkitEnterFullscreen = vi.fn();
      fireEvent.play(video);
      expect(video.webkitEnterFullscreen).toHaveBeenCalledTimes(1);
      unmount();

      matchMedia(false);
      render(<VideoBlock block={block} onReady={vi.fn()} />);
      const desktop = screen.getByTestId('video-player') as HTMLVideoElement;
      const request = vi.fn().mockResolvedValue(undefined);
      desktop.requestFullscreen = request;
      fireEvent.play(desktop);
      expect(request).not.toHaveBeenCalled();
    });
  });

  it('podgląd „Wstecz” (suspended) zatrzymuje film - ukryty blok nie gra w tle', () => {
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { rerender } = render(<VideoBlock block={block} onReady={vi.fn()} />);
    expect(pause).not.toHaveBeenCalled();
    rerender(<VideoBlock block={block} onReady={vi.fn()} suspended />);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause.mock.contexts[0]).toBe(screen.getByTestId('video-player'));
    pause.mockRestore();
  });

  it('D-159: plik z potoku zasobów - adres z bazy CONTENT_BASE_URL, plakat, playsinline; tytuł bloku tylko jako nazwa odtwarzacza', () => {
    render(
      <VideoBlock
        block={{ type: 'VIDEO', title: 'Najłatwiejsze drzwi', src: 'assets/najlatwiejsze-drzwi/video/film.1a2b3c4d.mp4', poster: 'assets/najlatwiejsze-drzwi/video/plakat.5e6f7a8b.jpg' }}
        contentBase="https://content.example.com"
        onReady={vi.fn()}
      />,
    );
    const video = screen.getByTestId('video-player');
    expect(video).toHaveAttribute('src', 'https://content.example.com/assets/najlatwiejsze-drzwi/video/film.1a2b3c4d.mp4');
    expect(video).toHaveAttribute('poster', 'https://content.example.com/assets/najlatwiejsze-drzwi/video/plakat.5e6f7a8b.jpg');
    expect(video).toHaveAttribute('playsinline');
    // Uwaga właściciela 2026-11-17: bez napisu obok filmu - tytuł tylko dla czytnika.
    expect(screen.queryByText('Najłatwiejsze drzwi')).not.toBeInTheDocument();
    expect(video).toHaveAttribute('aria-label', 'Najłatwiejsze drzwi');
  });

  it('przed pierwszym obejrzeniem przewinięcie do przodu wraca do najdalej obejrzanego miejsca; cofanie bez zmian; po końcu - dowolnie', () => {
    render(<VideoBlock block={block} onReady={vi.fn()} />);
    const video = screen.getByTestId('video-player') as HTMLVideoElement;
    const at = (time: number) => Object.defineProperty(video, 'currentTime', { value: time, writable: true, configurable: true });
    // Odtwarzanie: kolejne `timeupdate` co sekundę do 10 s.
    for (let time = 1; time <= 10; time += 1) {
      at(time);
      fireEvent.timeUpdate(video);
    }
    at(90);
    fireEvent.seeking(video);
    expect(video.currentTime).toBe(10);
    at(3);
    fireEvent.seeking(video);
    expect(video.currentTime).toBe(3);
    fireEvent.ended(video);
    at(90);
    fireEvent.seeking(video);
    expect(video.currentTime).toBe(90);
  });

  it('D-159: ścieżka spoza bazy albo zły format - bez źródła i bez blokady „Dalej”', () => {
    // Stary `url` też tylko https (schemat i tak to wymusza - tu druga linia).
    const { unmount: drop } = render(<VideoBlock block={{ type: 'VIDEO', url: 'javascript:alert(1)' }} onReady={vi.fn()} />);
    expect(screen.getByTestId('video-player')).not.toHaveAttribute('src');
    drop();
    for (const src of ['https://obcy.example/film.mp4', '../film.mp4', 'video/film.mov']) {
      const onReady = vi.fn();
      const { unmount } = render(<VideoBlock block={{ type: 'VIDEO', src }} contentBase="https://content.example.com" onReady={onReady} />);
      expect(screen.getByTestId('video-player')).not.toHaveAttribute('src');
      expect(onReady).toHaveBeenCalledWith(true);
      unmount();
    }
  });
});
