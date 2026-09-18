import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmbeddedHtmlBlock from './EmbeddedHtmlBlock';
import type { ContentBlock } from '@/lib/courses-types';

const block: ContentBlock = { type: 'EMBEDDED_HTML', html: '<html><body>Gra</body></html>' };

describe('EmbeddedHtmlBlock', () => {
  it('renderuje iframe z sandboxem BEZ allow-same-origin (nigdy nie znosi izolacji originu)', () => {
    render(<EmbeddedHtmlBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    const iframe = screen.getByTitle('Interaktywny moduł szkoleniowy');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('przekazuje treść bloku do srcDoc iframe (nigdy do dangerouslySetInnerHTML głównego DOM-u)', () => {
    render(<EmbeddedHtmlBlock block={block} onSubmit={vi.fn()} disabled={false} />);

    const iframe = screen.getByTitle('Interaktywny moduł szkoleniowy') as HTMLIFrameElement;
    expect(iframe.srcdoc).toBe(block.html);
  });

  it('woła onSubmit po kliknięciu "Ukończyłem"', () => {
    const onSubmit = vi.fn();
    render(<EmbeddedHtmlBlock block={block} onSubmit={onSubmit} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ukończyłem' }));

    expect(onSubmit).toHaveBeenCalled();
  });

  it('nie renderuje pustego src, gdy block.html jest brakiem (fallback pusty string, nie undefined w DOM)', () => {
    render(<EmbeddedHtmlBlock block={{ type: 'EMBEDDED_HTML' }} onSubmit={vi.fn()} disabled={false} />);

    const iframe = screen.getByTitle('Interaktywny moduł szkoleniowy') as HTMLIFrameElement;
    expect(iframe.srcdoc).toBe('');
  });

  it('respektuje prop disabled (np. w trakcie zapisu poprzedniego bloku)', () => {
    render(<EmbeddedHtmlBlock block={block} onSubmit={vi.fn()} disabled />);

    expect(screen.getByRole('button', { name: 'Ukończyłem' })).toBeDisabled();
  });
});
