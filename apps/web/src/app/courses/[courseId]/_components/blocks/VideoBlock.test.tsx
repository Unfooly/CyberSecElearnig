import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoBlock from './VideoBlock';

const block = { type: 'VIDEO' as const, url: 'https://example.test/video.mp4' };

// Jeden „Dalej” (D-106): blok nie ma własnego przycisku - po obejrzeniu zgłasza gotowość do „Dalej” w pasku.
describe('VideoBlock', () => {
  it('renderuje odtwarzacz wideo z poprawnym źródłem, bez własnego przycisku dalej', () => {
    render(<VideoBlock block={block} onReady={vi.fn()} />);

    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', block.url);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('przed obejrzeniem nie zgłasza gotowości (podpowiedź „Obejrzyj wideo do końca”)', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByText(/Obejrzyj wideo do końca/)).toBeInTheDocument();
  });

  it('po zdarzeniu "ended" zgłasza gotowość', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    fireEvent.ended(document.querySelector('video')!);
    expect(onReady).toHaveBeenCalledWith(true);
  });

  it('zgłasza gotowość też przy błędzie wczytywania wideo (nie blokuje na stałe)', () => {
    const onReady = vi.fn();
    render(<VideoBlock block={block} onReady={onReady} />);

    fireEvent.error(document.querySelector('video')!);

    expect(onReady).toHaveBeenCalledWith(true);
  });
});
