import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('NIE wykonuje akcji niszczącej po samym wejściu na stronę (skaner poczty / podgląd linku): pokazuje ostrzeżenie i przycisk', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ClaimRegistrationPage />);
    await new Promise((resolve) => setTimeout(resolve, 50)); // czas, w którym automatyczny efekt zdążyłby zawołać API

    expect(screen.getByRole('button', { name: 'Potwierdzam' })).toBeInTheDocument();
    expect(screen.getByText(/unieważni zaproszenie do innej firmy/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('po kliknięciu "Potwierdzam" wysyła token (raz, także przy podwójnym kliknięciu) i pokazuje sukces z linkiem do logowania', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Adres potwierdzony. Sprawdź skrzynkę.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClaimRegistrationPage />);

    const button = screen.getByRole('button', { name: 'Potwierdzam' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByText('Adres potwierdzony. Sprawdź skrzynkę.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Przejdź do logowania' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Potwierdzam' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/claim-registration', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'abc' }) }));
  });

  it('błąd z backendu (link nieważny) pokazuje komunikat i odsyła do ponownej rejestracji', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Ten link jest nieprawidłowy, wygasł albo został już użyty.' }) }));
    render(<ClaimRegistrationPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Potwierdzam' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ten link jest nieprawidłowy, wygasł albo został już użyty.');
    expect(screen.getByRole('link', { name: 'Zarejestruj firmę ponownie' })).toHaveAttribute('href', '/register');
  });

  it('przy błędzie sieci pokazuje komunikat o braku połączenia', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<ClaimRegistrationPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Potwierdzam' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
  });
});
