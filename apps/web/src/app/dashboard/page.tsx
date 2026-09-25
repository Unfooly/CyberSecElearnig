import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { fetchJson } from '@/lib/fetch-json';
import { formatDateLong } from '@/lib/datetime';
import { decodeJwtPayload } from '@/lib/jwt';
import Topbar from '@/components/Topbar';
import PageHeader from '@/components/ui/PageHeader';
import PageContainer from '@/components/ui/PageContainer';
import KpiCard from './_components/KpiCard';
import DepartmentsTable, { type DepartmentRow } from './_components/DepartmentsTable';
import CompletionTrendChart from './_components/CompletionTrendChart';
import DepartmentRiskChart from './_components/DepartmentRiskChart';
import UsersComplianceTable from './_components/UsersComplianceTable';
import ReportActions from './_components/ReportActions';
import { redirectIfPending } from '@/lib/organization';
import type { TrendPoint } from '@/lib/dashboard-types';

interface OverviewData {
  completionRate: number | null;
  activeUsers: { count: number; total: number };
  overdueCount: number;
  // % dostarczonych wiadomości symulacji z kliknięciem / wysłanym formularzem (90 dni, cała organizacja); null = brak
  // kampanii albo za mało danych (próg minimalnej liczebności 3 osoby).
  phishingClickRate: number | null;
  phishingSubmitRate?: number | null;
  // % dostarczonych wiadomości symulacji zgłoszonych przez adresata jako podejrzane (90 dni; ta sama liczebność i próg).
  phishingReportRate: number | null;
}

const PHISHING_NO_DATA = 'Brak kampanii z ostatnich 90 dni albo za mało danych (poniżej 3 osób)';

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
  const userEmail = decodeJwtPayload(accessToken)?.email ?? null;

  const [overviewResult, departmentsResult, trendsResult] = await Promise.all([
    fetchFromApi<OverviewData>('/dashboard/overview', accessToken),
    fetchFromApi<DepartmentRow[]>('/dashboard/departments', accessToken),
    fetchFromApi<TrendPoint[]>('/dashboard/stats/trends', accessToken),
  ]);

  // 401 = token rzeczywiście nieważny (np. odrzucony mimo że middleware go
  // odświeżył) - to jest prawdziwe "musisz się zalogować ponownie".
  const isUnauthorized =
    (!overviewResult.ok && overviewResult.status === 401) ||
    (!departmentsResult.ok && departmentsResult.status === 401) ||
    (!trendsResult.ok && trendsResult.status === 401);
  if (isUnauthorized) {
    redirect('/login');
  }
  // 403 z guarda organizacji PENDING => ekran weryfikacji domeny.
  if ((!overviewResult.ok && overviewResult.status === 403) || (!departmentsResult.ok && departmentsResult.status === 403)) {
    await redirectIfPending(accessToken);
  }

  // Każdy inny błąd (5xx, sieć, backend nieosiągalny) to awaria API, nie
  // wylogowanie - pokazujemy komunikat zamiast cichego redirectu do /login,
  // który myliłby admina co do przyczyny.
  if (!overviewResult.ok || !departmentsResult.ok) {
    return (
      <div className="min-h-screen bg-paper">
        <Topbar userEmail={userEmail} />
        <PageContainer size={1280}>
          <PageHeader title="Dashboard" />
          <p role="alert" className="rounded-card border border-border bg-danger-soft p-4 text-sm text-danger">
            Nie udało się załadować danych dashboardu. Spróbuj odświeżyć stronę za chwilę.
          </p>
        </PageContainer>
      </div>
    );
  }

  const overview = overviewResult.data;
  const departments = departmentsResult.data;
  // Trend jest dodatkiem - jego awaria nie powinna zasłaniać reszty
  // dashboardu, więc degradujemy do pustego wykresu.
  const trends = trendsResult.ok ? trendsResult.data : [];
  const departmentOptions = departments.flatMap((department) =>
    department.departmentId ? [{ id: department.departmentId, name: department.departmentName }] : [],
  );
  // "Dziś" wg strefy organizacji (nie strefy serwera): o północy UTC serwer bywa o dzień przed użytkownikiem.
  const today = formatDateLong(new Date());
  const activePercent =
    overview.activeUsers.total > 0 ? Math.round((overview.activeUsers.count / overview.activeUsers.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-paper">
      <Topbar userEmail={userEmail} />
      <PageContainer size={1280}>
        <PageHeader title="Dashboard" subtitle={`Stan organizacji na dziś, ${today}`} actions={<ReportActions />} />

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {overview.completionRate !== null ? (
            <KpiCard
              label="Ukończenie szkoleń obowiązkowych"
              value={String(overview.completionRate)}
              unit="%"
              progress={{ value: overview.completionRate }}
            />
          ) : (
            <KpiCard
              label="Ukończenie szkoleń obowiązkowych"
              value="Pojawi się po pierwszym przypisaniu obowiązkowego kursu"
              placeholderPill={null}
              placeholder
            />
          )}
          <KpiCard
            label="Aktywni użytkownicy"
            value={String(overview.activeUsers.count)}
            unit={`/ ${overview.activeUsers.total}`}
            progress={{ value: activePercent, tone: 'success' }}
          />
          <KpiCard label="Zaległe szkolenia" value={String(overview.overdueCount)} />
          {overview.phishingClickRate !== null ? (
            <KpiCard
              label="Podatność na phishing"
              value={String(overview.phishingClickRate)}
              unit="%"
              progress={{ value: overview.phishingClickRate, tone: overview.phishingClickRate > 15 ? 'warning' : 'success' }}
              hint={overview.phishingSubmitRate != null ? `Kliknęło w symulację; formularz wysłało ${overview.phishingSubmitRate}% (90 dni)` : 'Kliknęło w symulację (90 dni)'}
              hintTone={overview.phishingClickRate > 15 ? 'warn' : 'ok'}
            />
          ) : (
            <KpiCard label="Podatność na phishing" value={PHISHING_NO_DATA} placeholder placeholderPill={null} />
          )}
          {overview.phishingReportRate !== null ? (
            <KpiCard
              label="Zgłaszalność phishingowa"
              value={String(overview.phishingReportRate)}
              unit="%"
              progress={{ value: overview.phishingReportRate }}
              hint="Zgłosiło wiadomość symulacji jako podejrzaną (90 dni)"
            />
          ) : (
            <KpiCard label="Zgłaszalność phishingowa" value={PHISHING_NO_DATA} placeholder placeholderPill={null} />
          )}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompletionTrendChart points={trends} />
          <DepartmentRiskChart rows={departments} />
        </div>

        <div className="mb-6">
          <UsersComplianceTable departments={departmentOptions} />
        </div>

        <DepartmentsTable rows={departments} />
      </PageContainer>
    </div>
  );
}
