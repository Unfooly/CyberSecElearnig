import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const pushMock = vi.fn();
const refreshMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParams,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    searchParams = new URLSearchParams();
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

  it('woła /api/auth/login i przekierowuje na redirectTo z odpowiedzi po sukcesie', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, redirectTo: '/dashboard' }),
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

  it('pokazuje baner sukcesu resetu hasła, gdy w URL jest ?reset=success', () => {
    searchParams = new URLSearchParams({ reset: 'success' });
    render(<LoginPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Hasło zostało zmienione. Zaloguj się nowym hasłem.');
  });

  it('nie pokazuje banera sukcesu bez parametru ?reset=success', () => {
    render(<LoginPage />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('przy EMAIL_NOT_VERIFIED pokazuje komunikat i pozwala wysłać link weryfikacyjny ponownie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Adres e-mail nie został jeszcze potwierdzony.', code: 'EMAIL_NOT_VERIFIED' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Wysłaliśmy nowy link weryfikacyjny.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'jan@test.pl' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie został jeszcze potwierdzony/i);
    fireEvent.click(screen.getByRole('button', { name: /wyślij link weryfikacyjny ponownie/i }));

    await waitFor(() => expect(screen.getByText('Wysłaliśmy nowy link weryfikacyjny.')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/resend-verification',
      expect.objectContaining({ body: JSON.stringify({ email: 'jan@test.pl' }) }),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('bez EMAIL_NOT_VERIFIED (zwykły błąd logowania) nie pokazuje przycisku ponownej wysyłki', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Nieprawidłowy e-mail lub hasło' }) }),
    );
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'jan@test.pl' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /wyślij link weryfikacyjny/i })).not.toBeInTheDocument();
  });

  it('ma link do /forgot-password', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /zapomniałeś hasła/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('ma link do /register', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /załóż organizację/i })).toHaveAttribute('href', '/register');
  });

  it.each(['//evil.com', '/\evil.com', '/\t/evil.com', 'https://evil.com', 'javascript:alert(1)', undefined])(
    'wrogie redirectTo %j nie powoduje wyjścia poza aplikację - fallback /courses',
    async (redirectTo) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, redirectTo }) }));
      render(<LoginPage />);

      fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'user@example.test' } });
      fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
      fireEvent.click(screen.getByRole('button', { name: /zaloguj się/i }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/courses'));
      expect(pushMock).toHaveBeenCalledTimes(1);
    },
  );
});
