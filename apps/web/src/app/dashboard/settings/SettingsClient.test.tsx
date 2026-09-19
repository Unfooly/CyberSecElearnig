import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsClient from './SettingsClient';
import type { OrganizationOverview } from '@/lib/organization';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const BASE: OrganizationOverview = {
  id: 'o1',
  name: 'Acme',
  status: 'ACTIVE',
  selfJoinEnabled: false,
  billing: {
    legalName: 'Acme Sp. z o.o.',
    taxId: '5260250274',
    addressLine: 'ul. Długa 5',
    postalCode: '80-001',
    city: 'Gdańsk',
    country: 'PL',
  },
  domain: {
    name: 'acme.pl',
    verified: true,
    verifiedAt: '2027-01-01T00:00:00.000Z',
    lastCheckedAt: null,
    txtRecord: { type: 'TXT', host: '_unfooly-verify.acme.pl', value: 'unfooly-verify=abc' },
  },
};

describe('SettingsClient', () => {
  it('pokazuje dane firmy z rejestracji (tylko do odczytu)', () => {
    render(<SettingsClient organization={BASE} />);

    expect(screen.getByText('Acme Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('5260250274')).toBeInTheDocument();
    expect(screen.getByText('ul. Długa 5, 80-001 Gdańsk')).toBeInTheDocument();
    expect(screen.getByText('Polska')).toBeInTheDocument();
    expect(screen.getByText('zweryfikowana')).toBeInTheDocument();
  });

  it('organizacja bez danych firmy (starsza): komunikat zamiast pustki', () => {
    render(<SettingsClient organization={{ ...BASE, billing: null }} />);

    expect(screen.getByText(/Brak danych firmy/)).toBeInTheDocument();
  });

  it('domena niezweryfikowana: przełącznik zablokowany, link do weryfikacji, wyjaśnienie', () => {
    render(
      <SettingsClient
        organization={{ ...BASE, status: 'PENDING_DOMAIN_VERIFICATION', domain: { ...BASE.domain!, verified: false, verifiedAt: null } }}
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Zweryfikuj domenę' })).toHaveAttribute('href', '/onboarding');
    expect(screen.getByText(/dostępna po zweryfikowaniu domeny/i)).toBeInTheDocument();
  });

  it('włączenie wysyła PATCH tylko z selfJoinEnabled i pokazuje potwierdzenie', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ selfJoinEnabled: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(await screen.findByText('Ustawienie zapisane.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/organization/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ selfJoinEnabled: true }) }),
    );
  });

  it('błąd API: komunikat, a przełącznik wraca do stanu z serwera', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Nie można.' }) }));
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie można.');
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  });

  it('sukces z nieoczekiwanym ciałem odpowiedzi NIE cofa przełącznika', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(await screen.findByText('Ustawienie zapisane.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  describe('"Wyloguj wszędzie"', () => {
    it('woła /api/auth/logout-all i po sukcesie przenosi na /login', async () => {
      pushMock.mockClear();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      render(<SettingsClient organization={BASE} />);

      fireEvent.click(screen.getByRole('button', { name: 'Wyloguj wszędzie' }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout-all', { method: 'POST' });
    });

    it('błąd API: komunikat i brak przekierowania (sesja nadal aktywna)', async () => {
      pushMock.mockClear();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      render(<SettingsClient organization={BASE} />);

      fireEvent.click(screen.getByRole('button', { name: 'Wyloguj wszędzie' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Nie udało się wylogować/);
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('awaria sieci: komunikat, przycisk znów aktywny', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
      render(<SettingsClient organization={BASE} />);

      fireEvent.click(screen.getByRole('button', { name: 'Wyloguj wszędzie' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/połączyć z serwerem/);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Wyloguj wszędzie' })).toBeEnabled());
    });
  });

  it('wyłączenie działa, gdy było włączone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ selfJoinEnabled: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={{ ...BASE, selfJoinEnabled: true }} />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ selfJoinEnabled: false });
  });
});
