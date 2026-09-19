import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import { fetchOrganization } from '@/lib/organization';
import PendingHeader from '@/components/PendingHeader';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
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

  return (
    <div className="min-h-screen bg-paper">
      {isPending ? <PendingHeader /> : <Topbar userEmail={userEmail} />}
      <main className="mx-auto max-w-3xl px-6 pb-12 pt-9">
        <PageHeader title="Ustawienia organizacji" />
        {result.ok ? (
          <SettingsClient organization={result.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować ustawień. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
