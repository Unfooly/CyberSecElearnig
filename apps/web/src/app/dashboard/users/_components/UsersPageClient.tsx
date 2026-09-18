'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DepartmentOption, InviteUserResult, UserListItem, UsersListResponse } from '@/lib/users-types';
import UsersTable from './UsersTable';
import InviteUserModal from './InviteUserModal';
import EditUserModal from './EditUserModal';
import ImportCsvModal from './ImportCsvModal';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function UsersPageClient() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  // Numer ostatniego żądania - odpowiedź wolniejszego, starszego żądania nie
  // może nadpisać stanu nowszego (szybka zmiana wyszukiwania/strony).
  const latestRequestId = useRef(0);

  const [showInvite, setShowInvite] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);

  // Debounce: nie odpytujemy backendu na każde naciśnięcie klawisza, tylko
  // po chwili ciszy - i wracamy na stronę 1, bo wynik nowego wyszukiwania
  // może mieć mniej stron niż poprzedni.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const fetchUsers = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (departmentId) {
        params.set('departmentId', departmentId);
      }
      const response = await fetch(`/api/users?${params.toString()}`);
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!response.ok) {
        setLoadError('Nie udało się załadować listy pracowników.');
        return;
      }
      const data = (await response.json()) as UsersListResponse;
      if (requestId !== latestRequestId.current) {
        return;
      }
      // Usunięcie ostatniego elementu ostatniej strony zostawiłoby pustą,
      // nieistniejącą stronę - wracamy na ostatnią, która ma dane.
      const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setUsers(data.items);
      setTotal(data.total);
    } catch {
      if (requestId === latestRequestId.current) {
        setLoadError('Nie udało się połączyć z serwerem.');
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [page, search, departmentId]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetch('/api/users/departments')
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setDepartments(data as DepartmentOption[]))
      .catch(() => setDepartments([]));
  }, []);

  async function handleDelete(user: UserListItem) {
    setActionError(null);
    try {
      const response = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (response.ok) {
        void fetchUsers();
        return;
      }
      const data = await response.json().catch(() => null);
      setActionError(data?.message ?? 'Nie udało się usunąć pracownika.');
    } catch {
      setActionError('Nie udało się połączyć z serwerem.');
    }
  }

  async function handleResendInvite(user: UserListItem) {
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/users/${user.id}/resend-invite`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(data?.message ?? 'Nie udało się wysłać zaproszenia ponownie.');
        return;
      }
      setNotice(
        data?.inviteEmailSent
          ? { kind: 'success', text: `Wysłano zaproszenie ponownie na adres ${user.email}.` }
          : {
              kind: 'warning',
              text: `Nie udało się wysłać wiadomości na adres ${user.email}. Sprawdź, czy adres jest poprawny.`,
            },
      );
    } catch {
      setActionError('Nie udało się połączyć z serwerem.');
    }
  }

  function handleInvited(result: InviteUserResult) {
    setShowInvite(false);
    setNotice(
      result.inviteEmailSent
        ? { kind: 'success', text: `Zaproszenie wysłane na adres ${result.email}.` }
        : {
            kind: 'warning',
            text: `Konto ${result.email} zostało utworzone, ale wiadomość z zaproszeniem NIE została wysłana. Sprawdź poprawność adresu (użyj "Wyślij zaproszenie ponownie" albo usuń konto i zaproś ponownie).`,
          },
    );
    void fetchUsers();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Szukaj po imieniu, nazwisku lub e-mailu..."
            aria-label="Szukaj pracowników"
            className="w-64 rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <select
            aria-label="Filtruj po dziale"
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">Wszystkie działy</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowImportCsv(true)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Importuj z CSV
          </button>
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Zaproś pracownika
          </button>
        </div>
      </div>

      {notice && (
        <p
          role={notice.kind === 'warning' ? 'alert' : 'status'}
          className={`mb-4 rounded px-3 py-2 text-sm ${
            notice.kind === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'
          }`}
        >
          {notice.text}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loadError && (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <UsersTable
        users={users}
        isLoading={isLoading}
        onEdit={setEditingUser}
        onDelete={handleDelete}
        onResendInvite={handleResendInvite}
      />

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Strona {page} z {totalPages} ({total} {total === 1 ? 'pracownik' : 'pracowników'})
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded px-3 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Poprzednia
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="rounded px-3 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Następna
            </button>
          </div>
        </div>
      )}

      {showInvite && (
        <InviteUserModal
          departments={departments}
          onClose={() => setShowInvite(false)}
          onCreated={handleInvited}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          departments={departments}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            void fetchUsers();
          }}
        />
      )}

      {showImportCsv && (
        <ImportCsvModal onClose={() => setShowImportCsv(false)} onImported={() => void fetchUsers()} />
      )}
    </div>
  );
}
