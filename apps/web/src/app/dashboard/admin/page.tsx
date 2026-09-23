import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { AssignableOrganization, Reseller } from '@/lib/reseller-types';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import ResellersPanel from './_components/ResellersPanel';

// Panel operatora platformy (SUPER_ADMIN - middleware.ts i RolesGuard w apps/api): partnerzy
// i przypisywanie im organizacji klienckich (D-070). Klient nie może tego zmienić sam.
export default async function AdminPanelPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);

  const init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' as const };
  const [resellersResult, organizationsResult] = await Promise.all([
    fetchJson<Reseller[]>(`${API_URL}/resellers`, init),
    fetchJson<AssignableOrganization[]>(`${API_URL}/resellers/assignable-organizations`, init),
  ]);

  if (!resellersResult.ok && resellersResult.status === 401) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={payload?.email ?? null} role={payload?.role} />
      <main className="mx-auto max-w-[1100px] px-6 pb-12 pt-9">
        <PageHeader
          title="Panel operatora"
          subtitle="Partnerzy (resellerzy) i przypisanie im organizacji klienckich."
        />
        {resellersResult.ok && organizationsResult.ok ? (
          <ResellersPanel
            initialResellers={resellersResult.data}
            initialOrganizations={organizationsResult.data}
          />
        ) : (
          <Card className="p-6">
            <p role="alert" className="text-sm font-semibold text-danger">
              Nie udało się załadować danych panelu. Odśwież stronę.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}
