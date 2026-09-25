import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranscriptPanel from './TranscriptPanel';
import { OverlayStackProvider, useCloseTopOverlay } from './overlay-stack';

// Port częściowy z dawnego NarrationPlayer.test.tsx (transkrypcja rozwinięta inline) - treść jest teraz osobnym
// pływającym panelem NAD paskiem, nie rozwijanym wierszem pod napisami.

function CloseTopButton() {
  const closeTop = useCloseTopOverlay();
  return (
    <button type="button" onClick={() => closeTop()}>
      Escape (symulacja)
    </button>
  );
}

describe('TranscriptPanel', () => {
  it('zamknięty: nic się nie renderuje', () => {
    const { container } = render(<TranscriptPanel text="Pierwsze zdanie. Drugie zdanie." open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('otwarty: pełny tekst narracji, limit wysokości z przewijaniem (nie wypycha przycisków nawigacji)', () => {
    render(<TranscriptPanel text="Pierwsze zdanie. Drugie zdanie." open onClose={vi.fn()} />);

    const panel = screen.getByRole('region', { name: 'Transkrypcja narracji' });
    expect(panel).toHaveTextContent('Pierwsze zdanie. Drugie zdanie.');
    expect(panel.className).toMatch(/max-h-/);
    expect(panel.className).toMatch(/overflow-y-auto/);
  });

  it('fokus ląduje na przycisku zamknięcia po otwarciu', () => {
    render(<TranscriptPanel text="Treść." open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Zamknij transkrypcję' })).toHaveFocus();
  });

  it('przycisk zamknięcia woła onClose', () => {
    const onClose = vi.fn();
    render(<TranscriptPanel text="Treść." open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij transkrypcję' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejestruje się w overlay-stack jako warstwa "transcript" - closeTop() ją zamyka, gdy jest otwarta', () => {
    const onClose = vi.fn();
    render(
      <OverlayStackProvider>
        <TranscriptPanel text="Treść." open onClose={onClose} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Escape (symulacja)' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('zamknięty panel nie jest zarejestrowany jako otwarty - closeTop() go pomija', () => {
    const onClose = vi.fn();
    render(
      <OverlayStackProvider>
        <TranscriptPanel text="Treść." open={false} onClose={onClose} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Escape (symulacja)' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
