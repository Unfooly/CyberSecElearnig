'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import { REPORT_STATUSES, STATUS_LABELS, STATUS_TONES, type AdminInboxItem, type Page, type ReportStatus } from '@/lib/threat-report-types';

const PAGE_SIZE = 25;

/**
 * Skrzynka zgłoszeń dla ORG_ADMIN: lista prawdziwych zgłoszeń (bez treści; treść w szczegółach), filtr statusu, stronicowanie.
 * Wszystko z treści zgłoszeń jest wyświetlane wyłącznie jako TEKST (React escapuje) - nic nie jest interpretowane jako HTML.
 */
export default function AdminInbox() {
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminInboxItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(status ? { status } : {}) });
      const response = await fetch(`/api/threat-reports/inbox?${query}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setData(null);
        setError(typeof body?.message === 'string' ? body.message : 'Nie udało się pobrać zgłoszeń.');
        return;
      }
      setData(body as Page<AdminInboxItem>);
    } catch {
      setData(null);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <label className="flex items-center gap-2 text-sm font-bold">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ReportStatus | '');
              setPage(1);
            }}
            className="rounded-btn border border-border bg-surface px-3 py-1.5 font-medium"
          >
            <option value="">Wszystkie</option>
            {REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {data && <span className="text-sm text-muted">Razem: {data.total}</span>}
      </div>

      {error && (
        <p role="alert" className="m-5 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {!error && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="hidden px-5 py-3 md:table-cell">Zgłoszono</th>
                <th className="px-5 py-3">Temat i nadawca</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="hidden whitespace-nowrap px-5 py-3 text-muted md:table-cell">{formatDateTime(item.createdAt)}</td>
                  <td className="px-5 py-3">
                    <Link href={`/reports/${item.id}`} className="font-semibold text-accent-ink hover:underline">
                      {item.subject ?? '(treść usunięta po 90 dniach)'}
                    </Link>
                    <div className="text-xs text-muted">{item.senderText ?? (item.senderDomain ? `domena: ${item.senderDomain}` : '-')}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Pill tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Pill>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-muted">
                    Brak zgłoszeń w wybranym zakresie.
                  </td>
                </tr>
              )}
              {loading && !data && (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-muted">
                    Ładowanie...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm">
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
