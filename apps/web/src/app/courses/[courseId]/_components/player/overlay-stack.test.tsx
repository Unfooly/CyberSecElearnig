import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverlayStackProvider, useOverlayLayer, useCloseTopOverlay, type OverlayLayer } from './overlay-stack';

function Layer({ layer, log }: { layer: OverlayLayer; log: string[] }) {
  const [open, setOpen] = useState(true);
  useOverlayLayer(layer, open, () => {
    log.push(layer);
    setOpen(false);
  });
  return <output data-testid={`open-${layer}`}>{String(open)}</output>;
}

function CloseTopButton() {
  const closeTop = useCloseTopOverlay();
  return (
    <button type="button" onClick={() => closeTop()}>
      zamknij górną warstwę
    </button>
  );
}

describe('overlay-stack: closeTop() zamyka WYŁĄCZNIE najwyższą priorytetowo otwartą warstwę', () => {
  it('kolejność priorytetu: karta hotspotu -> transkrypcja -> notatnik -> pełny ekran, jeden Escape/wywołanie = jedno zamknięcie', () => {
    const log: string[] = [];
    render(
      <OverlayStackProvider>
        <Layer layer="notebook" log={log} />
        <Layer layer="hotspotCard" log={log} />
        <Layer layer="transcript" log={log} />
        <Layer layer="fullscreen" log={log} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    const button = screen.getByRole('button', { name: 'zamknij górną warstwę' });
    fireEvent.click(button);
    expect(log).toEqual(['hotspotCard']);
    expect(screen.getByTestId('open-hotspotCard')).toHaveTextContent('false');
    expect(screen.getByTestId('open-transcript')).toHaveTextContent('true');

    fireEvent.click(button);
    expect(log).toEqual(['hotspotCard', 'transcript']);

    fireEvent.click(button);
    expect(log).toEqual(['hotspotCard', 'transcript', 'notebook']);

    fireEvent.click(button);
    expect(log).toEqual(['hotspotCard', 'transcript', 'notebook', 'fullscreen']);
    expect(screen.getByTestId('open-fullscreen')).toHaveTextContent('false');
  });

  it('pomija warstwy zamknięte i trafia od razu w pierwszą otwartą wg priorytetu', () => {
    const log: string[] = [];
    render(
      <OverlayStackProvider>
        <Layer layer="notebook" log={log} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'zamknij górną warstwę' }));

    expect(log).toEqual(['notebook']);
  });

  it('zwraca false i nic nie robi, gdy żadna warstwa nie jest otwarta (albo nie ma żadnej)', () => {
    const onClose = vi.fn();
    function AlwaysClosed() {
      useOverlayLayer('notebook', false, onClose);
      return null;
    }
    let result: boolean | undefined;
    function Probe() {
      const closeTop = useCloseTopOverlay();
      return (
        <button type="button" onClick={() => (result = closeTop())}>
          spróbuj
        </button>
      );
    }
    render(
      <OverlayStackProvider>
        <AlwaysClosed />
        <Probe />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'spróbuj' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('closeTop() poza providerem jest no-opem (false) - nie wywala się bez kontekstu', () => {
    let result: boolean | undefined;
    function Probe() {
      const closeTop = useCloseTopOverlay();
      return (
        <button type="button" onClick={() => (result = closeTop())}>
          spróbuj
        </button>
      );
    }
    render(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'spróbuj' }));

    expect(result).toBe(false);
  });

  it('odmontowanie warstwy usuwa ją z rejestru - closeTop() jej już nie widzi', () => {
    const log: string[] = [];
    function Harness() {
      const [mounted, setMounted] = useState(true);
      return (
        <OverlayStackProvider>
          {mounted && <Layer layer="hotspotCard" log={log} />}
          <Layer layer="notebook" log={log} />
          <button type="button" onClick={() => setMounted(false)}>
            odmontuj kartę
          </button>
          <CloseTopButton />
        </OverlayStackProvider>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'odmontuj kartę' }));
    fireEvent.click(screen.getByRole('button', { name: 'zamknij górną warstwę' }));

    expect(log).toEqual(['notebook']);
  });
});
