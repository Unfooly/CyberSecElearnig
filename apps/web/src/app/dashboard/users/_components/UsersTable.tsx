'use client';

import { useState, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import InitialsAvatar, { initialsFrom } from '@/components/ui/InitialsAvatar';
import Pill from '@/components/ui/Pill';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { ROLE_LABELS, type UserListItem } from '@/lib/users-types';

const STATUS_LABELS: Record<UserListItem['status'], string> = {
  ACTIVE: 'Aktywny',
  INVITED: 'Zaproszony',
};

function StatusBadge({ status }: { status: UserListItem['status'] }) {
  return (
    <Pill tone={status === 'ACTIVE' ? 'ok' : 'warn'} dot>
      {STATUS_LABELS[status]}
    </Pill>
  );
}

const ACTION = 'rounded px-1.5 py-1 text-sm font-semibold hover:underline';

function DeleteAction({ user, onConfirm }: { user: UserListItem; onConfirm: (user: UserListItem) => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-muted">Na pewno?</span>
        <button type="button" onClick={() => onConfirm(user)} className={`${ACTION} text-danger`}>
          Usuń
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={`${ACTION} text-muted`}>
          Anuluj
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} className={`${ACTION} text-danger`}>
      Usuń
    </button>
  );
}

export default function UsersTable({
  users,
  isLoading,
  onEdit,
  onDelete,
  onResendInvite,
  isFiltered = false,
  emptyAction,
}: {
  users: UserListItem[];
  isLoading: boolean;
  onEdit: (user: UserListItem) => void;
  onDelete: (user: UserListItem) => void;
  onResendInvite?: (user: UserListItem) => void;
  // Puste wyniki przy aktywnym wyszukiwaniu/filtrze to co innego niż pusty zespół.
  isFiltered?: boolean;
  emptyAction?: ReactNode;
}) {
  if (!isLoading && users.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={isFiltered ? 'Brak pasujących pracowników' : 'Twój zespół jest jeszcze pusty'}
        description={
          isFiltered
            ? 'Zmień wyszukiwaną frazę albo wybierz inny dział.'
            : 'Zaproś pierwszą osobę albo zaimportuj cały zespół z pliku CSV.'
        }
        action={isFiltered ? undefined : emptyAction}
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-[130px]">Status</Th>
          <Th>Pracownik</Th>
          <Th className="hidden md:table-cell">E-mail</Th>
          <Th className="hidden md:table-cell">Dział</Th>
          <Th className="hidden md:table-cell">Rola</Th>
          <Th className="text-right">Akcje</Th>
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
          <tr>
            <td colSpan={6} className="px-5 py-6 text-center text-muted">
              Ładowanie...
            </td>
          </tr>
        ) : (
          users.map((user) => {
            const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
            return (
              <Tr key={user.id}>
                <Td>
                  <StatusBadge status={user.status} />
                </Td>
                <Td>
                  <div className="flex items-center gap-2.5 whitespace-nowrap font-semibold">
                    <InitialsAvatar initials={initialsFrom(user.firstName, user.lastName, user.email)} />
                    {fullName ? fullName : <span className="font-medium text-muted">Nie uzupełniono</span>}
                  </div>
                </Td>
                <Td className="hidden text-muted md:table-cell">{user.email}</Td>
                <Td className="hidden md:table-cell">{user.department ? <Pill tone="acc">{user.department.name}</Pill> : <Pill tone="off">Brak działu</Pill>}</Td>
                <Td className="hidden md:table-cell">{ROLE_LABELS[user.role]}</Td>
                <Td className="whitespace-nowrap text-right">
                  <button type="button" onClick={() => onEdit(user)} className={`${ACTION} text-accent-ink`}>
                    Edytuj
                  </button>
                  {user.status === 'INVITED' && onResendInvite && (
                    <>
                      <span aria-hidden="true" className="text-muted-2">
                        {' · '}
                      </span>
                      <button type="button" onClick={() => onResendInvite(user)} className={`${ACTION} text-accent-ink`}>
                        Wyślij zaproszenie ponownie
                      </button>
                    </>
                  )}
                  <span aria-hidden="true" className="text-muted-2">
                    {' · '}
                  </span>
                  <DeleteAction user={user} onConfirm={onDelete} />
                </Td>
              </Tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}
