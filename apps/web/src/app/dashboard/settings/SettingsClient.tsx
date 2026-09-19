'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card, { CardHeader } from '@/components/ui/Card';
import type { OrganizationOverview } from '@/lib/organization';

const COUNTRY_NAMES: Record<string, string> = { PL: 'Polska' };

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
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const domainVerified = organization.domain?.verified === true;
  const { billing, domain } = organization;

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

  return (
    <div className="space-y-6">
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
    </div>
  );
}
