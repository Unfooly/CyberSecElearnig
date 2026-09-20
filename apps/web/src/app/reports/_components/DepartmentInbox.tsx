'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import { STATUS_LABELS, STATUS_TONES, type DepartmentInbox as DepartmentInboxData } from '@/lib/threat-report-types';

const PAGE_SIZE = 25;

/**
 * Widok kierownika działu: zgłoszenia WŁASNEGO działu - data, domena nadawcy, czy zgłoszenie było powiązane z symulacją i status.
 * Bez tematu i pełnego nadawcy (dane osób trzecich), zgłaszającego, treści, nagłówków, komentarza i notatek, bez zmiany statusu
 * (decyzja produktu). Zgłoszenia pojawiają się z opóźnieniem godziny. Dział poniżej progu liczebności: "za mało danych".
 */
export default function DepartmentInbox() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DepartmentInboxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/threat-reports/department?page=${page}&pageSize=${PAGE_SIZE}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setData(null);
        setError(typeof body?.message === 'string' ? body.message : 'Nie udało się pobrać zgłoszeń.');
        return;
      }
      setData(body as DepartmentInboxData);
    } catch {
      setData(null);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
        {error}
      </p>
    );
  }
  if (loading && !data) {
    return <p className="text-muted">Ładowanie...</p>;
  }
  if (data?.insufficientData) {
    return (
      <Card>
        <p className="px-5 py-6 text-sm text-muted">
          <Pill tone="off">Za mało danych</Pill>
          <span className="ml-2">Zgłoszenia działów mniejszych niż {data.minGroupSize} osoby nie są pokazywane, żeby nie identyfikować zgłaszających.</span>
        </p>
      </Card>
    );
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <th className="px-5 py-3">Zgłoszono</th>
            <th className="px-5 py-3">Domena nadawcy</th>
            <th className="px-5 py-3">Symulacja</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((item) => (
            <tr key={item.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDateTime(item.createdAt)}</td>
              <td className="px-5 py-3">{item.senderDomain ?? '-'}</td>
              <td className="px-5 py-3">{item.isSimulation ? 'Tak' : 'Nie'}</td>
              <td className="px-5 py-3">
                {item.status ? <Pill tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Pill> : <span className="text-muted">-</span>}
              </td>
            </tr>
          ))}
          {data && data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="px-5 py-6 text-muted">
                Brak zgłoszeń z Twojego działu.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {data && pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
          <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
            Poprzednia
          </Button>
          <span className="text-muted">
            Strona {data.page} z {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages || loading} onClick={() => setPage((current) => current + 1)}>
            Następna
          </Button>
        </div>
      )}
    </Card>
  );
}
