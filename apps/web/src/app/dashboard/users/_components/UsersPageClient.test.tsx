import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UsersPageClient from './UsersPageClient';

const listResponse = {
  items: [
    {
      id: 'u1',
      email: 'jan@test.pl',
      firstName: 'Jan',
      lastName: 'Kowalski',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      department: null,
      createdAt: new Date().toISOString(),
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

function mockFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/users/departments')) {
      return Promise.resolve({ ok: true, json: async () => [{ id: 'd1', name: 'IT' }] });
    }
    if (url.startsWith('/api/users/')) {
      // PATCH/DELETE na konkretnym userze - domyślnie sukces, nadpisywane w
      // testach które tego potrzebują.
      return Promise.resolve({ ok: true, json: async () => listResponse.items[0] });
    }
    return Promise.resolve({ ok: true, json: async () => listResponse });
  });
}

describe('UsersPageClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ładuje i renderuje listę pracowników z /api/users', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<UsersPageClient />);

    expect(await screen.findByText('jan@test.pl')).toBeInTheDocument();
  });

  it('pokazuje komunikat błędu, gdy /api/users odpowiada błędem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    render(<UsersPageClient />);

    expect(await screen.findByText('Nie udało się załadować listy pracowników.')).toBeInTheDocument();
  });

  it('403 z kodem organizacji PENDING przenosi na /onboarding (bez komunikatu o błędzie)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ code: 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION' }),
      }),
    );
    render(<UsersPageClient />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/onboarding'));
    expect(screen.queryByText('Nie udało się załadować listy pracowników.')).not.toBeInTheDocument();
  });

  it('403 z innego powodu pokazuje zwykły komunikat błędu (bez przekierowania)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'X' }) }));
    render(<UsersPageClient />);

    expect(await screen.findByText('Nie udało się załadować listy pracowników.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('otwiera modal zapraszania po kliknięciu "Zaproś pracownika"', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    fireEvent.click(screen.getByRole('button', { name: 'Zaproś pracownika' }));

    expect(screen.getByRole('dialog', { name: /zaproś pracownika/i })).toBeInTheDocument();
  });

  it('otwiera modal importu CSV po kliknięciu "Importuj z CSV"', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    fireEvent.click(screen.getByRole('button', { name: 'Importuj z CSV' }));

    expect(screen.getByRole('dialog', { name: /importuj z csv/i })).toBeInTheDocument();
  });

  it('pokazuje komunikat, gdy usunięcie się nie powiodło (np. ostatni administrator)', async () => {
    const base = mockFetch();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return Promise.resolve({
            ok: false,
            json: async () => ({ message: 'Organizacja musi mieć co najmniej jednego administratora.' }),
          });
        }
        return base(input);
      }),
    );
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    fireEvent.click(screen.getByText('Usuń'));
    fireEvent.click(screen.getByText('Usuń'));

    expect(await screen.findByText(/co najmniej jednego administratora/)).toBeInTheDocument();
  });

  it('po usunięciu ostatniego elementu ostatniej strony wraca na istniejącą stronę', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/users/departments')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      const page = new URL(url, 'http://localhost').searchParams.get('page');
      // Backend: total=20 (1 strona po 20), a klient prosi jeszcze o stronę 2.
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...listResponse, total: 20, items: page === '1' ? listResponse.items : [] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    expect(screen.getByText(/Strona 1 z 1/)).toBeInTheDocument();
  });

  it('ostrzega, gdy e-mail z zaproszeniem nie został wysłany (inviteEmailSent=false)', async () => {
    const base = mockFetch();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST' && String(input) === '/api/users') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...listResponse.items[0], id: 'u2', email: 'zly@test.pl', inviteEmailSent: false }),
          });
        }
        return base(input);
      }),
    );
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    fireEvent.click(screen.getByRole('button', { name: 'Zaproś pracownika' }));
    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'K' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'zly@test.pl' } });
    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/NIE została wysłana/);
  });

  it('przycisk ponownego zaproszenia jest tylko dla kont INVITED i woła resend-invite', async () => {
    const invited = { ...listResponse.items[0], id: 'u9', email: 'czeka@test.pl', status: 'INVITED' };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/resend-invite')) {
        return Promise.resolve({ ok: true, json: async () => ({ inviteEmailSent: true }) });
      }
      if (url.includes('/api/users/departments')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      void init;
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...listResponse, total: 2, items: [listResponse.items[0], invited] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPageClient />);

    await screen.findByText('czeka@test.pl');
    const buttons = screen.getAllByRole('button', { name: 'Wyślij zaproszenie ponownie' });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);

    expect(await screen.findByText(/Wysłano zaproszenie ponownie na adres czeka@test.pl/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/users/u9/resend-invite', expect.objectContaining({ method: 'POST' }));
  });

  it('usunięcie użytkownika woła DELETE i odświeża listę', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPageClient />);

    await screen.findByText('jan@test.pl');
    fireEvent.click(screen.getByText('Usuń'));
    fireEvent.click(screen.getByText('Usuń'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/u1', expect.objectContaining({ method: 'DELETE' })),
    );
  });
});
