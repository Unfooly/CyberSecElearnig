import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { PhishingConfig, PhishingTemplate } from '@/lib/phishing-types';
import type { DepartmentOption } from '@/lib/users-types';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import CampaignWizard from '../_components/CampaignWizard';

// Kreator kampanii: szablon -> odbiorcy -> okno -> podgląd i uruchomienie.
export default async function NewPhishingCampaignPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;
  const init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' as const };

  const [templates, departments, config] = await Promise.all([
    fetchJson<PhishingTemplate[]>(`${API_URL}/phishing/templates`, init),
    fetchJson<DepartmentOption[]>(`${API_URL}/users/departments`, init),
    fetchJson<PhishingConfig>(`${API_URL}/phishing/config`, init),
  ]);
  for (const result of [templates, departments, config]) {
    if (!result.ok && result.status === 401) {
      redirect('/login');
    }
  }
  if (!templates.ok && templates.status === 403) {
    await redirectIfPending(accessToken);
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-[1080px] px-10 pb-12 pt-9">
        <PageHeader title="Nowa kampania phishingowa" />
        {templates.ok && departments.ok && config.ok ? (
          <CampaignWizard templates={templates.data} departments={departments.data} config={config.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować danych kreatora. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
