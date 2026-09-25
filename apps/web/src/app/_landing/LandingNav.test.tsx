import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LandingNav } from './LandingNav';

describe('LandingNav', () => {
  it('domyślnie (panel zamknięty): logo, "Umów demo", hamburger (aria-expanded=false) i "Zaloguj się" (jedna kopia, w pasku)', () => {
    render(<LandingNav />);

    expect(screen.getByRole('link', { name: 'Unfooly - strona główna' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Umów demo' })).toHaveAttribute('href', '#demo');
    const hamburger = screen.getByRole('button', { name: 'Otwórz menu' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('link', { name: 'Zaloguj się' })).toHaveLength(1);
  });

  it('4 linki sekcji w pasku desktopowym (md+, zawsze w DOM) wskazują na #produkt/#jak/#funkcje/#cennik', () => {
    render(<LandingNav />);

    const desktopNav = screen.getByRole('navigation', { name: 'Sekcje strony' });
    for (const [label, href] of [
      ['Produkt', '#produkt'],
      ['Jak to działa', '#jak'],
      ['Funkcje', '#funkcje'],
      ['Cennik', '#cennik'],
    ]) {
      expect(within(desktopNav).getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('hamburger otwiera panel pod paskiem: aria-expanded=true, ikona/aria-label "Zamknij menu", fokus na pierwszym linku, panel ma 4 linki sekcji + "Zaloguj się"', () => {
    render(<LandingNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));

    const hamburger = screen.getByRole('button', { name: 'Zamknij menu' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    expect(within(panel).getByRole('link', { name: 'Produkt' })).toHaveFocus();
    for (const label of ['Produkt', 'Jak to działa', 'Funkcje', 'Cennik']) {
      expect(within(panel).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(panel).getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/login');
    // Panel otwarty: druga kopia "Zaloguj się" (pierwsza jest w pasku, ukryta CSS-em poniżej md, ale nadal w DOM).
    expect(screen.getAllByRole('link', { name: 'Zaloguj się' })).toHaveLength(2);
  });

  it('klik w link sekcji w panelu zamyka go (aria-expanded wraca na false)', () => {
    render(<LandingNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));

    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    fireEvent.click(within(panel).getByRole('link', { name: 'Cennik' }));

    expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
  });

  it('klik w "Zaloguj się" w panelu też go zamyka', () => {
    render(<LandingNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));

    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const loginLink = within(panel).getByRole('link', { name: 'Zaloguj się' });
    // preventDefault na natywnym kliknięciu: bez tego <Link> próbuje faktycznej nawigacji w jsdom ("Not
    // implemented: navigation") - szum w logach CI niezwiązany z tym, co ten test sprawdza (zamknięcie panelu).
    loginLink.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(loginLink);

    expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape wewnątrz headera (fokus na linku w panelu) zamyka panel i zwraca fokus na hamburger', () => {
    render(<LandingNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const firstLink = within(panel).getByRole('link', { name: 'Produkt' });
    expect(firstLink).toHaveFocus();

    // Escape musi iść przez sam link (nie document) - handler siedzi na <header>, nie na document (patrz test
    // niżej: Escape POZA headerem celowo nic nie robi).
    fireEvent.keyDown(firstLink, { key: 'Escape' });

    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveFocus();
  });

  it('Escape naciśnięty POZA headerem (np. na elemencie treści strony) NIE zamyka panelu ani nie rusza fokusu', () => {
    render(
      <div>
        <LandingNav />
        <button type="button">Coś w Hero</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const firstLink = within(panel).getByRole('link', { name: 'Produkt' });
    expect(firstLink).toHaveFocus();
    const outside = screen.getByRole('button', { name: 'Coś w Hero' });

    // Handler siedzi na <header> (React onKeyDown, bąbelkuje od celu zdarzenia) - zdarzenie z celem POZA
    // headerem nigdy tam nie dotrze, niezależnie od tego, gdzie realnie jest document.activeElement.
    fireEvent.keyDown(outside, { key: 'Escape' });

    expect(panel).toBeInTheDocument();
    expect(firstLink).toHaveFocus();
  });

  it('fokus wychodzący z headera (np. Tab w treść strony pod spodem) zamyka panel BEZ przenoszenia fokusu - header jest sticky i inaczej zasłaniałby treść', () => {
    render(
      <div>
        <LandingNav />
        <button type="button">Coś w Hero</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const lastLink = within(panel).getByRole('link', { name: 'Zaloguj się' });
    const outside = screen.getByRole('button', { name: 'Coś w Hero' });

    fireEvent.blur(lastLink, { relatedTarget: outside });

    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
    // BEZ przenoszenia fokusu na hamburger - w prawdziwej przeglądarce fokus już jest na `outside` (Tab go tam
    // przeniósł); handler tylko zwija panel, nie ingeruje w to, gdzie realnie jest fokus.
    expect(screen.getByRole('button', { name: 'Otwórz menu' })).not.toHaveFocus();
  });

  it('fokus wychodzący z headera donikąd (relatedTarget=null, np. klik poza dokumentem) też zamyka panel', () => {
    render(<LandingNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const firstLink = within(panel).getByRole('link', { name: 'Produkt' });

    fireEvent.blur(firstLink, { relatedTarget: null });

    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
  });

  it('fokus przechodzący MIĘDZY elementami headera (np. z linku panelu na hamburger) NIE zamyka panelu', () => {
    render(<LandingNav />);
    const hamburger = screen.getByRole('button', { name: 'Otwórz menu' });
    fireEvent.click(hamburger);
    const panel = screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' });
    const firstLink = within(panel).getByRole('link', { name: 'Produkt' });

    fireEvent.blur(firstLink, { relatedTarget: hamburger });

    expect(screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' })).toBeInTheDocument();
  });

  it('ponowny klik w hamburger zamyka panel', () => {
    render(<LandingNav />);
    const hamburger = screen.getByRole('button', { name: 'Otwórz menu' });

    fireEvent.click(hamburger);
    expect(screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij menu' }));

    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
  });
});
