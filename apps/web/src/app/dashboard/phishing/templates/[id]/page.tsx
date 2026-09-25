import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import { redirectIfPending } from '@/lib/organization';
import type { PhishingTemplate, PhishingTemplateEdit } from '@/lib/phishing-types';
import { isSafeId } from '@/lib/safe-id';
import Topbar from '@/components/Topbar';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import TemplateEditor from '../_components/TemplateEditor';

export default async function PhishingTemplatePage({ params }: { params: { id: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  if (!isSafeId(params.id)) {
    notFound();
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;
  const init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' as const };

  const [templateResult, editsResult] = await Promise.all([
    fetchJson<PhishingTemplate>(`${API_URL}/phishing/templates/${params.id}`, init),
    fetchJson<PhishingTemplateEdit[]>(`${API_URL}/phishing/templates/edits?templateId=${encodeURIComponent(params.id)}`, init),
  ]);
  if (!templateResult.ok && templateResult.status === 401) {
    redirect('/login');
  }
  if (!templateResult.ok && templateResult.status === 403) {
    await redirectIfPending(accessToken);
  }
  if (!templateResult.ok && templateResult.status === 404) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} />
      <PageContainer size={1280}>
        <PageHeader title={templateResult.ok ? templateResult.data.name : 'Szablon'} />
        {templateResult.ok ? (
          <TemplateEditor template={templateResult.data} edits={editsResult.ok ? editsResult.data : []} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować szablonu. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </PageContainer>
    </div>
  );
}
