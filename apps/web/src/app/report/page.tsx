import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Topbar from '@/components/Topbar';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import ReportForm from './_components/ReportForm';

export const metadata = { title: 'Zgłoś podejrzaną wiadomość' };

// Dostępne dla każdej zalogowanej roli (middleware.ts to tylko UX; dostęp i limity egzekwuje apps/api).
export default function ReportPage() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={payload?.email ?? null} role={payload?.role} />
      <main className="mx-auto max-w-[760px] px-6 pb-12 pt-9 sm:px-10">
        <PageHeader title="Zgłoś podejrzaną wiadomość" subtitle="Dostałeś/-aś e-mail, który wygląda podejrzanie? Zgłoś go - to najlepsze, co możesz zrobić." />
        <ReportForm />
      </main>
    </div>
  );
}
