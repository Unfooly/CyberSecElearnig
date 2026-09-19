import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { Campaign } from '@/lib/phishing-types';
import Topbar from '@/components/Topbar';
import { buttonClasses } from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import CampaignsList from './_components/CampaignsList';

// Kampanie symulacji phishingowych (ORG_ADMIN - middleware.ts /dashboard + apps/api RolesGuard).
export default async function PhishingCampaignsPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const result = await fetchJson<Campaign[]>(`${API_URL}/phishing/campaigns`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!result.ok && result.status === 401) {
    redirect('/login');
  }
  if (!result.ok && result.status === 403) {
    await redirectIfPending(accessToken);
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-[1280px] px-10 pb-12 pt-9">
        <PageHeader
          title="Kampanie phishingowe"
          subtitle="Symulacje wysyłane do pracowników w wybranym oknie czasowym."
          actions={
            <>
              <Link href="/dashboard/phishing/templates" className={buttonClasses('secondary')}>
                Szablony
              </Link>
              <Link href="/dashboard/phishing/campaigns/new" className={buttonClasses('primary')}>
                Nowa kampania
              </Link>
            </>
          }
        />
        {result.ok ? (
          <CampaignsList campaigns={result.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować kampanii. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
