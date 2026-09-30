import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { decodeJwtPayload } from '@/lib/jwt';
import type { CourseAssignmentSummary, CourseDetail } from '@/lib/courses-types';
import Topbar from '@/components/Topbar';
import CoursePlayer from './_components/CoursePlayer';
import { redirectIfPending } from '@/lib/organization';
import { contentAssetBase } from '@/lib/content-assets';
import { nextUnfinishedCourse } from '@/lib/next-course';

export default async function CoursePlayerPage({ params }: { params: { courseId: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }
  const payload = decodeJwtPayload(accessToken);
  const userEmail = payload?.email ?? null;

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
  if (!startResult.ok && startResult.status === 403) {
    await redirectIfPending(accessToken);
  }
  if (!startResult.ok && startResult.status === 404) {
    notFound();
  }
  if (!startResult.ok) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Topbar userEmail={userEmail} role={payload?.role} />
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
  // mylące - ekran zamknięcia sprawy pokazałby fałszywe "ten kurs nie miał pytań").
  let scoreUnavailable = false;
  // Lista przypisań także dla kursu w toku (D-130): „Następna sprawa” na ekranie zamknięcia prowadzi do następnego nieukończonego kursu.
  // Błąd odczytu nie blokuje kursu - wtedy „Następna sprawa · wkrótce” jak dotąd.
  const myCoursesResult = await fetchJson<CourseAssignmentSummary[]>(`${API_URL}/courses/my`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!myCoursesResult.ok && myCoursesResult.status === 401) {
    redirect('/login');
  }
  if (course.status === 'COMPLETED') {
    if (myCoursesResult.ok) {
      score = myCoursesResult.data.find((c) => c.courseId === course.courseId)?.score ?? null;
    } else {
      scoreUnavailable = true;
    }
  }
  const nextCourse = myCoursesResult.ok && Array.isArray(myCoursesResult.data) ? nextUnfinishedCourse(myCoursesResult.data, course.courseId) : null;

  // Ustawienie lektora z konta (users.narrationEnabled). Błąd odczytu nie blokuje kursu: domyślnie lektor włączony.
  // Dla kursu już ukończonego pokazujemy tylko podsumowanie (bez odtwarzacza), więc preferencji nie pobieramy.
  // „Bez limitów czasu” (D-124): rozmowa na żywo bez limitu i bez przełącznika; błąd odczytu - przełącznik z limitem (serwer i tak stosuje
  // ustawienie z konta przy ocenie - B-137).
  let narrationEnabled = true;
  let noTimeLimits = false;
  if (course.status !== 'COMPLETED') {
    const preferencesResult = await fetchJson<{ narrationEnabled: boolean; noTimeLimits?: boolean }>(`${API_URL}/users/me/preferences`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    narrationEnabled = preferencesResult.ok ? preferencesResult.data.narrationEnabled !== false : true;
    noTimeLimits = preferencesResult.ok && preferencesResult.data.noTimeLimits === true;
  }
  // Baza adresów zasobów modułu (ilustracje, audio): CONTENT_BASE_URL z env albo lokalny /content; ta sama walidacja co w CSP.
  const contentBase = contentAssetBase(process.env.CONTENT_BASE_URL, process.env.NODE_ENV === 'development');

  return (
    // Trasa odtwarzacza BEZ Topbara (feat/player-stage) - PlayerStage (w CoursePlayer) jest całym chromem strony,
    // z własnym wyjściem (X), postępem i pełnym ekranem. h-dvh + overflow-hidden: strona nigdy się nie przewija,
    // tylko obszar treści WEWNĄTRZ ramki (PlayerStage pilnuje tego sam).
    <div className="h-dvh overflow-hidden bg-paper">
      <CoursePlayer
        // key = assignmentId: po "Rozpocznij od nowa" (D-069) to jest NOWE przypisanie (inny id) - wymuszony
        // remount resetuje CAŁY wewnętrzny stan klienta (notatki, dowody, podpowiedzi, feedback), zamiast
        // pozostawiać go z poprzedniego, ukończonego przebiegu po samym router.refresh().
        key={course.assignmentId}
        courseId={params.courseId}
        initial={{ ...course, score }}
        scoreUnavailable={scoreUnavailable}
        narrationEnabled={narrationEnabled}
        noTimeLimits={noTimeLimits}
        contentBase={contentBase}
        // Avatar gracza w dymkach DIALOGUE (fix/dialogue-polish, useMyAvatar) - z tego samego JWT co Topbar.tsx.
        userEmail={userEmail}
        nextCourse={nextCourse}
      />
    </div>
  );
}
