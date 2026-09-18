import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { GET as getUsersStatus } from './users-status/route';
import { GET as getExport } from './export/route';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('BFF /api/dashboard/*', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('users-status: 401 bez cookie i bez wywołania backendu', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await getUsersStatus(new NextRequest('http://localhost/api/dashboard/users-status'));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('users-status: przekazuje query i Bearer do backendu', async () => {
    mockCookie('tok');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getUsersStatus(new NextRequest('http://localhost/api/dashboard/users-status?page=2&search=jan'));

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/dashboard/users-status?page=2&search=jan');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('users-status: 502 przy awarii sieci', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await getUsersStatus(new NextRequest('http://localhost/api/dashboard/users-status'))).status).toBe(502);
  });

  it('export: 401 bez cookie', async () => {
    mockCookie(undefined);
    expect((await getExport()).status).toBe(401);
  });

  it('export: przekazuje CSV i Content-Disposition z backendu', async () => {
    mockCookie('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'a,b\n1,2\n',
        headers: new Headers({
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="raport-organizacja.csv"',
        }),
      }),
    );

    const response = await getExport();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('raport-organizacja.csv');
    expect(await response.text()).toBe('a,b\n1,2\n');
  });

  it('export: przekazuje błąd backendu (np. 403) zamiast pliku', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'no' }) }));

    expect((await getExport()).status).toBe(403);
  });
});
