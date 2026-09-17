import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import Sidebar from '@/components/Sidebar';
import CourseLibrary from './_components/CourseLibrary';

export default async function CoursesPage() {
  // middleware.ts już przekierował niezalogowanego - to dodatkowe
  // zabezpieczenie, nie główna linia obrony (patrz middleware.ts).
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }

  const result = await fetchJson<CourseAssignmentSummary[]>(`${API_URL}/courses/my`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!result.ok && result.status === 401) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 p-8">
        {result.ok ? (
          <CourseLibrary courses={result.data} />
        ) : (
          <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Nie udało się załadować listy kursów. Spróbuj odświeżyć stronę za chwilę.
          </p>
        )}
      </main>
    </div>
  );
}
