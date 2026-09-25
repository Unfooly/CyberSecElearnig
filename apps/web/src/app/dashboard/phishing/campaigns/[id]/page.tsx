import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { Campaign, PersonalResultsSettings, ResultsView } from '@/lib/phishing-types';
import { isSafeId } from '@/lib/safe-id';
import Topbar from '@/components/Topbar';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import CampaignDetails from '../_components/CampaignDetails';
import CampaignResults from '../_components/CampaignResults';

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

  // Wyniki per dział (agregaty z progami) i stan przełącznika wyników osobowych - jedno źródło prawdy: API.
  const init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' as const };
  const [resultsView, settings] = result.ok
    ? await Promise.all([
        fetchJson<ResultsView>(`${API_URL}/phishing/results/campaigns/${params.id}/departments`, init),
        fetchJson<PersonalResultsSettings>(`${API_URL}/phishing/results/settings`, init),
      ])
    : [null, null];

  return (
    <div className="min-h-dvh bg-paper">
      <Topbar userEmail={userEmail} />
      <PageContainer size={1280}>
        <PageHeader title={result.ok ? result.data.name : 'Kampania'} />
        {result.ok ? (
          <div className="space-y-6">
            <CampaignDetails campaign={result.data} />
            {resultsView?.ok ? (
              <CampaignResults campaignId={params.id} view={resultsView.data} personalResultsEnabled={settings?.ok === true && settings.data.personalResultsEnabled} />
            ) : (
              <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
                Nie udało się załadować wyników kampanii.
              </p>
            )}
          </div>
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować kampanii. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </PageContainer>
    </div>
  );
}
