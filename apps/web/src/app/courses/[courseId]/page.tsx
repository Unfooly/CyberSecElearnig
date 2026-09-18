import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { CourseAssignmentSummary, CourseDetail } from '@/lib/courses-types';
import Topbar from '@/components/Topbar';
import CoursePlayer from './_components/CoursePlayer';

export default async function CoursePlayerPage({ params }: { params: { courseId: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  // /start jest wołane raz, server-side, przy renderze strony - tak jak
  // reszta zapytań w apps/web (patrz dashboard/page.tsx). Idempotentne po
  // stronie backendu (tylko NOT_STARTED -> IN_PROGRESS), więc bezpieczne
  // przy każdym wejściu/odświeżeniu strony.
  const startResult = await fetchJson<CourseDetail>(
    `${API_URL}/courses/${encodeURIComponent(params.courseId)}/start`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
  );

  if (!startResult.ok && startResult.status === 401) {
    redirect('/login');
  }
  if (!startResult.ok && startResult.status === 404) {
    notFound();
  }
  if (!startResult.ok) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Topbar userEmail={userEmail} />
        <main className="mx-auto max-w-7xl p-8">
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            Nie udało się załadować kursu. Spróbuj odświeżyć stronę za chwilę.
          </p>
        </main>
      </div>
    );
  }

  const course = startResult.data;

  // CourseDetailDto (odpowiedź /start) nie zawiera score - potrzebny tylko
  // dla kursu już ukończonego wcześniej (świeżo ukończony dostaje score
  // wprost z odpowiedzi /progress w CoursePlayer). Jedno dodatkowe
  // zapytanie do JUŻ ISTNIEJĄCEGO endpointu, nie nowy wzorzec komunikacji.
  let score: number | null = null;
  // Odróżnia "kurs naprawdę nie miał ocenianych bloków" (score=null to
  // poprawna odpowiedź) od "nie udało się pobrać wyniku" (score=null byłoby
  // mylące - SummaryScreen pokazałby fałszywe "ten kurs nie miał pytań").
  let scoreUnavailable = false;
  if (course.status === 'COMPLETED') {
    const myCoursesResult = await fetchJson<CourseAssignmentSummary[]>(`${API_URL}/courses/my`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!myCoursesResult.ok && myCoursesResult.status === 401) {
      redirect('/login');
    }
    if (myCoursesResult.ok) {
      score = myCoursesResult.data.find((c) => c.courseId === course.courseId)?.score ?? null;
    } else {
      scoreUnavailable = true;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Topbar userEmail={userEmail} />
      <main className="mx-auto max-w-7xl p-8">
        <CoursePlayer
          courseId={params.courseId}
          initial={{ ...course, score }}
          scoreUnavailable={scoreUnavailable}
        />
      </main>
    </div>
  );
}
