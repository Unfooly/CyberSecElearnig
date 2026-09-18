import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteUserModal from './InviteUserModal';

const departments = [{ id: 'd1', name: 'IT' }];

describe('InviteUserModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blokuje wysyłkę przy pustych polach i nie woła API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    expect(await screen.findByText('Podaj imię.')).toBeInTheDocument();
    expect(screen.getByText('Podaj nazwisko.')).toBeInTheDocument();
    expect(screen.getByText('Podaj adres e-mail.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła POST /api/users z wypełnionymi danymi i wywołuje onCreated', async () => {
    const createdUser = {
      id: 'u1',
      email: 'nowy@test.pl',
      firstName: 'Jan',
      lastName: 'Kowalski',
      role: 'EMPLOYEE',
      status: 'INVITED',
      department: null,
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => createdUser });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Kowalski' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nowy@test.pl' } });
    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdUser));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'nowy@test.pl',
          firstName: 'Jan',
          lastName: 'Kowalski',
          departmentId: undefined,
          role: 'EMPLOYEE',
        }),
      }),
    );
  });

  it('pokazuje komunikat błędu z backendu (np. dział spoza organizacji) bez wywołania onCreated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Wybrany dział nie istnieje w tej organizacji.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    render(<InviteUserModal departments={departments} onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Jan' } });
    fireEvent.change(screen.getByLabelText('Nazwisko'), { target: { value: 'Kowalski' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nowy@test.pl' } });
    fireEvent.click(screen.getByRole('button', { name: /zaproś$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nie istnieje w tej organizacji/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('Escape zamyka modal', () => {
    const onClose = vi.fn();
    render(<InviteUserModal departments={departments} onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
