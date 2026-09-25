'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import { CAMPAIGN_STATUS_LABELS, failureLabel, type Campaign } from '@/lib/phishing-types';
import { STATUS_TONES } from './CampaignsList';

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function CampaignDetails({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = campaign.status === 'SCHEDULED' || campaign.status === 'RUNNING';

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/phishing/campaigns/${campaign.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się anulować kampanii.');
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setBusy(false);
    }
  }

  const { counts } = campaign;
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
            <dd>
              <Pill tone={STATUS_TONES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Pill>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Szablon</dt>
            <dd>{campaign.templateName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Okno wysyłki</dt>
            <dd>
              {formatDateTime(campaign.windowStart)} - {formatDateTime(campaign.windowEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Nadawca</dt>
            <dd>
              {campaign.senderName} {campaign.senderAddress ? `<${campaign.senderAddress}>` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Uruchomił(a)</dt>
            <dd>{campaign.createdByEmail}</dd>
          </div>
        </dl>
        {active && (
          <div className="flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm text-muted">Niewysłane wiadomości nie zostaną wysłane. Kontynuować?</span>
                <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                  Nie
                </Button>
                <Button onClick={cancel} disabled={busy}>
                  {busy ? 'Anulowanie...' : 'Tak, anuluj kampanię'}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Anuluj kampanię
              </Button>
            )}
          </div>
        )}
      </Card>

      {error && (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Odbiorcy" value={counts.total} />
        <Stat label="Wysłano" value={counts.sent} />
        <Stat label="Oczekuje" value={counts.pending} hint="Czeka na swój moment w oknie lub jest w trakcie wysyłki." />
        <Stat label="Nieudane" value={counts.failed} hint="Wiadomo, że wiadomość nie wyszła." />
        <Stat label="Niepewne" value={counts.uncertain} hint="Dostawca mógł wysłać wiadomość (np. przekroczony czas). Nie ponawiamy, żeby nie wysłać duplikatu." />
      </div>

      {campaign.failures.length > 0 && (
        <Card>
          <CardHeader title="Nieudane i niepewne wysyłki" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Przyczyna</th>
                  <th className="px-5 py-3">Typ</th>
                  <th className="px-5 py-3 text-right">Liczba</th>
                </tr>
              </thead>
              <tbody>
                {campaign.failures.map((failure) => (
                  <tr key={failure.code} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">{failureLabel(failure.code)}</td>
                    <td className="px-5 py-3">
                      <Pill tone={failure.uncertain ? 'warn' : 'off'}>{failure.uncertain ? 'Niepewne' : 'Nieudane'}</Pill>
                    </td>
                    <td className="px-5 py-3 text-right">{failure.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
