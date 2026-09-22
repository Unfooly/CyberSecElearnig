import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { CourseAssignmentSummary, CourseCatalogItem } from '@/lib/courses-types';
import type { GamificationOverview, LeaderboardEntry } from '@/lib/gamification-types';
import Topbar from '@/components/Topbar';
import CourseLibrary from './_components/CourseLibrary';
import CourseCatalog from './_components/CourseCatalog';
import LearningPath from './_components/LearningPath';
import Card from '@/components/ui/Card';
import UserGamificationCard from './_components/UserGamificationCard';
import WelcomeBanner from './_components/WelcomeBanner';
import DidYouKnowWidget from './_components/DidYouKnowWidget';
import LeaderboardTable from './_components/LeaderboardTable';
import { redirectIfPending } from '@/lib/organization';

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

  const [coursesResult, catalogResult, gamificationResult, leaderboardResult] = await Promise.all([
    fetchJson<CourseAssignmentSummary[]>(`${API_URL}/courses/my`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
    fetchJson<CourseCatalogItem[]>(`${API_URL}/courses/catalog`, {
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
  // 403 z guarda organizacji PENDING => ekran weryfikacji domeny.
  if (!coursesResult.ok && coursesResult.status === 403) {
    await redirectIfPending(accessToken);
  }

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} role={payload?.role} />
      <main className="mx-auto max-w-[1280px] px-10 pb-12 pt-9">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            {coursesResult.ok && <WelcomeBanner courses={coursesResult.data} userEmail={userEmail} />}
            {gamificationResult.ok && <UserGamificationCard overview={gamificationResult.data} />}
            <DidYouKnowWidget />
          </div>

          <div className="space-y-7">
            <section>
              <h1 className="mb-3.5 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Twoja ścieżka nauki</h1>
              {coursesResult.ok ? (
                <LearningPath courses={coursesResult.data} />
              ) : (
                <p className="rounded-card border border-border bg-danger-soft p-4 text-sm font-semibold text-danger">
                  Nie udało się załadować listy kursów. Spróbuj odświeżyć stronę za chwilę.
                </p>
              )}
            </section>

            {coursesResult.ok && <CourseLibrary courses={coursesResult.data} />}

            {catalogResult.ok && <CourseCatalog courses={catalogResult.data} />}

            {leaderboardResult.ok && currentUserId && (
              <Card>
                <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
                  <h2 className="text-lg font-bold tracking-[-0.01em]">Ranking organizacji</h2>
                </div>
                <LeaderboardTable entries={leaderboardResult.data} currentUserId={currentUserId} />
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
