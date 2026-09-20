import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Role } from '@cyberszkolo/shared';
import Topbar from '@/components/Topbar';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import { isSafeId } from '@/lib/safe-id';
import ReportDetail from '../_components/ReportDetail';

export const metadata = { title: 'Zgłoszenie' };

// Szczegóły zgłoszenia: wyłącznie ORG_ADMIN (kierownik działu nie widzi treści, zgłaszającego ani notatek).
export default function ReportDetailPage({ params }: { params: { id: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);
  if (payload?.role !== Role.ORG_ADMIN) {
    redirect('/reports');
  }
  if (!isSafeId(params.id)) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={payload.email ?? null} role={payload.role} />
      <main className="mx-auto max-w-[900px] px-6 pb-12 pt-9 sm:px-10">
        <ReportDetail id={params.id} />
      </main>
    </div>
  );
}
