import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteUserModal from './InviteUserModal';

const departments = [{ id: 'd1', name: 'IT' }];

describe('InviteUserModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blokuje wysyłkę przy pustych polach i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    expect(await screen.findByText('Podaj imię.')).toBeInTheDocument();
    expect(screen.getByText('Podaj nazwisko.')).toBeInTheDocument();
    expect(screen.getByText('Podaj adres e-mail.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła POST /api/users z wypełnionymi danymi i wywołuje onCreated', async () => {
    const createdUser = {
      id: 'u1',
      email: 'nowy@test.pl',
      firstName: 'Jan',
      lastName: 'Kowalski',
      role: 'EMPLOYEE',
      status: 'INVITED',
      department: null,
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdUser });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Kowalski' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nowy@test.pl' } });
    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdUser));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'nowy@test.pl',
          firstName: 'Jan',
          lastName: 'Kowalski',
          departmentId: undefined,
          role: 'EMPLOYEE',
        }),
      }),
    );
  });

  it('pokazuje komunikat błędu z backendu (np. dział spoza organizacji) bez wywołania onCreated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Wybrany dział nie istnieje w tej organizacji.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Kowalski' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nowy@test.pl' } });
    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie istnieje w tej organizacji/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  describe('limit licencji (409 SEAT_LIMIT)', () => {
    const fillAndSubmit = () => {
      fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
      fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Kowalski' } });
      fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nowy@test.pl' } });
      fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));
    };
    const seatLimit = (over: Record<string, unknown> = {}) => ({
      ok: false,
      json: async () => ({
        code: 'SEAT_LIMIT',
        message: 'Brak wolnych licencji. Wykorzystano 10 z 10 licencji, zostało miejsc: 0. Aby dodać więcej osób, zmień plan w ustawieniach organizacji (/dashboard/settings).',
        settingsPath: '/dashboard/settings',
        ...over,
      }),
    });

    it('pokazuje komunikat z liczbą pozostałych miejsc i odsyłacz do ustawień (zmiana planu)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(seatLimit()));
      render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

      fillAndSubmit();

      expect(await screen.findByRole('alert')).toHaveTextContent('zostało miejsc: 0');
      expect(screen.getByRole('link', { name: 'Przejdź do ustawień' })).toHaveAttribute('href', '/dashboard/settings');
    });

    it('odsyłacz tylko do ścieżki wewnątrz panelu: obcy adres z odpowiedzi nie tworzy linku', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(seatLimit({ settingsPath: 'https://evil.example/plan' })));
      render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

      fillAndSubmit();

      expect(await screen.findByRole('alert')).toHaveTextContent('zostało miejsc: 0');
      expect(screen.queryByRole('link', { name: 'Przejdź do ustawień' })).not.toBeInTheDocument();
    });

    it('zwykły błąd (inny kod) nie pokazuje odsyłacza do ustawień', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Nie można użyć tego adresu e-mail.', settingsPath: '/dashboard/settings' }) }));
      render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

      fillAndSubmit();

      expect(await screen.findByRole('alert')).toHaveTextContent('Nie można użyć tego adresu e-mail.');
      expect(screen.queryByRole('link', { name: 'Przejdź do ustawień' })).not.toBeInTheDocument();
    });
  });

  it('panel ma ograniczoną wysokość z przewijaniem (mobile: długi formularz nie wychodzi poza ekran)', () => {
    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

    const panel = screen.getByRole('dialog').firstElementChild as HTMLElement;
    expect(panel.className).toMatch(/max-h-\[92dvh\]/);
    expect(panel.className).toMatch(/overflow-y-auto/);
  });

  it('poniżej sm modal jest arkuszem przyklejonym do dołu ekranu (bez tła dookoła), od sm wyśrodkowany jak dziś', () => {
    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

    const backdropClasses = screen.getByRole('dialog').className.split(' ');
    expect(backdropClasses).toContain('items-end');
    expect(backdropClasses).toContain('sm:items-center');
    expect(backdropClasses).toContain('p-0');
    expect(backdropClasses).toContain('sm:p-4');
  });

  it('przyciski w stopce dzielą pełną szerokość na telefonie (flex-wrap)', () => {
    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

    const footer = screen.getByRole('button', { name: /zaproś$/i }).closest('div') as HTMLElement;
    expect(footer.className.split(' ')).toContain('flex-wrap');
  });

  it('Escape zamyka modal', () => {
    const onClose = vi.fn();
    render(<InviteUserModal departments={departments} onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
