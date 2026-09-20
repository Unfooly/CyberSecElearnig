import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClaimRegistrationPage from './page';

const searchParamsMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock(),
}));

describe('ClaimRegistrationPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bez tokenu pokazuje "Nieprawidłowy link" i nie woła API', () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ClaimRegistrationPage />);

    expect(screen.getByText('Nieprawidłowy link')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła token (raz) do /api/auth/claim-registration i pokazuje sukces z linkiem do logowania', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Adres potwierdzony. Sprawdź skrzynkę.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ClaimRegistrationPage />);

    expect(await screen.findByText('Adres potwierdzony. Sprawdź skrzynkę.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Przejdź do logowania' })).toHaveAttribute('href', '/login');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/claim-registration', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'abc' }) }));
  });

  it('błąd z backendu (link nieważny) pokazuje komunikat i odsyła do ponownej rejestracji', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Ten link jest nieprawidłowy, wygasł albo został już użyty.' }) }));

    render(<ClaimRegistrationPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ten link jest nieprawidłowy, wygasł albo został już użyty.');
    expect(screen.getByRole('link', { name: 'Zarejestruj firmę ponownie' })).toHaveAttribute('href', '/register');
  });

  it('przy błędzie sieci pokazuje komunikat o braku połączenia', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(<ClaimRegistrationPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
  });
});
