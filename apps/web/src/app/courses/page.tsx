import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import type { GamificationOverview, LeaderboardEntry } from '@/lib/gamification-types';
import Topbar from '@/components/Topbar';
import CourseLibrary from './_components/CourseLibrary';
import CourseCarousel from './_components/CourseCarousel';
import UserGamificationCard from './_components/UserGamificationCard';
import WelcomeBanner from './_components/WelcomeBanner';
import DidYouKnowWidget from './_components/DidYouKnowWidget';
import LeaderboardTable from './_components/LeaderboardTable';

export default async function CoursesPage() {
  // middleware.ts już przekierował niezalogowanego - to dodatkowe
  // zabezpieczenie, nie główna linia obrony (patrz middleware.ts).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }

  const payload = decodeJwtPayload(accessToken);
  const userEmail = payload?.email ?? null;
  // Wyłącznie do podświetlenia "to Ty" w LeaderboardTable - front NIE
  // weryfikuje podpisu (to nie jest linia obrony), tylko odczytuje `sub`,
  // dokładnie jak middleware.ts.
  const currentUserId = payload?.sub ?? null;

  const [coursesResult, gamificationResult, leaderboardResult] = await Promise.all([
    fetchJson<CourseAssignmentSummary[]>(`${API_URL}/courses/my`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
    fetchJson<GamificationOverview>(`${API_URL}/users/me/gamification`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
    fetchJson<LeaderboardEntry[]>(`${API_URL}/gamification/leaderboard`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
  ]);

  if (!coursesResult.ok && coursesResult.status === 401) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-7xl p-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            {coursesResult.ok && <WelcomeBanner courses={coursesResult.data} userEmail={userEmail} />}
            {gamificationResult.ok && <UserGamificationCard overview={gamificationResult.data} />}
            <DidYouKnowWidget />
          </div>

          <div className="space-y-10">
            <section>
              <h1 className="mb-4 text-2xl font-bold text-slate-900">Twoja ścieżka nauki</h1>
              {coursesResult.ok ? (
                <CourseCarousel courses={coursesResult.data} />
              ) : (
                <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                  Nie udało się załadować listy kursów. Spróbuj odświeżyć stronę za chwilę.
                </p>
              )}
            </section>

            {coursesResult.ok && <CourseLibrary courses={coursesResult.data} />}

            {leaderboardResult.ok && currentUserId && (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-lg font-bold text-slate-900">Ranking organizacji</h2>
                <LeaderboardTable entries={leaderboardResult.data} currentUserId={currentUserId} />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
