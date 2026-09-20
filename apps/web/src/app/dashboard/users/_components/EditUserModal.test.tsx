import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditUserModal from './EditUserModal';
import { Role, UserStatus } from '@cyberszkolo/shared';
import type { UserListItem } from '@/lib/users-types';

const departments = [{ id: 'd1', name: 'IT' }];

const user: UserListItem = {
  id: 'u1',
  email: 'jan@test.pl',
  firstName: 'Jan',
  lastName: 'Kowalski',
  role: Role.EMPLOYEE,
  status: UserStatus.ACTIVE,
  department: { id: 'd1', name: 'IT' },
  createdAt: new Date().toISOString(),
};

describe('EditUserModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wypełnia formularz danymi przekazanego użytkownika', () => {
    render(<EditUserModal user={user} departments={departments} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Imię')).toHaveValue('Jan');
    expect(screen.getByLabelText('Nazwisko')).toHaveValue('Kowalski');
    expect(screen.getByText('jan@test.pl')).toBeInTheDocument();
  });

  it('wysyła PATCH /api/users/:id ze zmienionymi danymi i wywołuje onSaved', async () => {
    const updatedUser = { ...user, firstName: 'Janusz' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => updatedUser });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();

    render(<EditUserModal user={user} departments={departments} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Janusz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updatedUser));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/u1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ firstName: 'Janusz', lastName: 'Kowalski', departmentId: 'd1', role: 'EMPLOYEE' }),
      }),
    );
  });

  it('wysyła departmentId: null, gdy wybrano "Bez działu"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => user });
    vi.stubGlobal('fetch', fetchMock);

    render(<EditUserModal user={user} departments={departments} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Dział'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/u1',
        expect.objectContaining({ body: expect.stringContaining('"departmentId":null') }),
      ),
    );
  });

  it('blokuje wysyłkę, gdy imię lub nazwisko jest puste', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<EditUserModal user={user} departments={departments} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Imię'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/nie mogą być puste/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
