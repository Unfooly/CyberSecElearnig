import { StrictMode, useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import MascotBanner from './MascotBanner';
import { OverlayStackProvider, useOverlayLayer } from './overlay-stack';

// Ten sam wzorzec testowy co MascotOverlay.test.tsx (fix/dialogue-polish - wspólny hook useMascotCollapse) -
// weryfikuje, że banner dziedziczy DOKŁADNIE to samo zachowanie zwijania, tylko z innym markupem (pasek w
// normalnym przepływie, nie floating nakładka - patrz komentarz w MascotBanner.tsx).
function ToggleableLayer() {
  const [open, setOpen] = useState(false);
  useOverlayLayer('hotspotCard', open, () => setOpen(false));
  return (
    <button type="button" onClick={() => setOpen((o) => !o)}>
      przełącz nakładkę
    </button>
  );
}

describe('MascotBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nic nie renderuje bez pose', () => {
    render(<MascotBanner />);
    expect(screen.queryByTestId('mascot-banner')).not.toBeInTheDocument();
  });

  it('samą ikonę bez dymka, gdy nie ma tekstu', () => {
    render(<MascotBanner pose="greeting" />);
    expect(screen.getByTestId('mascot-banner')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tekst jest w role="status" aria-live="polite" POZA przyciskiem ikony - nie jest jego etykietą', () => {
    render(<MascotBanner pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Cześć! Zaczynamy.');
    const iconButton = screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' });
    expect(iconButton).not.toContainElement(status);
    expect(iconButton).toHaveAccessibleName('Fooli - pokaż wiadomość');
  });

  it('po 8 s tekst zwija się WIZUALNIE (opacity-0, max-h-0), ale zostaje w DOM - klik w ikonę rozwija go z powrotem', () => {
    render(<MascotBanner pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    const bubble = status.parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(bubble.className).toMatch(/opacity-0/);
    expect(bubble.className).toMatch(/max-h-0/);
    expect(screen.getByRole('status')).toHaveTextContent('Cześć! Zaczynamy.');
    expect(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' }));
    expect(bubble.className).toMatch(/opacity-100/);
    expect(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('osobny przycisk X "Zwiń" zwija tekst ręcznie, bez czekania na 8 s', () => {
    render(<MascotBanner pose="greeting" text="Cześć! Zaczynamy." />);
    const status = screen.getByRole('status');
    const bubble = status.parentElement as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: 'Zwiń wiadomość maskotki' }));

    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('zwinięcie NIE przenosi fokusu', () => {
    render(<MascotBanner pose="greeting" text="Cześć! Zaczynamy." />);
    const collapseButton = screen.getByRole('button', { name: 'Zwiń wiadomość maskotki' });
    collapseButton.focus();

    fireEvent.click(collapseButton);

    expect(collapseButton).toBe(document.activeElement);
  });

  it('nowy komunikat (zmiana text przy tym samym pose) rozwija z powrotem i resetuje odliczanie 8 s', () => {
    const { rerender } = render(<MascotBanner pose="greeting" text="Pierwszy." />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    const firstBubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(firstBubble.className).toMatch(/opacity-0/);

    rerender(<MascotBanner pose="greeting" text="Drugi." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
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

  it('programowe przeniesienie fokusu (np. na nagłówek nowego bloku) NIE zwija świeżo rozwiniętego tekstu - tylko prawdziwa interakcja użytkownika to robi', () => {
    render(
      <>
        <h2 tabIndex={-1}>Nagłówek nowego bloku</h2>
        <MascotBanner pose="pointing" text="Rozejrzyj się." />
      </>,
    );
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    act(() => {
      screen.getByText('Nagłówek nowego bloku').focus();
    });

    expect(bubble.className).toMatch(/opacity-100/);
  });

  it('animacja zwijania jest wyłączona pod prefers-reduced-motion (motion-reduce:transition-none)', () => {
    render(<MascotBanner pose="greeting" text="Cześć! Zaczynamy." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/motion-reduce:transition-none/);
  });

  it('otwarta nakładka overlay-stack (karta hotspotu/notatnik/transkrypcja): tekst zwija się (ten sam useMascotCollapse co MascotOverlay.tsx); aria-expanded na ikonie idzie za bubbleVisible, NIE za collapsed - ikona bannera (inaczej niż MascotOverlay.tsx) zostaje klikalna, więc aria-expanded musi zgadzać się z tym, co faktycznie widać', () => {
    render(
      <OverlayStackProvider>
        <MascotBanner pose="pointing" text="Rozejrzyj się." />
        <ToggleableLayer />
      </OverlayStackProvider>,
    );
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    const icon = screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' });
    expect(bubble.className).toMatch(/opacity-100/);
    expect(icon).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'przełącz nakładkę' }));

    expect(bubble.className).toMatch(/opacity-0/);
    // Dymek jest schowany z powodu OTWARTEJ NAKŁADKI (nie kliknięcia X) - collapsed w stanie hooka zostaje `false`,
    // ale aria-expanded musi mówić "false" (zgodnie z bubbleVisible), nie "true" (co dałoby !collapsed).
    expect(icon).toHaveAttribute('aria-expanded', 'false');
  });

  it('pierwsza interakcja POZA banerem (klik gdziekolwiek w bloku) zwija tekst od razu, bez czekania na 8 s', () => {
    render(
      <>
        <button type="button">gdzieś w treści bloku</button>
        <MascotBanner pose="pointing" text="Rozejrzyj się." />
      </>,
    );
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'gdzieś w treści bloku' }));

    expect(bubble.className).toMatch(/opacity-0/);
  });

  it('pointerdown na WŁASNEJ ikonie nie liczy się jako "interakcja z blokiem" - nie zwija tekstu, który właśnie się rozwinął', () => {
    render(<MascotBanner pose="pointing" text="Rozejrzyj się." />);
    const bubble = screen.getByRole('status').parentElement as HTMLElement;
    expect(bubble.className).toMatch(/opacity-100/);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fooli - pokaż wiadomość' }));

    expect(bubble.className).toMatch(/opacity-100/);
  });

  describe('kod review, druga runda: świeży montaż PODCZAS gdy nakładka jest JUŻ otwarta i USTABILIZOWANA (nie otwiera się PO montażu) - nie może TRWALE zwinąć tekstu z powodu nakładki, która nigdy nie dotyczyła TEGO komponentu', () => {
    function PreOpenedLayer({ children }: { children?: ReactNode }) {
      const [open, setOpen] = useState(true);
      useOverlayLayer('hotspotCard', open, () => setOpen(false));
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            zamknij nakładkę
          </button>
          {children}
        </>
      );
    }

    it('montaż przy JUŻ otwartej, USTABILIZOWANEJ nakładce (kontekst `anyOpen` już `true` PRZED pierwszym renderem bannera, nie dopiero po jego efektach - dokładnie jak przy odmontowaniu SĄSIADA w TYM SAMYM commit\'cie co montaż bannera): tekst zamknięty na czas nakładki, ale PO jej zamknięciu wraca - nie zostaje zwinięty na trwałe przez wartość widzianą przy montowaniu', () => {
      const { rerender } = render(
        <OverlayStackProvider>
          <PreOpenedLayer />
        </OverlayStackProvider>,
      );
      // `useOverlayLayer` rejestruje się w EFEKCIE (nie synchronicznie przy renderze) - ten pierwszy render+flush
      // USTABILIZOWAŁ `anyOpen=true` w providerze, zanim banner w ogóle istnieje. Dopiero TERAZ montujemy banner -
      // jego pierwszy render czyta z kontekstu JUŻ `true` (nie dowiaduje się o tym po własnych efektach), dokładnie
      // jak w prawdziwej regresji (sąsiad-blok odmontowuje się w TYM SAMYM commit'cie, w którym świeży banner się
      // montuje, więc `anyOverlayOpen` widziane przez jego PIERWSZY render jest już nieaktualne/nie-jego).
      rerender(
        <OverlayStackProvider>
          <PreOpenedLayer>
            <MascotBanner pose="pointing" text="Rozejrzyj się." />
          </PreOpenedLayer>
        </OverlayStackProvider>,
      );
      const bubble = screen.getByRole('status').parentElement as HTMLElement;
      expect(bubble.className).toMatch(/opacity-0/); // nakładka otwarta - bubbleVisible=false niezależnie od collapsed

      fireEvent.click(screen.getByRole('button', { name: 'zamknij nakładkę' }));

      // Gdyby świeży montaż TRWALE zwinął dymek na widok anyOverlayOpen=true sprzed commitu (regresja, którą
      // poprzednia wersja tego hooka naprawiała przez "pomiń pierwsze wywołanie" - łamiące się pod StrictMode),
      // tekst zostałby zwinięty na zawsze. Zamknięcie nakładki, która nigdy nie dotyczyła TEGO komponentu, musi
      // pozwolić mu wrócić.
      expect(bubble.className).toMatch(/opacity-100/);
    });

    it('to samo pod React.StrictMode (dev, next.config.mjs ma reactStrictMode:true) - montowanie/cleanup/montowanie NIE MOŻE sprawić, że drugie "pierwsze" wywołanie przestanie być pierwsze (regresja starej wersji tego hooka: "pomiń pierwsze wywołanie efektu" liczone przez `useRef(false)` przetrwałoby symulację StrictMode, więc DRUGIE wywołanie w dev wyłapywałoby nieaktualne anyOverlayOpen=true jako "prawdziwe" i zwijałoby na trwałe - w produkcji bez StrictMode działałoby poprawnie, dev nie)', () => {
      const { rerender } = render(
        <StrictMode>
          <OverlayStackProvider>
            <PreOpenedLayer />
          </OverlayStackProvider>
        </StrictMode>,
      );
      rerender(
        <StrictMode>
          <OverlayStackProvider>
            <PreOpenedLayer>
              <MascotBanner pose="pointing" text="Rozejrzyj się." />
            </PreOpenedLayer>
          </OverlayStackProvider>
        </StrictMode>,
      );
      const bubble = screen.getByRole('status').parentElement as HTMLElement;
      expect(bubble.className).toMatch(/opacity-0/);

      fireEvent.click(screen.getByRole('button', { name: 'zamknij nakładkę' }));

      expect(bubble.className).toMatch(/opacity-100/);
    });
  });
});
