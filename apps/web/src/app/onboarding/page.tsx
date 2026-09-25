import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PendingHeader from '@/components/PendingHeader';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { fetchOrganization } from '@/lib/organization';
import OnboardingClient from './OnboardingClient';

// Strona startowa ORG_ADMIN-a organizacji PENDING. Stan czyta z API (jedyne
// źródło prawdy); middleware.ts wpuszcza tu tylko ORG_ADMIN. Organizacja
// ACTIVE nie ma tu nic do zrobienia - idzie do panelu.
export default async function OnboardingPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }

  const result = await fetchOrganization(accessToken);
  if (!result.ok && result.status === 401) {
    redirect('/login');
  }
  if (!result.ok && result.status === 403) {
    redirect('/courses');
  }
  if (result.ok && result.data.status === 'ACTIVE') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-dvh bg-paper">
      <PendingHeader />
      <main className="mx-auto max-w-3xl px-6 pb-12 pt-9">
        {result.ok ? (
          <OnboardingClient organization={result.data} />
        ) : (
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować stanu organizacji. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
