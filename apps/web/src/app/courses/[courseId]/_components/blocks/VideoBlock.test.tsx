import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    unmount();
    render(<VideoBlock block={block} onReady={vi.fn()} />);
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRestore();
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
