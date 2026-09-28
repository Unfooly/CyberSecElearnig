import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { Badge } from '@/lib/gamification-types';
import Topbar from '@/components/Topbar';
import AchievementsProfile from './_components/AchievementsProfile';
import { redirectIfPending } from '@/lib/organization';

/** „Anna N.” z imienia i inicjału nazwiska własnego konta (GET /users/me/display-name); bez imienia - brak linii w nagłówku. */
function displayNameOf(data: unknown): string | null {
  const record = (data ?? {}) as { firstName?: unknown; lastInitial?: unknown };
  if (typeof record.firstName !== 'string' || record.firstName.length === 0) return null;
  return typeof record.lastInitial === 'string' && record.lastInitial.length > 0 ? `${record.firstName} ${record.lastInitial}.` : record.firstName;
}

export default async function AchievementsPage() {
  // middleware.ts już przekierował niezalogowanego - to dodatkowe
  // zabezpieczenie, nie główna linia obrony (ten sam wzorzec co
  // courses/page.tsx).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);
  const userEmail = payload?.email ?? null;

  const [result, nameResult] = await Promise.all([
    fetchJson<Badge[]>(`${API_URL}/gamification/badges`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
    fetchJson<unknown>(`${API_URL}/users/me/display-name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
  ]);

  if (!result.ok && result.status === 401) {
    redirect('/login');
  }
  if (!result.ok && result.status === 403) {
    await redirectIfPending(accessToken);
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <Topbar userEmail={userEmail} role={payload?.role} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:p-8">
        <Link href="/courses" className="mb-4 inline-block text-sm font-medium text-slate-600 hover:underline">
          ← Wróć do kursów
        </Link>

        {result.ok && Array.isArray(result.data) ? (
          <AchievementsProfile badges={result.data} displayName={nameResult.ok ? displayNameOf(nameResult.data) : null} />
        ) : (
          <>
            <h1 className="mb-6 text-2xl font-semibold text-slate-900">Osiągnięcia</h1>
            <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
              Nie udało się załadować osiągnięć. Spróbuj odświeżyć stronę za chwilę.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
