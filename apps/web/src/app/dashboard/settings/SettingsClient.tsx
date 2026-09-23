'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { DEFAULT_TIMEZONE } from '@/lib/datetime';
import type { OrganizationOverview } from '@/lib/organization';

const COUNTRY_NAMES: Record<string, string> = { PL: 'Polska' };
const TIMEZONE_CHOICES = ['Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Kyiv', 'UTC'];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

export default function SettingsClient({ organization }: { organization: OrganizationOverview }) {
  const [selfJoin, setSelfJoin] = useState(organization.selfJoinEnabled);
  const [timezone, setTimezone] = useState(organization.timezone ?? DEFAULT_TIMEZONE);
  const router = useRouter();
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const domainVerified = organization.domain?.verified === true;
  const { billing, domain } = organization;

  async function handleLogoutAll() {
    setIsLoggingOutAll(true);
    setSessionsError(null);
    try {
      const response = await fetch('/api/auth/logout-all', { method: 'POST' });
      if (!response.ok) {
        setSessionsError('Nie udało się wylogować ze wszystkich urządzeń. Spróbuj ponownie.');
        return;
      }
      router.push('/login');
      router.refresh();
    } catch {
      setSessionsError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setIsLoggingOutAll(false);
    }
  }

  async function handleToggle(next: boolean) {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selfJoinEnabled: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ kind: 'error', text: data?.message ?? 'Nie udało się zapisać ustawienia.' });
        return;
      }
      // Wartość z API; przy nieoczekiwanym ciele zostaje to, o co użytkownik poprosił (API odpowiedziało sukcesem).
      setSelfJoin(typeof data?.selfJoinEnabled === 'boolean' ? data.selfJoinEnabled : next);
      setMessage({ kind: 'success', text: 'Ustawienie zapisane.' });
    } catch {
      setMessage({ kind: 'error', text: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTimezone(next: string) {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ kind: 'error', text: Array.isArray(data?.message) ? data.message.join(' ') : (data?.message ?? 'Nie udało się zapisać strefy czasowej.') });
        return;
      }
      setTimezone(typeof data?.timezone === 'string' ? data.timezone : next);
      setMessage({ kind: 'success', text: 'Strefa czasowa zapisana.' });
    } catch {
      setMessage({ kind: 'error', text: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' });
    } finally {
      setIsSaving(false);
    }
  }

  // Najczęstsze strefy; aktualna wartość z API jest zawsze na liście (także spoza niej).
  const timezoneOptions = TIMEZONE_CHOICES.includes(timezone) ? TIMEZONE_CHOICES : [timezone, ...TIMEZONE_CHOICES];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Strefa czasowa" />
        <div className="space-y-2 p-5 text-sm">
          <label className="block font-semibold">
            Strefa czasowa organizacji
            <select
              value={timezone}
              disabled={isSaving}
              onChange={(event) => handleTimezone(event.target.value)}
              className="mt-1 block h-10 w-72 rounded-btn border border-border bg-surface px-3 font-medium"
            >
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            Zapisana strefa jest przechowywana przy organizacji. Wyświetlanie dat i godzin w aplikacji stosuje na razie stałą strefę {DEFAULT_TIMEZONE} - podłączenie
            zapisanej wartości do wszystkich ekranów to następny krok.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Dane firmy" />
        <div className="p-5">
          {billing ? (
            <dl className="space-y-3">
              <Row label="Nazwa wyświetlana" value={organization.name} />
              <Row label="Pełna nazwa firmy" value={billing.legalName} />
              <Row label="NIP" value={billing.taxId} />
              <Row label="Adres" value={`${billing.addressLine}, ${billing.postalCode} ${billing.city}`} />
              <Row label="Kraj" value={COUNTRY_NAMES[billing.country] ?? billing.country} />
            </dl>
          ) : (
            <p className="text-sm text-muted">Brak danych firmy (organizacja utworzona przed rejestracją samoobsługową).</p>
          )}
          <p className="mt-4 text-xs text-muted">Zmiana danych firmy: skontaktuj się z nami.</p>
        </div>
      </Card>

      {/* Opiekun (partner): sama nazwa, bez historii wejść i bez możliwości zmiany - przypisanie
          i odłączenie resellera to wyłącznie decyzja operatora platformy (D-070). */}
      {organization.reseller && (
        <Card>
          <CardHeader title="Opieka partnera" />
          <div className="p-5">
            <dl className="space-y-3">
              <Row label="Twój opiekun" value={organization.reseller.name} />
            </dl>
            <p className="mt-4 text-xs text-muted">
              Partner pomaga w obsłudze Twojej organizacji. Zmiana lub rezygnacja z opieki: skontaktuj się z nami.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Domena" />
        <div className="p-5 text-sm">
          {domain ? (
            <p>
              <strong>{domain.name}</strong> -{' '}
              {domain.verified ? (
                <span className="font-semibold text-success">zweryfikowana</span>
              ) : (
                <>
                  <span className="font-semibold text-warning">czeka na weryfikację</span>.{' '}
                  <Link href="/onboarding" className="font-semibold text-accent-ink underline">
                    Zweryfikuj domenę
                  </Link>
                </>
              )}
            </p>
          ) : (
            <p className="text-muted">Brak domeny do weryfikacji.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Dołączanie pracowników" />
        <div className="p-5">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              role="switch"
              checked={selfJoin}
              disabled={!domainVerified || isSaving}
              onChange={(event) => handleToggle(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="font-semibold">Pozwól pracownikom dołączać samodzielnie</span>
              <span className="mt-0.5 block text-muted">
                Osoby z adresem w domenie {domain?.name ?? 'firmowej'} będą mogły same dołączyć do organizacji.
              </span>
            </span>
          </label>
          {!domainVerified && (
            <p className="mt-3 text-xs text-muted">Ta opcja będzie dostępna po zweryfikowaniu domeny.</p>
          )}
          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`mt-4 rounded-btn px-3 py-2 text-sm font-semibold ${
                message.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sesje" />
        <div className="p-5 text-sm">
          <p className="mb-3 text-muted">
            Wyloguje Cię ze wszystkich urządzeń i przeglądarek, także tej. Użyj tego, gdy zgubisz urządzenie albo
            podejrzewasz, że ktoś ma dostęp do Twojego konta.
          </p>
          <Button variant="secondary" onClick={handleLogoutAll} disabled={isLoggingOutAll}>
            {isLoggingOutAll ? 'Wylogowywanie...' : 'Wyloguj wszędzie'}
          </Button>
          {sessionsError && (
            <p role="alert" className="mt-3 rounded-btn bg-danger-soft px-3 py-2 font-semibold text-danger">
              {sessionsError}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
