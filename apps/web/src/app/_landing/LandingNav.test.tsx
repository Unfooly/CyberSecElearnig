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
    fireEvent.click(within(panel).getByRole('link', { name: 'Zaloguj się' }));

    expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape zamyka panel i zwraca fokus na hamburger', () => {
    render(<LandingNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz menu' }));
    expect(screen.getByRole('navigation', { name: 'Sekcje strony (telefon)' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('navigation', { name: 'Sekcje strony (telefon)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otwórz menu' })).toHaveFocus();
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
