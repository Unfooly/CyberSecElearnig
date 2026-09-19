import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DashboardPage from './page';

vi.mock('./_components/UsersComplianceTable', () => ({
  default: () => <div data-testid="users-compliance-table" />,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // next/navigation.redirect() w prawdziwym Next.js przerywa render
    // rzucając specjalny błąd - odtwarzamy to w teście, żeby dało się
    // asercjonować "przekierowało i nic więcej się nie wykonało".
    throw new Error(`REDIRECT:${url}`);
  }),
  // DashboardPage renderuje <Sidebar>, który woła usePathname() - potrzebny
  // minimalny mock, żeby render się nie wywalił.
  usePathname: () => '/dashboard',
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

const overviewResponse = {
  completionRate: 50,
  activeUsers: { count: 2, total: 4 },
  overdueCount: 1,
  phishingClickRate: null,
  phishingReportRate: null,
};

const departmentsResponse = [
  { departmentId: 'd1', departmentName: 'IT', completionRate: 80, mandatoryTotal: 5, mandatoryCompleted: 4 },
];

const trendsResponse = [
  { month: '2026-09', completionRate: 60, mandatoryTotal: 5, mandatoryCompleted: 3 },
];

describe('DashboardPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('403 z guarda organizacji PENDING => /onboarding (stan potwierdzony w /organization/me)', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/organization/me')
          ? { ok: true, status: 200, json: async () => ({ status: 'PENDING_DOMAIN_VERIFICATION' }) }
          : { ok: false, status: 403, json: async () => ({ code: 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION' }) },
      ),
    );

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('403 z innego powodu (organizacja ACTIVE) NIE przekierowuje na onboarding', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/organization/me')
          ? { ok: true, status: 200, json: async () => ({ status: 'ACTIVE' }) }
          : { ok: false, status: 403, json: async () => ({}) },
      ),
    );

    render(await DashboardPage());

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('przekierowuje do /login, gdy API zwraca 401 (token faktycznie nieważny)', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('pokazuje komunikat błędu (nie przekierowuje) przy awarii sieci/API', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const jsx = await DashboardPage();
    render(jsx);

    expect(
      screen.getByText(/nie udało się załadować danych dashboardu/i),
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('pokazuje komunikat błędu przy 500 z backendu, nie myli tego z wylogowaniem', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText(/nie udało się załadować/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renderuje realne dane z API, w tym placeholdery dla metryk phishingowych', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => overviewResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => departmentsResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => trendsResponse }),
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getAllByText('50').length).toBeGreaterThan(0);
    expect(screen.getByText('/ 4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pobierz raport CSV' })).toHaveAttribute('href', '/api/dashboard/export');
    expect(screen.getAllByText('Moduł wkrótce')).toHaveLength(2);
    expect(screen.getAllByText('Pojawi się po pierwszej kampanii')).toHaveLength(2);
    expect(screen.getAllByText('IT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
    expect(screen.getByText(/Stan organizacji na dziś/)).toBeInTheDocument();
  });

  it('pokazuje placeholder (nie 0%) dla completionRate=null i EmptyState dla pustych działów', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...overviewResponse, completionRate: null }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: true, json: async () => [] }),
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByRole('heading', { name: 'Brak działów do porównania' })).toBeInTheDocument();
    expect(screen.getByText(/Pojawi się po pierwszym przypisaniu obowiązkowego kursu/)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
