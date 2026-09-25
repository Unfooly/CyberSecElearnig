import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Role } from '@cyberszkolo/shared';
import PageHeader from '@/components/ui/PageHeader';
import Topbar from '@/components/Topbar';
import PageContainer from '@/components/ui/PageContainer';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import AdminInbox from './_components/AdminInbox';
import DepartmentInbox from './_components/DepartmentInbox';

export const metadata = { title: 'Zgłoszenia' };

// Skrzynka zgłoszeń: ORG_ADMIN (pełna lista, szczegóły, statusy, notatki) i DEPARTMENT_MANAGER (ograniczona lista własnego
// działu). middleware.ts i ten wybór widoku to tylko UX - role, zakres i dane egzekwuje apps/api.
export default function ReportsPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);
  if (payload?.role !== Role.ORG_ADMIN && payload?.role !== Role.DEPARTMENT_MANAGER) {
    redirect('/courses');
  }
  const isAdmin = payload.role === Role.ORG_ADMIN;

  return (
    <div className="min-h-dvh bg-paper">
      <Topbar userEmail={payload.email ?? null} role={payload.role} />
      <PageContainer size={1080}>
        <PageHeader
          title="Zgłoszenia podejrzanych wiadomości"
          subtitle={isAdmin ? 'Zgłoszenia pracowników do analizy. Zgłoszenia ćwiczebnych symulacji nie trafiają do tej listy.' : 'Zgłoszenia z Twojego działu (widok ograniczony).'}
        />
        {isAdmin ? <AdminInbox /> : <DepartmentInbox />}
      </PageContainer>
    </div>
  );
}
