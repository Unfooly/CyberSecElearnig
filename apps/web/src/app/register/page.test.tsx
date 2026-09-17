import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Nazwa organizacji'), { target: { value: 'Acme Sp. z o.o.' } });
  fireEvent.change(screen.getByLabelText('E-mail admina'), { target: { value: 'admin@acme.test' } });
  fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
  fireEvent.change(screen.getByLabelText('Powtórz hasło'), { target: { value: 'SuperSecret123!' } });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('blokuje wysyłkę przy pustych polach i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    expect(await screen.findByText('Podaj nazwę organizacji.')).toBeInTheDocument();
    expect(screen.getByText('Podaj adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Podaj hasło.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waliduje min. 8 znaków hasła zgodnie z tym, co faktycznie wymusza backend (RegisterDto)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Nazwa organizacji'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('E-mail admina'), { target: { value: 'admin@acme.test' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'krotkie' } });
    fireEvent.change(screen.getByLabelText('Powtórz hasło'), { target: { value: 'krotkie' } });
    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    expect(await screen.findByText('Hasło musi mieć min. 8 znaków.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blokuje wysyłkę, gdy potwierdzenie hasła się nie zgadza', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText('Nazwa organizacji'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('E-mail admina'), { target: { value: 'admin@acme.test' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'SuperSecret123!' } });
    fireEvent.change(screen.getByLabelText('Powtórz hasło'), { target: { value: 'CosInnego456' } });
    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    expect(await screen.findByText('Hasła nie są identyczne.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła /api/auth/register i przekierowuje do /dashboard po sukcesie (auto-login)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          organizationName: 'Acme Sp. z o.o.',
          email: 'admin@acme.test',
          password: 'SuperSecret123!',
        }),
      }),
    );
  });

  it('pokazuje generyczny komunikat błędu przy duplikacie e-maila, bez ujawniania że e-mail zajęty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'Nie udało się utworzyć konta z podanymi danymi. Jeśli masz już konto, zaloguj się.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się utworzyć konta/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('pokazuje komunikat błędu połączenia, gdy fetch się nie uda', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterPage />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /załóż organizację/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie udało się połączyć/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('ma link do /login', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('link', { name: /zaloguj się/i })).toHaveAttribute('href', '/login');
  });
});
