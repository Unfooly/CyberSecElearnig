'use client';

import { useState } from 'react';
import { ROLE_LABELS, type UserListItem } from '@/lib/users-types';

const STATUS_LABELS: Record<UserListItem['status'], string> = {
  ACTIVE: 'Aktywny',
  INVITED: 'Zaproszony',
};

function StatusBadge({ status }: { status: UserListItem['status'] }) {
  const isActive = status === 'ACTIVE';
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      }`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function DeleteAction({ user, onConfirm }: { user: UserListItem; onConfirm: (user: UserListItem) => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-slate-500">Na pewno?</span>
        <button
          type="button"
          onClick={() => onConfirm(user)}
          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Usuń
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          Anuluj
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
    >
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
}: {
  users: UserListItem[];
  isLoading: boolean;
  onEdit: (user: UserListItem) => void;
  onDelete: (user: UserListItem) => void;
  onResendInvite?: (user: UserListItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Imię
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Nazwisko
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              E-mail
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Dział
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Rola
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Akcje
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                Ładowanie...
              </td>
            </tr>
          ) : users.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                Brak pracowników do wyświetlenia.
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <StatusBadge status={user.status} />
                </td>
                <td className="px-4 py-3 text-slate-900">{user.firstName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-900">{user.lastName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{user.email}</td>
                <td className="px-4 py-3 text-slate-600">{user.department?.name ?? 'Brak działu'}</td>
                <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onEdit(user)}
                      className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Edytuj
                    </button>
                    {user.status === 'INVITED' && onResendInvite && (
                      <button
                        type="button"
                        onClick={() => onResendInvite(user)}
                        className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Wyślij zaproszenie ponownie
                      </button>
                    )}
                    <DeleteAction user={user} onConfirm={onDelete} />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
