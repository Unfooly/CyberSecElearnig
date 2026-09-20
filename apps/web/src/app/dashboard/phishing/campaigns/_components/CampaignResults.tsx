'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Fields';
import Pill from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import {
  DELIVERY_LABELS,
  failureLabel,
  PEOPLE_FILTER_LABELS,
  PEOPLE_FILTERS,
  type PeopleFilter,
  type PersonResult,
  type ResultRow,
  type ResultsView,
} from '@/lib/phishing-types';

const percent = (value: number | null) => (value === null ? '-' : `${value}%`);

function DepartmentRow({ row, minGroupSize }: { row: ResultRow; minGroupSize: number }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-5 py-3 font-semibold">{row.name}</td>
      {row.insufficientData ? (
        <td colSpan={5} className="px-5 py-3 text-muted">
          <Pill tone="off">Za mało danych</Pill> <span className="ml-2 text-xs">Wynik grupy poniżej {minGroupSize} osób nie jest pokazywany.</span>
        </td>
      ) : (
        <>
          <td className="px-5 py-3 text-right">{row.delivered}</td>
          <td className="px-5 py-3 text-right">{row.clicked}</td>
          <td className="px-5 py-3 text-right">{percent(row.clickRate)}</td>
          <td className="px-5 py-3 text-right">{row.submitted}</td>
          <td className="px-5 py-3 text-right">{percent(row.submitRate)}</td>
        </>
      )}
    </tr>
  );
}

/**
 * Wyniki kampanii: agregaty per dział (zawsze, z progiem minimalnej liczebności) oraz - tylko gdy organizacja włączyła
 * wyniki osobowe - lista osób. Wgląd osobowy wymaga JAWNEGO kliknięcia (nie ładuje się sam), bo każdy wgląd trafia do
 * dziennika audytu; flagę i uprawnienia egzekwuje API (UI tylko odzwierciedla stan).
 */
export default function CampaignResults({ campaignId, view, personalResultsEnabled }: { campaignId: string; view: ResultsView; personalResultsEnabled: boolean }) {
  const [filter, setFilter] = useState<PeopleFilter>('ALL');
  const [people, setPeople] = useState<PersonResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next: PeopleFilter) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/phishing/results/campaigns/${campaignId}/people?filter=${next}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setPeople(null);
        setError(data?.code === 'PERSONAL_RESULTS_DISABLED' ? 'Wyniki osobowe zostały wyłączone.' : (data?.message ?? 'Nie udało się pobrać wyników osobowych.'));
        return;
      }
      setPeople(data as PersonResult[]);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setLoading(false);
    }
  }

  const insufficientOnly = view.departments.every((row) => row.insufficientData);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Wyniki per dział"
          action={
            <a href={`/api/phishing/results/campaigns/${campaignId}/departments.csv`} download className="text-sm font-bold text-accent-ink hover:underline">
              Pobierz CSV
            </a>
          }
        />
        <p className="px-5 pt-3 text-xs text-muted">
          Podatność = odsetek osób z dostarczoną wiadomością, które kliknęły / wysłały formularz. Grupy mniejsze niż {view.minGroupSize} osoby są łączone w
          „Pozostałe działy” albo ukrywane, żeby nie identyfikować pojedynczych osób.
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Dział</th>
              <th className="px-5 py-3 text-right">Dostarczono</th>
              <th className="px-5 py-3 text-right">Kliknęło</th>
              <th className="px-5 py-3 text-right">% kliknęło</th>
              <th className="px-5 py-3 text-right">Wysłało formularz</th>
              <th className="px-5 py-3 text-right">% formularz</th>
            </tr>
          </thead>
          <tbody>
            {view.total && <DepartmentRow row={{ ...view.total, name: 'Cała organizacja' }} minGroupSize={view.minGroupSize} />}
            {view.departments.filter((row) => row.kind !== 'ALL').map((row) => (
              <DepartmentRow key={`${row.kind}-${row.departmentId ?? row.name}`} row={row} minGroupSize={view.minGroupSize} />
            ))}
            {view.departments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-4 text-muted">
                  Brak danych do pokazania.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {insufficientOnly && view.departments.length > 0 && <p className="px-5 pb-4 text-xs text-muted">Za mało dostarczonych wiadomości, żeby pokazać wyniki.</p>}
      </Card>

      <Card>
        <CardHeader title="Wyniki osobowe" />
        {!personalResultsEnabled ? (
          <p className="px-5 py-4 text-sm text-muted">
            Wyniki osobowe (kto kliknął) są <strong>domyślnie wyłączone</strong>. Administrator organizacji może je włączyć w{' '}
            <Link href="/dashboard/settings#wyniki-osobowe" className="font-bold text-accent-ink hover:underline">
              ustawieniach
            </Link>{' '}
            - wymaga to podania uzasadnienia, a każdy wgląd i eksport jest zapisywany w dzienniku.
          </p>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <p className="rounded-btn bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
              To dane osobowe pracowników. Każdy wgląd i eksport CSV jest zapisywany w dzienniku audytu (kto i kiedy).
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-bold">
                Zakres
                <SelectField
                  value={filter}
                  onChange={(event) => {
                    const next = event.target.value as PeopleFilter;
                    setFilter(next);
                    setPeople(null);
                  }}
                  className="mt-1 w-56"
                  aria-label="Zakres"
                >
                  {PEOPLE_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {PEOPLE_FILTER_LABELS[value]}
                    </option>
                  ))}
                </SelectField>
              </label>
              <Button onClick={() => load(filter)} disabled={loading}>
                {loading ? 'Ładowanie...' : 'Pokaż wyniki osobowe'}
              </Button>
              <a href={`/api/phishing/results/campaigns/${campaignId}/people.csv?filter=${filter}`} download className="pb-2 text-sm font-bold text-accent-ink hover:underline">
                Pobierz CSV (audytowane)
              </a>
            </div>
            {error && (
              <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            {people && (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Pracownik</th>
                    <th className="px-3 py-2">Dział</th>
                    <th className="px-3 py-2">Dostarczenie</th>
                    <th className="px-3 py-2">Kliknięcie</th>
                    <th className="px-3 py-2">Formularz</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person, index) => (
                    <tr key={person.userId ?? `deleted-${index}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{person.name ?? person.email ?? '(usunięty pracownik)'}</div>
                        {person.name && person.email && <div className="text-xs text-muted">{person.email}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted">{person.departmentName ?? 'Bez działu'}</td>
                      <td className="px-3 py-2">
                        <Pill tone={person.delivery === 'SENT' ? 'ok' : person.delivery === 'UNCERTAIN' ? 'warn' : 'off'}>{DELIVERY_LABELS[person.delivery]}</Pill>
                        {person.failureCode && <div className="mt-1 text-xs text-muted">{failureLabel(person.failureCode)}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted">{person.clickedAt ? formatDateTime(person.clickedAt) : '-'}</td>
                      <td className="px-3 py-2 text-muted">{person.submittedAt ? formatDateTime(person.submittedAt) : '-'}</td>
                    </tr>
                  ))}
                  {people.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-muted">
                        Brak osób w wybranym zakresie.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
