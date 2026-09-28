import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmbeddedHtmlBlock from './EmbeddedHtmlBlock';
import type { ContentBlock } from '@/lib/courses-types';

// `html` nie jest już częścią treści bloku po stronie klienta (pole sekretne): iframe ładuje osobny dokument z trasy embed.
const block: ContentBlock = { type: 'EMBEDDED_HTML', id: 'gra' };
const TITLE = 'Interaktywny moduł szkoleniowy';

const renderBlock = (props: Partial<Parameters<typeof EmbeddedHtmlBlock>[0]> = {}) =>
  render(<EmbeddedHtmlBlock block={block} courseId="course-1" onReady={vi.fn()} disabled={false} {...props} />);

describe('EmbeddedHtmlBlock', () => {
  it('iframe z sandboxem allow-scripts i NICZYM więcej (bez allow-same-origin, allow-downloads, allow-forms, allow-popups), bez referrera', () => {
    renderBlock();
    const iframe = screen.getByTitle(TITLE);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('ładuje dokument z trasy embed (src), nigdy z srcdoc: treść bloku nie jest w stronie', () => {
    renderBlock();
    const iframe = screen.getByTitle(TITLE) as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('/api/courses/course-1/blocks/gra/embed');
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
  });

  it('identyfikatory w adresie są kodowane (courseId i blockId nie mogą zmienić ścieżki)', () => {
    renderBlock({ courseId: 'a/../b', block: { type: 'EMBEDDED_HTML', id: 'x?y' } });
    expect((screen.getByTitle(TITLE) as HTMLIFrameElement).getAttribute('src')).toBe('/api/courses/a%2F..%2Fb/blocks/x%3Fy/embed');
  });

  it('podczas podglądu (suspended) iframe jest ODMONTOWANY, nie ukryty; po powrocie wraca', () => {
    const { container, rerender } = renderBlock({ suspended: true });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByTitle(TITLE)).not.toBeInTheDocument();
    rerender(<EmbeddedHtmlBlock block={block} courseId="course-1" onReady={vi.fn()} disabled={false} suspended={false} />);
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('blok bez identyfikatora: błąd zamiast iframe (pusty id nie trafia do adresu)', () => {
    const { container } = renderBlock({ block: { type: 'EMBEDDED_HTML' } });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('brak identyfikatora bloku');
  });

  it('„Ukończyłem” to przełącznik gotowości (nie nawigacja, D-106): zgłasza gotowość, drugi klik ją cofa', () => {
    const onReady = vi.fn();
    renderBlock({ onReady });
    const button = screen.getByRole('button', { name: 'Ukończyłem' });
    fireEvent.click(button);
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onReady).toHaveBeenLastCalledWith(false);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('respektuje prop disabled (np. w trakcie zapisu poprzedniego bloku)', () => {
    renderBlock({ disabled: true });
    expect(screen.getByRole('button', { name: 'Ukończyłem' })).toBeDisabled();
  });
});
