import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import Topbar from '@/components/Topbar';
import PageContainer from '@/components/ui/PageContainer';
import UsersPageClient from './_components/UsersPageClient';

export default function UsersPage() {
  // middleware.ts już przekierował niezalogowanego usera / usera bez roli
  // ORG_ADMIN - to jest dodatkowe zabezpieczenie na wypadek gdyby cookie
  // zniknęło między middleware a renderem, nie główna linia obrony (ten sam
  // wzorzec co apps/web/src/app/dashboard/page.tsx).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  return (
    <div className="min-h-dvh bg-paper">
      <Topbar userEmail={userEmail} />
      <PageContainer size={1280}>
        <UsersPageClient />
      </PageContainer>
    </div>
  );
}
