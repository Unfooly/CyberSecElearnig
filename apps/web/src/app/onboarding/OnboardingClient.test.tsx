import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OnboardingClient from './OnboardingClient';
import type { OrganizationOverview } from '@/lib/organization';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const ORG: OrganizationOverview = {
  id: 'o1',
  name: 'Acme',
  status: 'PENDING_DOMAIN_VERIFICATION',
  selfJoinEnabled: false,
  billing: null,
  domain: {
    name: 'acme.pl',
    verified: false,
    verifiedAt: null,
    lastCheckedAt: null,
    txtRecord: { type: 'TXT', host: '_unfooly-verify.acme.pl', value: 'unfooly-verify=abc123' },
  },
};

describe('OnboardingClient', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('pokazuje dokładny rekord TXT (typ, host, wartość), nazwę organizacji i domenę', () => {
    render(<OnboardingClient organization={ORG} />);

    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText('_unfooly-verify.acme.pl')).toBeInTheDocument();
    expect(screen.getByText('unfooly-verify=abc123')).toBeInTheDocument();
    expect(screen.getAllByText('acme.pl').length).toBeGreaterThan(0);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Oczekuje na weryfikację')).toBeInTheDocument();
  });

  it('przyciski "Kopiuj" wkładają do schowka dokładnie wartość rekordu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj: Wartość' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('unfooly-verify=abc123'));
    expect(await screen.findByText('Skopiowano')).toBeInTheDocument();
  });

  it('brak dostępu do schowka: komunikat, bez wyjątku', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj: Nazwa (host)' }));

    expect(await screen.findByText(/zaznacz wartość ręcznie/i)).toBeInTheDocument();
  });

  it('"Sprawdź teraz" wysyła POST bez ciała, a sukces przenosi do panelu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ verified: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    // Po sukcesie przycisk zostaje zablokowany (brak podwójnego kliknięcia w trakcie przejścia).
    expect(screen.getByRole('button', { name: 'Sprawdź teraz' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/domain/check', { method: 'POST' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('porażka weryfikacji: jeden komunikat (bez przyczyny), przycisk znów aktywny, brak przekierowania', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie znaleźliśmy jeszcze poprawnego rekordu/i);
    expect(screen.getByRole('button', { name: 'Sprawdź teraz' })).toBeEnabled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Ostatnie sprawdzenie/)).toBeInTheDocument();
  });

  it('429 (cooldown): prosi o odczekanie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/zbyt często/i);
  });

  it('401: przekierowanie do logowania', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('awaria sieci: komunikat o serwerze', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    render(<OnboardingClient organization={ORG} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź teraz' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/połączyć z serwerem/i);
  });

  it('brak wiersza domeny: komunikat zamiast pustego ekranu', () => {
    render(<OnboardingClient organization={{ ...ORG, domain: null }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/nie znaleźliśmy domeny/i);
  });
});
