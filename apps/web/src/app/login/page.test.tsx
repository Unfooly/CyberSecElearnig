import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('blokuje wysyłkę przy pustych polach i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByText('Podaj adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Podaj hasło.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blokuje wysyłkę przy niepoprawnym formacie e-mail', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nie-email' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'haslo123' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByText('Podaj poprawny adres e-mail.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła /api/auth/login i przekierowuje do /dashboard po sukcesie', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.test', password: 'SuperSecret123!' }),
      }),
    );
  });

  it('pokazuje generyczny komunikat błędu logowania, bez wskazania, które pole jest złe', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Nieprawidłowy e-mail lub hasło' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'zlehaslo' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy e-mail lub hasło');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('pokazuje komunikat błędu połączenia, gdy fetch się nie uda', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
