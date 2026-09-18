'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComplianceStatus, UsersStatusResponse, UsersStatusSortField } from '@/lib/dashboard-types';
import { formatDateTime } from '@/lib/format';
import PercentBar from './PercentBar';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

export interface DepartmentFilterOption {
  id: string;
  name: string;
}

const STATUS_BADGES: Record<ComplianceStatus, { label: string; className: string }> = {
  COMPLIANT: { label: 'Zgodny', className: 'bg-green-100 text-green-800' },
  OVERDUE: { label: 'Zaległości', className: 'bg-red-100 text-red-800' },
  IN_PROGRESS: { label: 'W trakcie', className: 'bg-amber-100 text-amber-800' },
  NO_ASSIGNMENTS: { label: 'Brak przypisań', className: 'bg-slate-100 text-slate-600' },
};

const COLUMNS: { label: string; field: UsersStatusSortField | null }[] = [
  { label: 'Pracownik', field: 'name' },
  { label: 'Dział', field: 'department' },
  { label: 'Postęp', field: 'completion' },
  { label: 'Ostatnia aktywność', field: 'lastActivity' },
  { label: 'Status', field: null },
];

export default function UsersComplianceTable({ departments }: { departments: DepartmentFilterOption[] }) {
  const [data, setData] = useState<UsersStatusResponse | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [sortBy, setSortBy] = useState<UsersStatusSortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Odpowiedź starszego, wolniejszego żądania nie może nadpisać nowszej.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy,
        sortDir,
      });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (departmentId) {
        params.set('departmentId', departmentId);
      }
      const response = await fetch(`/api/dashboard/users-status?${params.toString()}`);
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!response.ok) {
        setLoadError('Nie udało się załadować statusu pracowników.');
        return;
      }
      const body = (await response.json()) as UsersStatusResponse;
      if (requestId !== latestRequestId.current) {
        return;
      }
      setData(body);
    } catch {
      if (requestId === latestRequestId.current) {
        setLoadError('Nie udało się połączyć z serwerem.');
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [page, search, departmentId, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(field: UsersStatusSortField) {
    if (field === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'completion' || field === 'lastActivity' ? 'desc' : 'asc');
    }
    setPage(1);
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm" aria-labelledby="compliance-heading">
      <h2 id="compliance-heading" className="mb-3 text-base font-semibold text-slate-900">
        Status pracowników
      </h2>

      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Szukaj po imieniu, nazwisku lub e-mailu"
          aria-label="Szukaj pracownika"
          maxLength={100}
          className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setPage(1);
          }}
          aria-label="Filtruj po dziale"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Wszystkie działy</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </div>

      {loadError && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-busy={isLoading}>
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className="px-4 py-3 font-medium"
                  aria-sort={
                    column.field && column.field === sortBy
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {column.field ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.field as UsersStatusSortField)}
                      className="font-medium hover:text-slate-900"
                    >
                      {column.label}
                      {column.field === sortBy ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-slate-400">
                  {isLoading ? 'Ładowanie...' : 'Brak pracowników do wyświetlenia.'}
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const badge = STATUS_BADGES[row.complianceStatus];
                const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{fullName || row.email}</div>
                      {fullName && <div className="text-xs text-slate-500">{row.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.departmentName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <PercentBar value={row.completionPercentage} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.lastActivityAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600 print:hidden">
        <span>
          Razem: {total} · Strona {Math.min(page, lastPage)} z {lastPage}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || isLoading}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Poprzednia
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
            disabled={page >= lastPage || isLoading}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Następna
          </button>
        </div>
      </div>
    </section>
  );
}
