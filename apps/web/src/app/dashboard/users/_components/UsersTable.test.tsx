import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import UsersTable from './UsersTable';
import { Role, UserStatus } from '@cyberszkolo/shared';
import type { UserListItem } from '@/lib/users-types';

const users: UserListItem[] = [
  {
    id: 'u1',
    email: 'jan@test.pl',
    firstName: 'Jan',
    lastName: 'Kowalski',
    role: Role.EMPLOYEE,
    status: UserStatus.ACTIVE,
    department: { id: 'd1', name: 'IT' },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'u2',
    email: 'anna@test.pl',
    firstName: 'Anna',
    lastName: 'Nowak',
    role: Role.ORG_ADMIN,
    status: UserStatus.INVITED,
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

  it('poniżej md ukrywa E-mail, Dział i Rolę (nagłówek ORAZ każda komórka); Status, Pracownik i Akcje zostają', () => {
    render(<UsersTable users={users} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} />);

    for (const header of ['E-mail', 'Dział', 'Rola']) {
      const classes = screen.getByRole('columnheader', { name: header }).className.split(' ');
      expect(classes).toContain('hidden');
      expect(classes).toContain('md:table-cell');
    }
    for (const header of ['Status', 'Pracownik', 'Akcje']) {
      expect(screen.getByRole('columnheader', { name: header }).className.split(' ')).not.toContain('hidden');
    }

    // Nagłówek "hidden" bez odpowiadającej komórki (albo odwrotnie) przesuwałby kolumny na telefonie - stąd
    // sprawdzenie obu, nie tylko <th>.
    const emailCell = screen.getByText('jan@test.pl', { selector: 'td' });
    const deptCell = screen.getByText('IT').closest('td') as HTMLElement;
    const roleCell = screen.getByText('Pracownik', { selector: 'td' });
    for (const cell of [emailCell, deptCell, roleCell]) {
      const classes = cell.className.split(' ');
      expect(classes).toContain('hidden');
      expect(classes).toContain('md:table-cell');
    }
  });

  it('poniżej md pokazuje e-mail jako podlinię pod imieniem, gdy kolumna E-mail jest ukryta (rozróżnienie wierszy bez imienia/nazwiska)', () => {
    const noName: UserListItem = { ...users[1], firstName: null, lastName: null };
    render(<UsersTable users={[noName]} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText('Nie uzupełniono')).toBeInTheDocument();
    const nameCell = screen.getByText('Nie uzupełniono').closest('td') as HTMLElement;
    const subline = within(nameCell).getByText('anna@test.pl');
    expect(subline.className.split(' ')).toContain('md:hidden');
  });

  it('woła onEdit z klikniętym userem', () => {
    const onEdit = vi.fn();
    render(<UsersTable users={users} isLoading={false} onEdit={onEdit} onDelete={vi.fn()} />);

    fireEvent.click(screen.getAllByText('Edytuj')[0]);

    expect(onEdit).toHaveBeenCalledWith(users[0]);
  });

  it('usuwanie wymaga potwierdzenia inline (z e-mailem osoby, żeby nie pomylić kogo) przed wywołaniem onDelete', () => {
    const onDelete = vi.fn();
    render(<UsersTable users={[users[0]]} isLoading={false} onEdit={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('Usuń'));
    expect(onDelete).not.toHaveBeenCalled();

    // Usunięcie konta jest nieodwracalne - pytanie pokazuje e-mail, nie samo "Na pewno?", na każdej szerokości
    // (na telefonie kolumna E-mail jest ukryta).
    expect(screen.getByText('Usunąć jan@test.pl?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Usuń'));

    expect(onDelete).toHaveBeenCalledWith(users[0]);
  });

  it('anulowanie usuwania chowa potwierdzenie bez wywołania onDelete', () => {
    const onDelete = vi.fn();
    render(<UsersTable users={[users[0]]} isLoading={false} onEdit={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByText('Usuń'));
    fireEvent.click(screen.getByText('Anuluj'));

    expect(screen.queryByText('Usunąć jan@test.pl?')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
