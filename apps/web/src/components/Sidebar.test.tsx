import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from './Sidebar';

const usePathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

describe('Sidebar', () => {
  it('renderuje linki do /dashboard i /courses jako aktywne pozycje', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('href', '/courses');
  });

  it('podświetla pozycję odpowiadającą aktualnej ścieżce', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveClass('bg-slate-800');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('bg-slate-800');
  });

  it('podświetla "Kursy" też na podstronie odtwarzacza (/courses/:id)', () => {
    usePathnameMock.mockReturnValue('/courses/course-1');
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveClass('bg-slate-800');
  });

  it('renderuje nieaktywne pozycje jako nie-linki (bez href)', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: 'Kampanie phishingowe' })).not.toBeInTheDocument();
    expect(screen.getByText('Kampanie phishingowe')).toBeInTheDocument();
  });
});
