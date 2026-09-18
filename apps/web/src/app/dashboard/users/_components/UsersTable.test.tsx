import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UsersTable from './UsersTable';
import type { UserListItem } from '@/lib/users-types';

const users: UserListItem[] = [
  {
    id: 'u1',
    email: 'jan@test.pl',
    firstName: 'Jan',
    lastName: 'Kowalski',
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    department: { id: 'd1', name: 'IT' },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'u2',
    email: 'anna@test.pl',
    firstName: 'Anna',
    lastName: 'Nowak',
    role: 'ORG_ADMIN',
    status: 'INVITED',
    department: null,
    createdAt: new Date().toISOString(),
  },
];

describe('UsersTable', () => {
  it('pokazuje komunikat, gdy lista jest pusta', () => {
    render(<UsersTable users={[]} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Twój zespół jest jeszcze pusty' })).toBeInTheDocument();
  });

  it('pokazuje stan ładowania', () => {
    render(<UsersTable users={[]} isLoading={true} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Ładowanie...')).toBeInTheDocument();
  });

  it('renderuje status Aktywny/Zaproszony i dział/rolę dla każdego wiersza', () => {
    render(<UsersTable users={users} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText('Aktywny')).toBeInTheDocument();
    expect(screen.getByText('Zaproszony')).toBeInTheDocument();
    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.getByText('Brak działu')).toBeInTheDocument();
    expect(screen.getByText('jan@test.pl')).toBeInTheDocument();
  });

  it('woła onEdit z klikniętym userem', () => {
    const onEdit = vi.fn();
    render(<UsersTable users={users} isLoading={false} onEdit={onEdit} onDelete={vi.fn()} />);

    fireEvent.click(screen.getAllByText('Edytuj')[0]);

    expect(onEdit).toHaveBeenCalledWith(users[0]);
  });

  it('usuwanie wymaga potwierdzenia inline przed wywołaniem onDelete', () => {
    const onDelete = vi.fn();
    render(<UsersTable users={[users[0]]} isLoading={false} onEdit={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('Usuń'));
    expect(onDelete).not.toHaveBeenCalled();

    expect(screen.getByText('Na pewno?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Usuń'));

    expect(onDelete).toHaveBeenCalledWith(users[0]);
  });

  it('anulowanie usuwania chowa potwierdzenie bez wywołania onDelete', () => {
    const onDelete = vi.fn();
    render(<UsersTable users={[users[0]]} isLoading={false} onEdit={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('Usuń'));
    fireEvent.click(screen.getByText('Anuluj'));

    expect(screen.queryByText('Na pewno?')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
