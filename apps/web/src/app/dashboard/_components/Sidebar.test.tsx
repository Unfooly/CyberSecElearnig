import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  it('renderuje link do /dashboard jako jedyną aktywną pozycję', () => {
    render(<Sidebar />);

    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');
  });

  it('renderuje nieaktywne pozycje jako nie-linki (bez href)', () => {
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: 'Kursy' })).not.toBeInTheDocument();
    expect(screen.getByText('Kursy')).toBeInTheDocument();
    expect(screen.getByText('Kampanie phishingowe')).toBeInTheDocument();
    expect(screen.getByText('Zgłoszenia')).toBeInTheDocument();
    expect(screen.getByText('Ustawienia')).toBeInTheDocument();
  });
});
