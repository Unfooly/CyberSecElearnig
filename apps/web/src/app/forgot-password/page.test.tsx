import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blokuje wysyłkę przy pustym e-mailu i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPage />);

    fireEvent.click(screen.getByRole('button', { name: /wyślij link/i }));

    expect(await screen.findByText('Podaj adres e-mail.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blokuje wysyłkę przy niepoprawnym formacie e-mail', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nie-email' } });
    fireEvent.click(screen.getByRole('button', { name: /wyślij link/i }));

    expect(await screen.findByText('Podaj poprawny adres e-mail.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pokazuje identyczny komunikat sukcesu niezależnie od treści odpowiedzi backendu (anty-enumeracja)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'cokolwiek innego niż to co front wyświetla' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /wyślij link/i }));

    expect(
      await screen.findByText('Jeśli podany adres e-mail istnieje w systemie, wysłaliśmy na niego link do zresetowania hasła.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/forgot-password',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'user@example.test' }) }),
    );
  });

  it('pokazuje realny błąd przy rate limit (429) - to nie jest enumeracja kont', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Zbyt wiele prób. Spróbuj później.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /wyślij link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Zbyt wiele prób. Spróbuj później.');
  });

  it('pokazuje komunikat błędu połączenia, gdy fetch się nie uda', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /wyślij link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
  });

  it('ma link powrotu do /login', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: /wróć do logowania/i })).toHaveAttribute('href', '/login');
  });
});
