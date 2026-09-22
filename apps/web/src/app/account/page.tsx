import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import AvatarSettings from './_components/AvatarSettings';

// Ustawienia KONTA (każda zalogowana rola - middleware.ts), w odróżnieniu od
// /dashboard/settings, czyli ustawień ORGANIZACJI dla ORG_ADMIN-a. Dziś jedna
// sekcja (avatar), kolejne dokładamy tutaj (D-066).
export default async function AccountPage() {
  // middleware.ts już przekierował niezalogowanego - to dodatkowe
  // zabezpieczenie, nie główna linia obrony (patrz middleware.ts).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }

  const payload = decodeJwtPayload(accessToken);
  const avatarResult = await fetchJson<{ avatarUrl: string | null }>(`${API_URL}/users/me/avatar`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!avatarResult.ok && avatarResult.status === 401) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={payload?.email ?? null} role={payload?.role} />
      <main className="mx-auto max-w-3xl px-6 pb-12 pt-9">
        <PageHeader title="Ustawienia konta" subtitle="Ustawienia Twojego konta w Unfooly." />
        {/* Błąd pobrania (5xx, awaria sieci) nie blokuje ekranu: sekcja startuje bez
            zaznaczonego presetu, a zapis i tak przechodzi przez API. */}
        <AvatarSettings initialAvatarUrl={avatarResult.ok ? avatarResult.data.avatarUrl : null} />
      </main>
    </div>
  );
}
