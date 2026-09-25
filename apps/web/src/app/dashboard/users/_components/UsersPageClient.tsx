'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DepartmentOption, InviteUserResult, UserListItem, UsersListResponse } from '@/lib/users-types';
import { Plus, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { SearchInput, SelectField } from '@/components/ui/Fields';
import PageHeader from '@/components/ui/PageHeader';
import UsersTable from './UsersTable';
import InviteUserModal from './InviteUserModal';
import EditUserModal from './EditUserModal';
import ImportUsersModal from './ImportUsersModal';

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
        // Guard API: organizacja czeka na weryfikację domeny => ekran weryfikacji.
        if (response.status === 403) {
          const body = await response.json().catch(() => null);
          if (body?.code === 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION') {
            window.location.assign('/onboarding');
            return;
          }
        }
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
  const isFiltered = search.trim() !== '' || departmentId !== '';

  const inviteButton = (
    <Button onClick={() => setShowInvite(true)} icon={<Plus size={16} strokeWidth={2.4} aria-hidden="true" />}>
      Zaproś pracownika
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Zespół"
        subtitle={`${total} ${total === 1 ? 'pracownik' : 'pracowników'}`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowImportCsv(true)}
              icon={<Upload size={16} strokeWidth={2.2} aria-hidden="true" />}
            >
              Importuj z CSV
            </Button>
            {inviteButton}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Szukaj po imieniu, nazwisku lub e-mailu..."
          aria-label="Szukaj pracowników"
          className="w-80 max-w-full"
        />
        <SelectField
          aria-label="Filtruj po dziale"
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Wszystkie działy</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </SelectField>
      </div>

      {notice && (
        <p
          role={notice.kind === 'warning' ? 'alert' : 'status'}
          className={`mb-4 rounded-btn px-3 py-2 text-sm font-semibold ${
            notice.kind === 'warning' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'
          }`}
        >
          {notice.text}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {actionError}
        </p>
      )}

      {loadError && (
        <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {loadError}
        </p>
      )}

      <Card>
        <UsersTable
          users={users}
          isLoading={isLoading}
          onEdit={setEditingUser}
          onDelete={handleDelete}
          onResendInvite={handleResendInvite}
          isFiltered={isFiltered}
          emptyAction={inviteButton}
        />

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-[13px] text-muted">
            <span>
              Strona {page} z {totalPages} ({total} {total === 1 ? 'pracownik' : 'pracowników'})
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Poprzednia
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Następna
              </Button>
            </div>
          </div>
        )}
      </Card>

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
        <ImportUsersModal onClose={() => setShowImportCsv(false)} onChanged={() => void fetchUsers()} />
      )}
    </div>
  );
}
