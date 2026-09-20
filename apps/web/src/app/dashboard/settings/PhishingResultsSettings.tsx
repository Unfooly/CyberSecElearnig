'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { formatDateTime } from '@/lib/datetime';
import { AUDIT_ACTION_LABELS, PEOPLE_FILTER_LABELS, type PeopleFilter, type PersonalResultsSettings, type VisibilityAuditEntry } from '@/lib/phishing-types';

const MIN_JUSTIFICATION = 20;

/**
 * Przełącznik "Wyniki osobowe symulacji phishingowych". Domyślnie WYŁĄCZONE: bez niego wyniki są tylko zagregowane per
 * dział (z progiem liczebności). Włączenie wymaga uzasadnienia (min. 20 znaków) i zapisuje się w dzienniku audytu razem z
 * każdym wglądem i eksportem. UI tylko odzwierciedla stan - flagę, uzasadnienie i uprawnienia egzekwuje API.
 */
export default function PhishingResultsSettings({ initial, initialAudit }: { initial: PersonalResultsSettings; initialAudit: VisibilityAuditEntry[] }) {
  const [settings, setSettings] = useState(initial);
  const [audit, setAudit] = useState(initialAudit);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const justificationTooShort = justification.trim().length < MIN_JUSTIFICATION;

  async function change(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/phishing/results/settings/personal-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enabled ? { enabled, justification: justification.trim() } : { enabled }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(Array.isArray(data?.message) ? data.message.join(' ') : (data?.message ?? 'Nie udało się zmienić ustawienia.'));
        return;
      }
      setSettings(data as PersonalResultsSettings);
      setJustification('');
      const log = await fetch('/api/phishing/results/settings/audit').catch(() => null);
      if (log?.ok) {
        setAudit((await log.json().catch(() => audit)) as VisibilityAuditEntry[]);
      }
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6" id="wyniki-osobowe">
      <CardHeader title="Wyniki osobowe symulacji phishingowych" />
      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="text-muted">
          Domyślnie wyniki symulacji są pokazywane wyłącznie zbiorczo, per dział (grupy poniżej 3 osób są ukrywane). Włączenie wyników osobowych pozwala
          administratorowi zobaczyć, którzy pracownicy kliknęli w symulację. To dane osobowe: włączenie wymaga uzasadnienia, a każde włączenie, wyłączenie,
          wgląd i eksport jest zapisywane w dzienniku poniżej.
        </p>
        <p>
          Stan: <strong>{settings.personalResultsEnabled ? 'włączone' : 'wyłączone'}</strong>
          {settings.updatedAt && settings.changedByEmail && (
            <span className="text-muted">
              {' '}
              (zmienił(a) {settings.changedByEmail}, {formatDateTime(settings.updatedAt)})
            </span>
          )}
        </p>
        {settings.personalResultsEnabled && settings.justification && (
          <p className="rounded-btn bg-paper px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Uzasadnienie</span>
            <br />
            {settings.justification}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 font-semibold text-danger">
            {error}
          </p>
        )}

        {settings.personalResultsEnabled ? (
          <Button variant="secondary" onClick={() => change(false)} disabled={busy}>
            {busy ? 'Zapisywanie...' : 'Wyłącz wyniki osobowe'}
          </Button>
        ) : (
          <div className="space-y-2">
            <label className="block font-bold">
              Uzasadnienie włączenia (min. {MIN_JUSTIFICATION} znaków)
              <textarea
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded-btn border border-border bg-surface px-3 py-2 font-medium"
              />
            </label>
            <Button onClick={() => change(true)} disabled={busy || justificationTooShort}>
              {busy ? 'Zapisywanie...' : 'Włącz wyniki osobowe'}
            </Button>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Dziennik dostępu</h3>
          {audit.length === 0 ? (
            <p className="text-muted">Brak wpisów.</p>
          ) : (
            <ul className="divide-y divide-border">
              {audit.slice(0, 20).map((entry) => (
                <li key={entry.id} className="py-2">
                  <span className="font-semibold">{AUDIT_ACTION_LABELS[entry.action]}</span> <span className="text-muted">- {entry.actorEmail}, {formatDateTime(entry.createdAt)}</span>
                  {entry.justification && <div className="text-xs text-muted">Uzasadnienie: {entry.justification}</div>}
                  {entry.rowCount !== null && (
                    <div className="text-xs text-muted">
                      Zakres: {PEOPLE_FILTER_LABELS[entry.filter as PeopleFilter] ?? entry.filter}, osób: {entry.rowCount}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
