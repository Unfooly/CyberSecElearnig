import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { Badge } from '@/lib/gamification-types';
import Topbar from '@/components/Topbar';
import BadgeGrid from './_components/BadgeGrid';

export default async function AchievementsPage() {
  // middleware.ts już przekierował niezalogowanego - to dodatkowe
  // zabezpieczenie, nie główna linia obrony (ten sam wzorzec co
  // courses/page.tsx).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const result = await fetchJson<Badge[]>(`${API_URL}/gamification/badges`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!result.ok && result.status === 401) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-7xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Osiągnięcia</h1>
          <Link href="/courses" className="text-sm font-medium text-slate-600 hover:underline">
            ← Wróć do kursów
          </Link>
        </div>

        {result.ok ? (
          <BadgeGrid badges={result.data} />
        ) : (
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            Nie udało się załadować odznak. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
