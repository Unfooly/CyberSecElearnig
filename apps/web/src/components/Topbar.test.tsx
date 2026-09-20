import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Role } from '@cyberszkolo/shared';
import Topbar from './Topbar';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

const usePathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

describe('Topbar', () => {
  it('renderuje linki do /dashboard, /dashboard/users, /courses i /courses/achievements jako aktywne pozycje', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Zespół' })).toHaveAttribute('href', '/dashboard/users');
    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('href', '/courses');
    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toHaveAttribute('href', '/courses/achievements');
  });

  it.each([Role.EMPLOYEE, Role.DEPARTMENT_MANAGER, Role.ORG_ADMIN])('rola %s widzi przycisk "Zgłoś podejrzany mail" prowadzący do /report', (role) => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan@example.test" role={role} />);

    expect(screen.getByRole('link', { name: 'Zgłoś podejrzany mail' })).toHaveAttribute('href', '/report');
  });

  it('bez zalogowanego użytkownika nie ma przycisku zgłoszenia', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail={null} />);

    expect(screen.queryByRole('link', { name: 'Zgłoś podejrzany mail' })).not.toBeInTheDocument();
  });

  describe('nawigacja zależna od roli (UX; dostęp egzekwują middleware i API)', () => {
    const adminLabels = ['Dashboard', 'Zespół', 'Ustawienia', 'Kampanie phishingowe'];

    it('EMPLOYEE NIE widzi modułów administratora (w tym symulacji phishingowych), widzi kursy i osiągnięcia', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      for (const label of adminLabels) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      expect(screen.getByRole('link', { name: 'Kursy' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toBeInTheDocument();
    });

    it('DEPARTMENT_MANAGER też nie widzi pozycji administratora organizacji', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.DEPARTMENT_MANAGER} />);

      expect(screen.queryByText('Kampanie phishingowe')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Zespół' })).not.toBeInTheDocument();
    });

    it('ORG_ADMIN widzi wszystko, w tym link do szablonów symulacji', () => {
      usePathnameMock.mockReturnValue('/dashboard');
      render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);

      expect(screen.getByRole('link', { name: 'Kampanie phishingowe' })).toHaveAttribute('href', '/dashboard/phishing/campaigns');
      for (const label of ['Zespół', 'Ustawienia']) {
        expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
      }
    });
  });

  it('podświetla WYŁĄCZNIE "Zespół" na /dashboard/users, mimo że to też podścieżka /dashboard', () => {
    usePathnameMock.mockReturnValue('/dashboard/users');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Zespół' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^dashboard$/i })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla WYŁĄCZNIE "Kursy" na /courses (nie miesza z Osiągnięciami)', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla WYŁĄCZNIE "Osiągnięcia" na /courses/achievements, mimo że to też podścieżka /courses', () => {
    usePathnameMock.mockReturnValue('/courses/achievements');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Osiągnięcia' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Kursy' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('podświetla "Kursy" też na podstronie odtwarzacza (/courses/:id)', () => {
    usePathnameMock.mockReturnValue('/courses/course-1');
    render(<Topbar userEmail="jan@example.test" />);

    expect(screen.getByRole('link', { name: 'Kursy' })).toHaveAttribute('aria-current', 'page');
  });

  it('pokazuje wybrany avatar zamiast inicjałów, gdy użytkownik go ustawił', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'fox' }) }));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);

    expect(await screen.findByRole('img', { name: 'Twój avatar' })).toBeInTheDocument();
    expect(screen.queryByText('AP')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('po zapisaniu nowego avatara (zdarzenie) od razu podmienia inicjały, bez przeładowania', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: null }) }));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);
    expect(await screen.findByText('AP')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: 'fox' }));
    });

    expect(screen.getByRole('img', { name: 'Twój avatar' })).toBeInTheDocument();
    expect(screen.queryByText('AP')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('przy błędzie pobrania avatara zostają inicjały', async () => {
    usePathnameMock.mockReturnValue('/courses');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<Topbar userEmail="adrian.pozniak@example.test" />);

    expect(await screen.findByText('AP')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('pokazuje inicjały z e-maila użytkownika', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail="jan.kowalski@example.test" />);

    expect(screen.getByText('JK')).toBeInTheDocument();
  });

  it('nie renderuje sekcji użytkownika, gdy userEmail jest null', () => {
    usePathnameMock.mockReturnValue('/courses');
    render(<Topbar userEmail={null} />);

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  describe('skrzynka zgłoszeń (/reports)', () => {
    it.each([Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER])('rola %s widzi aktywną pozycję "Zgłoszenia" prowadzącą do /reports', (role) => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={role} />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toHaveAttribute('href', '/reports');
    });

    it('EMPLOYEE nie widzi pozycji "Zgłoszenia" (ma tylko przycisk zgłoszenia podejrzanego maila)', () => {
      usePathnameMock.mockReturnValue('/courses');
      render(<Topbar userEmail="jan@example.test" role={Role.EMPLOYEE} />);

      expect(screen.queryByRole('link', { name: 'Zgłoszenia' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zgłoś podejrzany mail' })).toBeInTheDocument();
    });

    it('pozycja jest aktywna (aria-current) na /reports i podstronie zgłoszenia', () => {
      usePathnameMock.mockReturnValue('/reports/abc123');
      render(<Topbar userEmail="jan@example.test" role={Role.ORG_ADMIN} />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toHaveAttribute('aria-current', 'page');
    });

    it('bez znanej roli (strony administratora) pozycja jest widoczna', () => {
      usePathnameMock.mockReturnValue('/dashboard');
      render(<Topbar userEmail="jan@example.test" />);

      expect(screen.getByRole('link', { name: 'Zgłoszenia' })).toBeInTheDocument();
    });
  });
});
