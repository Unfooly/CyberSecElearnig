import { StrictMode, useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import Hint from './Hint';
import { OverlayStackProvider, useOverlayLayer } from './overlay-stack';

// Przypadki przeniesione z MascotBanner.test.tsx i MascotOverlay.test.tsx (D-093) - to samo zachowanie zwijania
// (useHintCollapse), bez postaci: sam tekst i ikona żarówki.
function ToggleableLayer() {
  const [open, setOpen] = useState(false);
  useOverlayLayer('hotspotCard', open, () => setOpen(false));
  return (
    <button type="button" onClick={() => setOpen((o) => !o)}>
      przełącz nakładkę
    </button>
  );
}

const bubbleOf = () => screen.getByRole('status').parentElement as HTMLElement;
const showButton = () => screen.getByRole('button', { name: 'Pokaż podpowiedź' });

describe.each(['bar', 'overlay'] as const)('Hint (%s): wspólne zachowanie', (variant) => {
  const testId = variant === 'bar' ? 'hint-bar' : 'hint-overlay';
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nic nie renderuje bez tekstu', () => {
    render(<Hint variant={variant} />);
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  });

  it('bez postaci: żadnego obrazka, tylko ikona i tekst', () => {
    render(<Hint variant={variant} text="Rozejrzyj się." />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('tekst jest w role="status" aria-live="polite" POZA przyciskiem ikony - nie jest jego etykietą', () => {
    render(<Hint variant={variant} text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Cześć! Zaczynamy.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(showButton()).not.toContainElement(status);
    expect(showButton()).toHaveAccessibleName('Pokaż podpowiedź');
  });

  it('po 8 s tekst zwija się WIZUALNIE (opacity-0, max-h-0), ale zostaje w DOM - klik w ikonę rozwija go z powrotem', () => {
    render(<Hint variant={variant} text="Cześć! Zaczynamy." />);
    const bubble = bubbleOf();
    expect(bubble.className).toMatch(/opacity-100/);
    expect(showButton()).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(bubble.className).toMatch(/opacity-0/);
    expect(bubble.className).toMatch(/max-h-0/);
    expect(screen.getByRole('status')).toHaveTextContent('Cześć! Zaczynamy.');
    expect(showButton()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(showButton());
    expect(bubble.className).toMatch(/opacity-100/);
    expect(showButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('przycisk X "Zwiń podpowiedź" zwija tekst ręcznie i NIE przenosi fokusu', () => {
    render(<Hint variant={variant} text="Cześć! Zaczynamy." />);
    const collapseButton = screen.getByRole('button', { name: 'Zwiń podpowiedź' });
    collapseButton.focus();

    fireEvent.click(collapseButton);

    expect(bubbleOf().className).toMatch(/opacity-0/);
    expect(collapseButton).toBe(document.activeElement);
  });

  it('nowy tekst rozwija z powrotem i resetuje odliczanie 8 s', () => {
    const { rerender } = render(<Hint variant={variant} text="Pierwszy." />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(bubbleOf().className).toMatch(/opacity-0/);

    rerender(<Hint variant={variant} text="Drugi." />);
    const bubble = bubbleOf();
    expect(bubble.className).toMatch(/opacity-100/);
    expect(screen.getByRole('status')).toHaveTextContent('Drugi.');

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(bubble.className).toMatch(/opacity-100/);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('programowe przeniesienie fokusu (np. na nagłówek nowego bloku) NIE zwija świeżo rozwiniętego tekstu', () => {
    render(
      <>
        <h2 tabIndex={-1}>Nagłówek nowego bloku</h2>
        <Hint variant={variant} text="Rozejrzyj się." />
      </>,
    );
    act(() => {
      screen.getByText('Nagłówek nowego bloku').focus();
    });
    expect(bubbleOf().className).toMatch(/opacity-100/);
  });

  it('animacja zwijania jest wyłączona pod prefers-reduced-motion (motion-reduce:transition-none)', () => {
    render(<Hint variant={variant} text="Cześć!" />);
    expect(bubbleOf().className).toMatch(/motion-reduce:transition-none/);
  });

  it('pierwsza interakcja (click) POZA dymkiem zwija tekst od razu; klik we WŁASNĄ ikonę - nie', () => {
    render(
      <>
        <button type="button">gdzieś w treści bloku</button>
        <Hint variant={variant} text="Rozejrzyj się." />
      </>,
    );
    fireEvent.click(showButton());
    expect(bubbleOf().className).toMatch(/opacity-100/);

    fireEvent.click(screen.getByRole('button', { name: 'gdzieś w treści bloku' }));
    expect(bubbleOf().className).toMatch(/opacity-0/);
  });

  it('sam pointerdown poza dymkiem NIE zwija tekstu - zwinięcie przed click przesuwało treść i dotyk trafiał obok przycisku', () => {
    render(
      <>
        <Hint variant={variant} text="Rozejrzyj się." />
        <button type="button">Zakończ szkolenie</button>
      </>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Zakończ szkolenie' }));
    expect(bubbleOf().className).toMatch(/opacity-100/);
  });

  it('wpisywanie w pole (input) zwija tekst; samo `change` (blur pola przy wciśnięciu „Sprawdź”) - nie, bo przesunięcie gubiło dotyk (D-099)', () => {
    render(
      <>
        <Hint variant={variant} text="Pamiętasz?" />
        <input aria-label="adres" />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'adres' });
    fireEvent.change(field, { target: { value: 'bank.pl' } });
    // fireEvent.change ustawia wartość i wysyła `change` - bez `input` dymek zostaje.
    expect(bubbleOf().className).toMatch(/opacity-100/);
    fireEvent.input(field, { target: { value: 'bank.pl2' } });
    expect(bubbleOf().className).toMatch(/opacity-0/);
  });

  it('otwarta nakładka overlay-stack (bez żadnej interakcji) zwija tekst; aria-expanded idzie za tym, co widać', () => {
    function ControlledLayer({ open }: { open: boolean }) {
      useOverlayLayer('hotspotCard', open, () => {});
      return null;
    }
    const tree = (open: boolean) => (
      <OverlayStackProvider>
        <Hint variant={variant} text="Rozejrzyj się." />
        <ControlledLayer open={open} />
      </OverlayStackProvider>
    );
    const { rerender } = render(tree(false));
    const bubble = bubbleOf();
    const icon = showButton();
    expect(bubble.className).toMatch(/opacity-100/);

    rerender(tree(true));

    expect(bubble.className).toMatch(/opacity-0/);
    expect(icon).toHaveAttribute('aria-expanded', 'false');

    // Po zamknięciu nakładki dymek zostaje zwinięty (collapsed ustawione przy przejściu zamknięta -> otwarta).
    rerender(tree(false));
    expect(bubble.className).toMatch(/opacity-0/);
  });

  describe('świeży montaż przy JUŻ otwartej, ustabilizowanej nakładce nie zwija tekstu na trwałe', () => {
    // Nakładka sterowana propem (bez kliknięcia - click sam w sobie zwija dymek i zamaskowałby regresję).
    function PreOpenedLayer({ open, children }: { open: boolean; children?: ReactNode }) {
      useOverlayLayer('hotspotCard', open, () => {});
      return <>{children}</>;
    }

    it.each([false, true])('StrictMode=%s: po zamknięciu nakładki tekst wraca', (strict) => {
      const wrap = (node: ReactNode) => (strict ? <StrictMode>{node}</StrictMode> : <>{node}</>);
      const { rerender } = render(
        wrap(
          <OverlayStackProvider>
            <PreOpenedLayer open />
          </OverlayStackProvider>,
        ),
      );
      rerender(
        wrap(
          <OverlayStackProvider>
            <PreOpenedLayer open>
              <Hint variant={variant} text="Rozejrzyj się." />
            </PreOpenedLayer>
          </OverlayStackProvider>,
        ),
      );
      const bubble = bubbleOf();
      expect(bubble.className).toMatch(/opacity-0/);

      rerender(
        wrap(
          <OverlayStackProvider>
            <PreOpenedLayer open={false}>
              <Hint variant={variant} text="Rozejrzyj się." />
            </PreOpenedLayer>
          </OverlayStackProvider>,
        ),
      );

      expect(bubble.className).toMatch(/opacity-100/);
    });
  });
});

describe('Hint (overlay): nie zasłania ani nie łapie kliknięć nakładki overlay-stack', () => {
  function renderWithOverlay() {
    render(
      <OverlayStackProvider>
        <Hint variant="overlay" text="Rozejrzyj się." />
        <ToggleableLayer />
      </OverlayStackProvider>,
    );
  }

  it('otwarta nakładka: ikona invisible + aria-hidden + poza Tab, dymek zwinięty i nie łapie kliknięć - ale region status ZOSTAJE w drzewie dostępności', () => {
    renderWithOverlay();
    const root = screen.getByTestId('hint-overlay');
    const icon = showButton();
    const bubble = bubbleOf();
    expect(root.className).toMatch(/pointer-events-none/);
    expect(icon).not.toHaveAttribute('aria-hidden');

    fireEvent.click(screen.getByRole('button', { name: 'przełącz nakładkę' }));

    expect(icon.className).toMatch(/invisible/);
    expect(icon.className).toMatch(/pointer-events-none/);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('tabindex', '-1');
    expect(bubble.className).toMatch(/opacity-0/);
    expect(bubble.className).toMatch(/pointer-events-none/);
    // Czytnik ekranu nadal ma region aria-live (bez hidden: true) - reakcja pod zbliżeniem zostanie ogłoszona.
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('status')).toHaveTextContent('Rozejrzyj się.');
  });

  it('zamknięcie nakładki: ikona wraca (widoczna i osiągalna), ale dymek ZOSTAJE zwinięty; klik w ikonę go rozwija', () => {
    renderWithOverlay();
    const toggle = screen.getByRole('button', { name: 'przełącz nakładkę' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    const icon = showButton();
    expect(icon.className).not.toMatch(/invisible/);
    expect(icon).not.toHaveAttribute('aria-hidden');
    expect(icon).not.toHaveAttribute('tabindex');
    expect(bubbleOf().className).toMatch(/opacity-0/);

    fireEvent.click(icon);
    expect(bubbleOf().className).toMatch(/opacity-100/);
  });
});

describe.each(['bar', 'overlay'] as const)('Hint (%s): ikona przy rozwiniętym dymku', (variant) => {
  it('rozwinięty dymek: ikona sr-only i poza Tab (niewidoczny fokus 1 px, WCAG 2.4.7); zwinięty: ikona w Tab', () => {
    render(<Hint variant={variant} text="Rozejrzyj się." />);
    expect(showButton().className).toMatch(/sr-only/);
    expect(showButton()).toHaveAttribute('tabindex', '-1');

    fireEvent.click(screen.getByRole('button', { name: 'Zwiń podpowiedź' }));

    expect(showButton().className).not.toMatch(/sr-only/);
    expect(showButton()).not.toHaveAttribute('tabindex');
  });
});

describe('Hint (bar): w normalnym przepływie, nie nakładka', () => {
  it('pasek nie jest pozycjonowany absolutnie, a jego ikona nie chowa się przy nakładce (zwija się tylko tekst)', () => {
    render(
      <OverlayStackProvider>
        <Hint variant="bar" text="Sprawdź nadawcę." />
        <ToggleableLayer />
      </OverlayStackProvider>,
    );
    const root = screen.getByTestId('hint-bar');
    expect(root.className).not.toMatch(/absolute/);
    fireEvent.click(screen.getByRole('button', { name: 'przełącz nakładkę' }));
    expect(showButton()).not.toHaveAttribute('aria-hidden');
    expect(showButton().className).not.toMatch(/invisible/);
    expect(showButton()).not.toHaveAttribute('tabindex');
  });
});
