import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoBlock from './VideoBlock';

const block = { type: 'VIDEO' as const, url: 'https://example.test/video.mp4' };

describe('VideoBlock', () => {
  it('renderuje odtwarzacz wideo z poprawnym źródłem', () => {
    render(<VideoBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', block.url);
  });

  it('przycisk "Dalej" jest domyślnie zablokowany, dopóki wideo się nie skończy', () => {
    render(<VideoBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    expect(screen.getByRole('button', { name: 'Dalej' })).toBeDisabled();
  });

  it('odblokowuje "Dalej" i wywołuje onSubmit po zdarzeniu "ended"', () => {
    const onSubmit = vi.fn();
    render(<VideoBlock block={block} onSubmit={onSubmit} disabled={false} />);

    fireEvent.ended(document.querySelector('video')!);
    const button = screen.getByRole('button', { name: 'Dalej' });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('odblokowuje "Dalej" też przy błędzie wczytywania wideo (nie blokuje na stałe)', () => {
    render(<VideoBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    fireEvent.error(document.querySelector('video')!);

    expect(screen.getByRole('button', { name: 'Dalej' })).not.toBeDisabled();
  });
});
