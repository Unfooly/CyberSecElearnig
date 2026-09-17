import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DashboardPage from './page';

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
        .mockResolvedValueOnce({ ok: true, json: async () => departmentsResponse }),
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(
      screen.getAllByText('Brak danych - moduł symulacji jeszcze nie wdrożony'),
    ).toHaveLength(2);
    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('pokazuje "Brak danych" dla completionRate=null zamiast 0%', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...overviewResponse, completionRate: null }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => [] }),
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText('Brak danych do wyświetlenia.')).toBeInTheDocument();
    const brakDanychNodes = screen.getAllByText('Brak danych');
    expect(brakDanychNodes.length).toBeGreaterThan(0);
  });
});
