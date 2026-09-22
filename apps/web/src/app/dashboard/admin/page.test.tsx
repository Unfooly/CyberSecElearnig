import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AdminPanelPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(() => new Headers()),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/dashboard/admin',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

/** Kolejność odpowiedzi jak w page.tsx: najpierw /resellers, potem /resellers/assignable-organizations. */
function mockApi(resellers: unknown, organizations: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) =>
      String(url).includes('assignable-organizations')
        ? { ok: true, json: async () => organizations }
        : { ok: true, json: async () => resellers },
    ),
  );
}

describe('AdminPanelPage (panel operatora)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login bez cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(AdminPanelPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('pokazuje partnerów i organizacje klienckie', async () => {
    mockCookieValue('token');
    mockApi(
      [{ id: 'res-1', name: 'IT Partner', createdAt: '2026-09-22T10:00:00.000Z', clientCount: 2 }],
      [{ id: 'org-1', name: 'Klient', status: 'ACTIVE', resellerId: 'res-1', resellerName: 'IT Partner' }],
    );

    render(await AdminPanelPage());

    expect(screen.getByRole('heading', { name: 'Panel operatora', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('IT Partner').length).toBeGreaterThan(0);
    expect(screen.getByText('Klient')).toBeInTheDocument();
  });

  it('401 z API => /login', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(AdminPanelPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('awaria API pokazuje komunikat zamiast pustego panelu', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(await AdminPanelPage());

    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się załadować danych panelu.');
  });
});
