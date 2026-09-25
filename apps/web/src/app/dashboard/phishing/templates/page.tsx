import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { PhishingTemplate } from '@/lib/phishing-types';
import Topbar from '@/components/Topbar';
import PageContainer from '@/components/ui/PageContainer';
import { buttonClasses } from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import TemplatesList from './_components/TemplatesList';

// Szablony symulacji phishingowych (ORG_ADMIN - middleware.ts /dashboard + apps/api RolesGuard).
export default async function PhishingTemplatesPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const result = await fetchJson<PhishingTemplate[]>(`${API_URL}/phishing/templates`, {
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
      <PageContainer size={1280}>
        <PageHeader
          title="Szablony symulacji phishingowych"
          actions={
            <Link href="/dashboard/phishing/campaigns" className={buttonClasses('secondary')}>
              Kampanie
            </Link>
          }
        />
        {result.ok ? (
          <TemplatesList initialTemplates={result.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować szablonów. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </PageContainer>
    </div>
  );
}
