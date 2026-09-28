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

describe('SettingsClient: strefa czasowa', () => {
  it('domyślnie Europe/Warsaw; zmiana wysyła PATCH z samym polem timezone i pokazuje wartość z API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...BASE, timezone: 'Europe/London' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={BASE} />);

    const select = screen.getByLabelText('Strefa czasowa organizacji') as HTMLSelectElement;
    expect(select.value).toBe('Europe/Warsaw');
    fireEvent.change(select, { target: { value: 'Europe/London' } });

    await waitFor(() => expect(screen.getByText('Strefa czasowa zapisana.')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/settings', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ timezone: 'Europe/London' }) }));
    expect((screen.getByLabelText('Strefa czasowa organizacji') as HTMLSelectElement).value).toBe('Europe/London');
  });

  it('strefa spoza listy podstawowej z API jest na liście; błąd API pokazany', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: ['Nieprawidłowa strefa czasowa'] }) }));
    render(<SettingsClient organization={{ ...BASE, timezone: 'Asia/Tokyo' }} />);

    const select = screen.getByLabelText('Strefa czasowa organizacji') as HTMLSelectElement;
    expect(select.value).toBe('Asia/Tokyo');
    fireEvent.change(select, { target: { value: 'UTC' } });

    await waitFor(() => expect(screen.getByText('Nieprawidłowa strefa czasowa')).toBeInTheDocument());
  });
});

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

    expect(screen.getByRole('switch', { name: /dołączać samodzielnie/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Zweryfikuj domenę' })).toHaveAttribute('href', '/onboarding');
    expect(screen.getByText(/dostępna po zweryfikowaniu domeny/i)).toBeInTheDocument();
  });

  it('włączenie wysyła PATCH tylko z selfJoinEnabled i pokazuje potwierdzenie', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ selfJoinEnabled: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch', { name: /dołączać samodzielnie/ }));

    expect(await screen.findByText('Ustawienie zapisane.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /dołączać samodzielnie/ })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/organization/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ selfJoinEnabled: true }) }),
    );
  });

  it('błąd API: komunikat, a przełącznik wraca do stanu z serwera', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Nie można.' }) }));
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch', { name: /dołączać samodzielnie/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie można.');
    await waitFor(() => expect(screen.getByRole('switch', { name: /dołączać samodzielnie/ })).not.toBeChecked());
  });

  it('sukces z nieoczekiwanym ciałem odpowiedzi NIE cofa przełącznika', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<SettingsClient organization={BASE} />);

    fireEvent.click(screen.getByRole('switch', { name: /dołączać samodzielnie/ }));

    expect(await screen.findByText('Ustawienie zapisane.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /dołączać samodzielnie/ })).toBeChecked();
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

  it('D-112: ranking organizacji - domyślnie włączony; wyłączenie wysyła PATCH tylko z leaderboardEnabled; błąd przywraca stan', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ leaderboardEnabled: false }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Brak uprawnień.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={BASE} />);

    const toggle = () => screen.getByRole('switch', { name: /Pokazuj ranking organizacji/ });
    expect(toggle()).toBeChecked();
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/organization/settings');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ leaderboardEnabled: false });
    expect(await screen.findByText('Ranking wyłączony.')).toBeInTheDocument();

    fireEvent.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień.');
    expect(toggle()).not.toBeChecked();
  });

  it('wyłączenie działa, gdy było włączone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ selfJoinEnabled: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsClient organization={{ ...BASE, selfJoinEnabled: true }} />);

    fireEvent.click(screen.getByRole('switch', { name: /dołączać samodzielnie/ }));

    await waitFor(() => expect(screen.getByRole('switch', { name: /dołączać samodzielnie/ })).not.toBeChecked());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ selfJoinEnabled: false });
  });
});
