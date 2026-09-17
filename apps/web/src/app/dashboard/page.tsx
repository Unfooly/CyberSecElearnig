import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import Sidebar from '@/components/Sidebar';
import KpiCard from './_components/KpiCard';
import DepartmentsTable, { type DepartmentRow } from './_components/DepartmentsTable';

interface OverviewData {
  completionRate: number | null;
  activeUsers: { count: number; total: number };
  overdueCount: number;
  phishingClickRate: null;
  phishingReportRate: null;
}

const PHISHING_PLACEHOLDER = 'Brak danych - moduł symulacji jeszcze nie wdrożony';

function fetchFromApi<T>(path: string, accessToken: string) {
  return fetchJson<T>(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Dashboard ma zawsze pokazywać świeże liczby, nigdy cache Next.js.
    cache: 'no-store',
  });
}

export default async function DashboardPage() {
  // middleware.ts już przekierował niezalogowanego usera / usera bez roli
  // ORG_ADMIN - to jest dodatkowe zabezpieczenie na wypadek gdyby cookie
  // zniknęło między middleware a renderem, nie główna linia obrony.
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    redirect('/login');
  }

  const [overviewResult, departmentsResult] = await Promise.all([
    fetchFromApi<OverviewData>('/dashboard/overview', accessToken),
    fetchFromApi<DepartmentRow[]>('/dashboard/departments', accessToken),
  ]);

  // 401 = token rzeczywiście nieważny (np. odrzucony mimo że middleware go
  // odświeżył) - to jest prawdziwe "musisz się zalogować ponownie".
  const isUnauthorized =
    (!overviewResult.ok && overviewResult.status === 401) ||
    (!departmentsResult.ok && departmentsResult.status === 401);
  if (isUnauthorized) {
    redirect('/login');
  }

  // Każdy inny błąd (5xx, sieć, backend nieosiągalny) to awaria API, nie
  // wylogowanie - pokazujemy komunikat zamiast cichego redirectu do /login,
  // który myliłby admina co do przyczyny.
  if (!overviewResult.ok || !departmentsResult.ok) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 p-8">
          <h1 className="mb-6 text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Nie udało się załadować danych dashboardu. Spróbuj odświeżyć stronę za chwilę.
          </p>
        </main>
      </div>
    );
  }

  const overview = overviewResult.data;
  const departments = departmentsResult.data;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Dashboard</h1>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Ukończenie szkoleń obowiązkowych"
            value={overview.completionRate !== null ? `${overview.completionRate}%` : 'Brak danych'}
          />
          <KpiCard
            label="Aktywni użytkownicy"
            value={`${overview.activeUsers.count} / ${overview.activeUsers.total}`}
          />
          <KpiCard label="Zaległe szkolenia" value={String(overview.overdueCount)} />
          <KpiCard label="Klikalność phishingowa" value={PHISHING_PLACEHOLDER} muted />
          <KpiCard label="Zgłaszalność phishingowa" value={PHISHING_PLACEHOLDER} muted />
        </div>

        <DepartmentsTable rows={departments} />
      </main>
    </div>
  );
}
