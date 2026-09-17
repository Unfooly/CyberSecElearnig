import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetPasswordPage from './page';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams({ token: 'valid-token-abc' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pokazuje komunikat o nieprawidłowym linku, gdy brak tokenu w URL, i nie renderuje formularza', () => {
    searchParams = new URLSearchParams();
    render(<ResetPasswordPage />);

    expect(screen.getByText('Nieprawidłowy link')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nowe hasło')).not.toBeInTheDocument();
  });

  it('blokuje wysyłkę przy haśle krótszym niż 8 znaków i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Nowe hasło'), { target: { value: 'krotkie' } });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), { target: { value: 'krotkie' } });
    fireEvent.click(screen.getByRole('button', { name: /ustaw nowe hasło/i }));

    expect(await screen.findByText('Hasło musi mieć min. 8 znaków.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blokuje wysyłkę, gdy hasła się nie zgadzają', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), { target: { value: 'InneHaslo456' } });
    fireEvent.click(screen.getByRole('button', { name: /ustaw nowe hasło/i }));

    expect(await screen.findByText('Hasła nie są identyczne.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła /api/auth/reset-password z tokenem z URL i przekierowuje do /login?reset=success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'Hasło zostało zmienione.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.click(screen.getByRole('button', { name: /ustaw nowe hasło/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login?reset=success'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'valid-token-abc', newPassword: 'NoweHaslo123' }),
      }),
    );
  });

  it('pokazuje odrębny komunikat backendu dla już wykorzystanego tokenu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'TOKEN_ALREADY_USED',
        message: 'Ten link został już wykorzystany. Jeśli to nie Ty zresetowałeś/aś hasło, skontaktuj się z administratorem.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.click(screen.getByRole('button', { name: /ustaw nowe hasło/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ten link został już wykorzystany');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('pokazuje generyczny komunikat dla wygasłego/nieistniejącego tokenu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'TOKEN_INVALID_OR_EXPIRED',
        message: 'Link do resetowania hasła jest nieprawidłowy lub wygasł. Poproś o nowy.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.change(screen.getByLabelText('Powtórz nowe hasło'), { target: { value: 'NoweHaslo123' } });
    fireEvent.click(screen.getByRole('button', { name: /ustaw nowe hasło/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nieprawidłowy lub wygasł/i);
  });
});
