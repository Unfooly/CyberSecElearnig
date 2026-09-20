'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import { REPORT_STATUSES, STATUS_LABELS, STATUS_TONES, type AdminReportDetail, type ReportStatus } from '@/lib/threat-report-types';

const NOTE_MAX = 1000;

const Field = ({ label, value }: { label: string; value: string | null }) => (
  <div>
    <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</h3>
    {/* Treść zgłoszenia to czysty tekst: pre-wrap + escapowanie Reacta, nigdy HTML. */}
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-btn bg-paper px-3 py-2 font-sans text-sm">{value ?? '-'}</pre>
  </div>
);

/**
 * Szczegóły zgłoszenia dla ORG_ADMIN: treść (jako tekst), zgłaszający, zmiana statusu i notatki. Każda zmiana i notatka
 * trafia do dziennika zdarzeń (autor, czas) po stronie API; UI tylko odzwierciedla stan zwrócony przez serwer.
 */
export default function ReportDetail({ id }: { id: string }) {
  const [report, setReport] = useState<AdminReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/threat-reports/inbox/${id}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(response.status === 404 ? 'Nie znaleziono zgłoszenia.' : typeof body?.message === 'string' ? body.message : 'Nie udało się pobrać zgłoszenia.');
        return;
      }
      setReport(body as AdminReportDetail);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/threat-reports/inbox/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(Array.isArray(body?.message) ? body.message.join(' ') : (body?.message ?? 'Nie udało się zapisać zmiany.'));
        if (response.status === 409) {
          await load(); // status zmieniony w międzyczasie - pokaż aktualny stan
        }
        return false;
      }
      setReport(body as AdminReportDetail);
      return true;
    } catch {
      setActionError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (note.trim().length === 0) {
      return;
    }
    if (await send('notes', { note })) {
      setNote('');
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
        <Link href="/reports" className="text-sm font-semibold text-accent-ink hover:underline">
          ← Wróć do listy
        </Link>
      </div>
    );
  }
  if (!report) {
    return <p className="text-muted">Ładowanie...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm font-semibold text-accent-ink hover:underline">
          ← Wróć do listy
        </Link>
        <h1 className="mt-2 break-words text-[24px] font-extrabold leading-tight tracking-[-0.02em]">{report.subject ?? '(treść usunięta po 90 dniach)'}</h1>
        <p className="mt-1 text-sm text-muted">
          Zgłoszono {formatDateTime(report.createdAt)}
          {report.reporter ? (
            <>
              {' '}
              przez <strong>{report.reporter.name ?? report.reporter.email}</strong>
              {report.reporter.name ? ` (${report.reporter.email})` : ''}
            </>
          ) : (
            ' przez usuniętego pracownika'
          )}
          {report.departmentName ? `, dział: ${report.departmentName}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader title="Treść zgłoszenia" action={<Pill tone={STATUS_TONES[report.status]}>{STATUS_LABELS[report.status]}</Pill>} />
        <div className="space-y-4 px-5 py-4">
          {!report.hasContent && <p className="rounded-btn bg-paper px-3 py-2 text-sm text-muted">Treść tego zgłoszenia została usunięta po 90 dniach (retencja). Zostaje status, daty i dziennik zdarzeń.</p>}
          <Field label="Nadawca" value={report.senderText ?? (report.senderDomain ? `domena: ${report.senderDomain}` : null)} />
          {report.hasContent && (
            <>
              <Field label="Treść wiadomości" value={report.body} />
              <Field label="Nagłówki" value={report.headers} />
              <Field label="Komentarz zgłaszającego" value={report.comment} />
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Status" />
        <div className="space-y-3 px-5 py-4">
          {actionError && (
            <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
              {actionError}
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Zmień status">
            {REPORT_STATUSES.map((value: ReportStatus) => (
              <Button
                key={value}
                variant={report.status === value ? 'primary' : 'secondary'}
                size="sm"
                disabled={busy || report.status === value}
                aria-pressed={report.status === value}
                onClick={() => void send('status', { status: value })}
              >
                {STATUS_LABELS[value]}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Notatki i historia" />
        <div className="space-y-4 px-5 py-4">
          <ul className="divide-y divide-border text-sm">
            {report.events.length === 0 && <li className="py-2 text-muted">Brak wpisów.</li>}
            {report.events.map((event) => (
              <li key={event.id} className="py-2">
                <div className="text-xs text-muted">
                  {formatDateTime(event.createdAt)} - {event.actorEmail}
                </div>
                {event.type === 'STATUS_CHANGED' ? (
                  <div>
                    Zmiana statusu: {event.fromStatus ? STATUS_LABELS[event.fromStatus] : '-'} → <strong>{event.toStatus ? STATUS_LABELS[event.toStatus] : '-'}</strong>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{event.note ?? <span className="text-muted">(treść notatki usunięta po 90 dniach)</span>}</div>
                )}
              </li>
            ))}
          </ul>
          <form onSubmit={addNote} className="space-y-2">
            <label className="block text-sm font-bold">
              Nowa notatka
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={NOTE_MAX}
                rows={3}
                className="mt-1 w-full rounded-btn border border-border bg-surface px-3 py-2 font-medium"
              />
            </label>
            <Button type="submit" size="sm" disabled={busy || note.trim().length === 0}>
              Dodaj notatkę
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
