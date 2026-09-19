import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { Campaign } from '@/lib/phishing-types';
import { isSafeId } from '@/lib/safe-id';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import CampaignDetails from '../_components/CampaignDetails';

export default async function PhishingCampaignPage({ params }: { params: { id: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  if (!isSafeId(params.id)) {
    notFound();
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const result = await fetchJson<Campaign>(`${API_URL}/phishing/campaigns/${params.id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!result.ok && result.status === 401) {
    redirect('/login');
  }
  if (!result.ok && result.status === 403) {
    await redirectIfPending(accessToken);
  }
  if (!result.ok && result.status === 404) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-[1280px] px-10 pb-12 pt-9">
        <PageHeader title={result.ok ? result.data.name : 'Kampania'} />
        {result.ok ? (
          <CampaignDetails campaign={result.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować kampanii. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
