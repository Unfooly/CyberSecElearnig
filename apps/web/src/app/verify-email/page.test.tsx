import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerifyEmailPage from './page';

const searchParamsMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock(),
}));

describe('VerifyEmailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bez tokenu pokazuje "Nieprawidłowy link" i nie woła API', () => {
    searchParamsMock.mockReturnValue(new URLSearchParams());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);

    expect(screen.getByText('Nieprawidłowy link')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła token do /api/auth/verify-email i pokazuje sukces z linkiem do logowania', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Adres e-mail potwierdzony.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<VerifyEmailPage />);

    expect(await screen.findByText('Adres e-mail potwierdzony.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/login');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'abc' }) }),
    );
  });

  it('przy błędzie sieci pokazuje komunikat o braku połączenia', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(<VerifyEmailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
  });

  it('pokazuje komunikat błędu z backendu (np. link już użyty)', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('token=abc'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Ten link został już wykorzystany.' }) }),
    );

    render(<VerifyEmailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ten link został już wykorzystany.');
  });
});
