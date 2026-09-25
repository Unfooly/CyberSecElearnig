import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { PersonalResultsSettings, VisibilityAuditEntry } from '@/lib/phishing-types';
import { fetchOrganization } from '@/lib/organization';
import PendingHeader from '@/components/PendingHeader';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import PhishingResultsSettings from './PhishingResultsSettings';
import SettingsClient from './SettingsClient';

// Ustawienia organizacji (ORG_ADMIN - middleware.ts + API). Działają także dla
// organizacji PENDING (API: /organization/* oznaczone @AllowPendingOrganization).
export default async function SettingsPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const result = await fetchOrganization(accessToken);
  if (!result.ok && result.status === 401) {
    redirect('/login');
  }

  // Organizacja PENDING: uproszczony nagłówek (pełny Topbar prowadziłby do stron zablokowanych przez API).
  const isPending = result.ok && result.data.status === 'PENDING_DOMAIN_VERIFICATION';

  // Ustawienia wyników osobowych symulacji: tylko dla organizacji ACTIVE (API blokuje PENDING).
  const init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' as const };
  const [resultsSettings, resultsAudit] =
    result.ok && !isPending
      ? await Promise.all([
          fetchJson<PersonalResultsSettings>(`${API_URL}/phishing/results/settings`, init),
          fetchJson<VisibilityAuditEntry[]>(`${API_URL}/phishing/results/settings/audit`, init),
        ])
      : [null, null];

  return (
    <div className="min-h-dvh bg-paper">
      {isPending ? <PendingHeader /> : <Topbar userEmail={userEmail} />}
      <main className="mx-auto max-w-3xl px-6 pb-12 pt-9">
        <PageHeader title="Ustawienia organizacji" />
        {result.ok ? (
          <>
            <SettingsClient organization={result.data} />
            {resultsSettings?.ok && (
              <PhishingResultsSettings initial={resultsSettings.data} initialAudit={resultsAudit?.ok ? resultsAudit.data : []} />
            )}
          </>
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować ustawień. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
