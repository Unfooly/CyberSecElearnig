import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import MascotOverlay from './MascotOverlay';
import { OverlayStackProvider, useOverlayLayer } from './overlay-stack';

// Warstwa, którą test może otworzyć/zamknąć na żądanie (hotfix fix/mascot-overlap) - symuluje kartę
// hotspotu/notatnik/transkrypcję/nagrodę bez montowania prawdziwego SceneHotspotsBlock.tsx.
function ToggleableLayer() {
  const [open, setOpen] = useState(false);
  useOverlayLayer('hotspotCard', open, () => setOpen(false));
  return (
    <button type="button" onClick={() => setOpen((o) => !o)}>
      przełącz nakładkę
    </button>
  );
}

describe('MascotOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nic nie renderuje bez pose', () => {
    render(<MascotOverlay />);
    expect(screen.queryByTestId('mascot-says')).not.toBeInTheDocument();
  });

  it('samą ikonę bez dymka, gdy nie ma tekstu', () => {
    render(<MascotOverlay pose="greeting" />);
    expect(screen.getByTestId('mascot-says')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tekst dymka jest w role="status" aria-live="polite" POZA przyciskiem ikony - nie jest jego etykietą', () => {
    render(<MascotOverlay pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Cześć! Zaczynamy.');
    const iconButton = screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' });
    expect(iconButton).not.toContainElement(status);
    expect(iconButton).toHaveAccessibleName('Fooli - pokaż wiadomość');
  });

  it('po 8 s dymek zwija się WIZUALNIE (opacity-0, max-h-0), ale zostaje w DOM - klik w ikonę rozwija go z powrotem', () => {
    render(<MascotOverlay pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    const bubble = status.parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(bubble.className).toMatch(/opacity-0/);
    expect(bubble.className).toMatch(/max-h-0/);
    // Nie unmount/aria-hidden: tekst nadal jest osiągalny w drzewie.
    expect(screen.getByRole('status')).toHaveTextContent('Cześć! Zaczynamy.');
    expect(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' }));
    expect(bubble.className).toMatch(/opacity-100/);
    expect(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('osobny przycisk X "Zwiń" zwija dymek ręcznie, bez czekania na 8 s', () => {
    render(<MascotOverlay pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    const bubble = status.parentElement as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: 'Zwiń wiadomość maskotki' }));

    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('zwinięcie NIE przenosi fokusu (inaczej niż NotesDrawer/TranscriptPanel - to nie modal)', () => {
    render(<MascotOverlay pose="greeting" text="Cześć! Zaczynamy." />);
    const collapseButton = screen.getByRole('button', { name: 'Zwiń wiadomość maskotki' });
    collapseButton.focus();

    fireEvent.click(collapseButton);

    // Zamiast przenosić fokus gdziekolwiek, przycisk X po prostu zostaje w DOM (dymek jest tylko WIZUALNIE
    // zwinięty), więc fokus nigdy nie "spada" na body - to jest cała treść tego wymagania.
    expect(collapseButton).toBe(document.activeElement);
  });

  it('nowy komunikat (zmiana text przy tym samym pose) rozwija dymek z powrotem i resetuje odliczanie 8 s', () => {
    const { rerender } = render(<MascotOverlay pose="greeting" text="Pierwszy." />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    const firstBubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(firstBubble.className).toMatch(/opacity-0/);

    rerender(<MascotOverlay pose="greeting" text="Drugi." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);
    expect(screen.getByRole('status')).toHaveTextContent('Drugi.');

    // Nie zwija się przed upływem nowych 8 s.
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(bubble.className).toMatch(/opacity-100/);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('hotfix fix/mascot-overlap (kod review, druga runda - regresja): PROGRAMOWE przeniesienie fokusu (np. na nagłówek nowego bloku, jak robi CoursePlayer.tsx po każdej zmianie bloku) NIE zwija świeżo rozwiniętego dymku - tylko prawdziwa interakcja użytkownika (pointerdown/keydown/change) to robi', () => {
    render(
      <>
        <h2 tabIndex={-1}>Nagłówek nowego bloku</h2>
        <MascotOverlay pose="pointing" text="Rozejrzyj się." />
      </>,
    );
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    // element.focus() bezpośrednio (nie fireEvent.keyDown/pointerDown) - dokładnie to, co CoursePlayer.tsx robi
    // programowo po zmianie displayedIndex/feedback/isSummaryMode (headingRef.current?.focus()). Wcześniej nasłuch
    // obejmował też `focusin`, więc TEN sam scenariusz zwijał dymek natychmiast po KAŻDEJ zmianie bloku - user nigdy
    // nie zdążył go zobaczyć.
    act(() => {
      screen.getByText('Nagłówek nowego bloku').focus();
    });

    expect(bubble.className).toMatch(/opacity-100/);
  });

  it('animacja zwijania jest wyłączona pod prefers-reduced-motion (motion-reduce:transition-none)', () => {
    render(<MascotOverlay pose="greeting" text="Cześć! Zaczynamy." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/motion-reduce:transition-none/);
  });

  describe('hotfix fix/mascot-overlap: dymek/ikonka nie mogą zasłaniać ani łapać kliknięć nakładki overlay-stack (karta hotspotu, notatnik, transkrypcja, nagroda)', () => {
    function renderWithOverlay() {
      return render(
        <OverlayStackProvider>
          <MascotOverlay pose="pointing" text="Rozejrzyj się." />
          <ToggleableLayer />
        </OverlayStackProvider>,
      );
    }

    it('otwarta nakładka: dymek znika BEZ animacji, ikonka dostaje invisible (visibility:hidden - usuwa ją też z kolejności Tab i drzewa dostępności, nie tylko z widoku) + aria-hidden/tabIndex=-1, pointer-events-none', () => {
      renderWithOverlay();
      const iconButton = screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' });
      const bubble = screen.getByRole('status').parentElement as HTMLElement;
      expect(iconButton.className).toMatch(/\bvisible\b/);
      expect(iconButton).not.toHaveAttribute('aria-hidden');
      expect(iconButton).not.toHaveAttribute('tabindex');
      expect(bubble.className).toMatch(/opacity-100/);

      fireEvent.click(screen.getByRole('button', { name: 'przełącz nakładkę' }));

      expect(iconButton.className).toMatch(/invisible/);
      expect(iconButton.className).toMatch(/pointer-events-none/);
      expect(iconButton).toHaveAttribute('aria-hidden', 'true');
      expect(iconButton).toHaveAttribute('tabindex', '-1');
      expect(bubble.className).toMatch(/opacity-0/);
      expect(bubble.className).toMatch(/pointer-events-none/);
    });

    it('zamknięcie nakładki: ikonka wraca (visible, osiągalna dla Tab i czytnika ekranu), ale dymek ZOSTAJE zwinięty - nie rozwija się sam; klik w ikonę go rozwija', () => {
      renderWithOverlay();
      const iconButton = screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' });
      const bubble = screen.getByRole('status').parentElement as HTMLElement;
      const toggle = screen.getByRole('button', { name: 'przełącz nakładkę' });

      fireEvent.click(toggle); // otwórz
      fireEvent.click(toggle); // zamknij

      expect(iconButton.className).toMatch(/\bvisible\b/);
      expect(iconButton.className).not.toMatch(/invisible/);
      expect(iconButton.className).not.toMatch(/pointer-events-none/);
      expect(iconButton).not.toHaveAttribute('aria-hidden');
      expect(iconButton).not.toHaveAttribute('tabindex');
      expect(bubble.className).toMatch(/opacity-0/);

      // Jedyna ścieżka powrotu dymku poza nowym komunikatem: klik w ikonę.
      fireEvent.click(iconButton);
      expect(bubble.className).toMatch(/opacity-100/);
    });
  });

  it('hotfix fix/mascot-overlap: pierwsza interakcja POZA nakładką maskotki (klik gdziekolwiek w bloku) zwija dymek od razu, bez czekania na 8 s', () => {
    render(
      <>
        <button type="button">gdzieś w treści bloku</button>
        <MascotOverlay pose="pointing" text="Rozejrzyj się." />
      </>,
    );
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'gdzieś w treści bloku' }));

    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('pointerdown na WŁASNEJ ikonie maskotki nie liczy się jako "interakcja z blokiem" - nie zwija dymku, który właśnie się rozwinął (inaczej klik w ikonę, żeby GO rozwinąć, cofałby się sam)', () => {
    render(<MascotOverlay pose="pointing" text="Rozejrzyj się." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/); // świeżo zamontowany, rozwinięty

    // pointerdown poprzedza click w każdej prawdziwej przeglądarce - sprawdzone OSOBNO (nie tylko przez fireEvent.click,
    // który w jsdom nie wysyła własnego pointerdown), żeby nasłuch document'owy faktycznie miał okazję zadziałać.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' }));

    expect(bubble.className).toMatch(/opacity-100/);
  });
});
