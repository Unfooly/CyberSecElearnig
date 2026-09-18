'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComplianceStatus, UsersStatusResponse, UsersStatusSortField } from '@/lib/dashboard-types';
import { formatDateTime } from '@/lib/format';
import { Users } from 'lucide-react';
import { SearchInput, SelectField } from '@/components/ui/Fields';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import InitialsAvatar, { initialsFrom } from '@/components/ui/InitialsAvatar';
import Pill, { type PillTone } from '@/components/ui/Pill';
import ProgressBar, { type ProgressTone } from '@/components/ui/ProgressBar';
import { Table, Td, Th, Tr } from '@/components/ui/Table';

function toneForPercent(value: number): ProgressTone {
  if (value === 100) return 'success';
  if (value < 50) return 'warning';
  return 'accent';
}

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

export interface DepartmentFilterOption {
  id: string;
  name: string;
}

const STATUS_BADGES: Record<ComplianceStatus, { label: string; tone: PillTone }> = {
  COMPLIANT: { label: 'Zgodny', tone: 'ok' },
  OVERDUE: { label: 'Zaległości', tone: 'warn' },
  IN_PROGRESS: { label: 'W trakcie', tone: 'acc' },
  NO_ASSIGNMENTS: { label: 'Brak przypisań', tone: 'off' },
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
  const isFiltered = search.trim() !== '' || departmentId !== '';

  return (
    <section
      className="rounded-card border border-border bg-surface shadow-card"
      aria-labelledby="compliance-heading"
    >
      <div className="border-b border-border px-5 py-[18px]">
        <h2 id="compliance-heading" className="text-lg font-bold tracking-[-0.01em]">
          Status pracowników
        </h2>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4 print:hidden">
        <SearchInput
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Szukaj po imieniu, nazwisku lub e-mailu"
          aria-label="Szukaj pracownika"
          maxLength={100}
          className="min-w-64 flex-1"
        />
        <SelectField
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setPage(1);
          }}
          aria-label="Filtruj po dziale"
        >
          <option value="">Wszystkie działy</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </SelectField>
      </div>

      {loadError && (
        <p role="alert" className="mx-5 mt-4 rounded-btn bg-danger-soft p-3 text-sm text-danger">
          {loadError}
        </p>
      )}

      {items.length === 0 && !isLoading && !loadError ? (
        <EmptyState
          icon={Users}
          title={isFiltered ? 'Brak pasujących pracowników' : 'Nie ma jeszcze kogo raportować'}
          description={
            isFiltered
              ? 'Zmień wyszukiwaną frazę albo wybierz inny dział.'
              : 'Gdy zaprosisz pracowników i przypiszesz im szkolenia, zobaczysz tu ich status.'
          }
        />
      ) : (
        <Table aria-busy={isLoading}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <Th
                  key={column.label}
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
                      className="font-bold uppercase tracking-[0.04em] hover:text-ink"
                    >
                      {column.label}
                      {column.field === sortBy ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : (
                    column.label
                  )}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-6 text-center text-muted">
                  Ładowanie...
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const badge = STATUS_BADGES[row.complianceStatus];
                const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
                return (
                  <Tr key={row.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <InitialsAvatar initials={initialsFrom(row.firstName, row.lastName, row.email)} />
                        <div>
                          <div className="font-semibold">{fullName || row.email}</div>
                          {fullName && <div className="text-xs text-muted">{row.email}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {row.departmentName ? <Pill tone="acc">{row.departmentName}</Pill> : <Pill tone="off">Brak działu</Pill>}
                    </Td>
                    <Td>
                      {row.completionPercentage === null ? (
                        <span className="text-muted-2">Brak przypisań</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-28">
                            <ProgressBar
                              value={row.completionPercentage}
                              tone={toneForPercent(row.completionPercentage)}
                              label={`Postęp: ${fullName || row.email}`}
                            />
                          </div>
                          <b className="w-10">{row.completionPercentage}%</b>
                        </div>
                      )}
                    </Td>
                    <Td className="text-muted">{formatDateTime(row.lastActivityAt)}</Td>
                    <Td>
                      <Pill tone={badge.tone} dot>
                        {badge.label}
                      </Pill>
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
      )}

      <div className="flex items-center justify-between px-5 py-3.5 text-[13px] text-muted print:hidden">
        <span>
          Razem: {total} · Strona {Math.min(page, lastPage)} z {lastPage}
        </span>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || isLoading}
          >
            Poprzednia
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
            disabled={page >= lastPage || isLoading}
          >
            Następna
          </Button>
        </div>
      </div>
    </section>
  );
}
