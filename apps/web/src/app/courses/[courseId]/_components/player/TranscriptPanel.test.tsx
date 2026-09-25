import { useRef, useState } from 'react';
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

// Ref pusty (bez przycisku "Transkrypcja") tam, gdzie test nie sprawdza powrotu fokusu - komponent sam obsługuje
// triggerRef.current będące null (żaden trigger nie istnieje w drzewie).
const noTrigger = { current: null };

// Harness z prawdziwym przyciskiem-triggerem i kontrolowanym `open`, żeby przetestować powrót fokusu po zamknięciu
// (ten sam wzorzec co NotesDrawer - fokus wraca na trigger przy KAŻDYM zamknięciu, nie tylko po kliknięciu X).
function Harness({ onCloseSpy, closeWith }: { onCloseSpy: () => void; closeWith: 'x' | 'closeTop' }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <OverlayStackProvider>
      <button ref={triggerRef} type="button">
        Transkrypcja
      </button>
      <TranscriptPanel
        text="Treść."
        open={open}
        onClose={() => {
          onCloseSpy();
          setOpen(false);
        }}
        triggerRef={triggerRef}
      />
      {closeWith === 'closeTop' && <CloseTopButton />}
    </OverlayStackProvider>
  );
}

describe('TranscriptPanel', () => {
  it('zamknięty: nic się nie renderuje', () => {
    const { container } = render(<TranscriptPanel text="Pierwsze zdanie. Drugie zdanie." open={false} onClose={vi.fn()} triggerRef={noTrigger} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('otwarty: pełny tekst narracji, limit wysokości z przewijaniem (nie wypycha przycisków nawigacji)', () => {
    render(<TranscriptPanel text="Pierwsze zdanie. Drugie zdanie." open onClose={vi.fn()} triggerRef={noTrigger} />);

    const panel = screen.getByRole('region', { name: 'Transkrypcja narracji' });
    expect(panel).toHaveTextContent('Pierwsze zdanie. Drugie zdanie.');
    expect(panel.className).toMatch(/max-h-/);
    expect(panel.className).toMatch(/overflow-y-auto/);
  });

  it('fokus ląduje na przycisku zamknięcia po otwarciu', () => {
    render(<TranscriptPanel text="Treść." open onClose={vi.fn()} triggerRef={noTrigger} />);
    expect(screen.getByRole('button', { name: 'Zamknij transkrypcję' })).toHaveFocus();
  });

  it('przycisk zamknięcia woła onClose', () => {
    const onClose = vi.fn();
    render(<TranscriptPanel text="Treść." open onClose={onClose} triggerRef={noTrigger} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij transkrypcję' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejestruje się w overlay-stack jako warstwa "transcript" - closeTop() ją zamyka, gdy jest otwarta', () => {
    const onClose = vi.fn();
    render(
      <OverlayStackProvider>
        <TranscriptPanel text="Treść." open onClose={onClose} triggerRef={noTrigger} />
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
        <TranscriptPanel text="Treść." open={false} onClose={onClose} triggerRef={noTrigger} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Escape (symulacja)' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('B2 (kod review PR #44): fokus wraca na przycisk "Transkrypcja" po zamknięciu przyciskiem X', () => {
    const onCloseSpy = vi.fn();
    render(<Harness onCloseSpy={onCloseSpy} closeWith="x" />);

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij transkrypcję' }));

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Transkrypcja' })).toHaveFocus();
  });

  it('B2: fokus wraca na przycisk "Transkrypcja" też po zamknięciu przez closeTop() (Escape z overlay-stack)', () => {
    const onCloseSpy = vi.fn();
    render(<Harness onCloseSpy={onCloseSpy} closeWith="closeTop" />);

    fireEvent.click(screen.getByRole('button', { name: 'Escape (symulacja)' }));

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Transkrypcja' })).toHaveFocus();
  });
});
