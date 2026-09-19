import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { GET as getMe } from './me/route';
import { POST as postCheck } from './domain/check/route';
import { PATCH as patchSettings } from './settings/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

// Domyślnie żądanie z naszej własnej strony (Origin = host aplikacji).
function mockHeaders(values: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(headers).mockReturnValue({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  } as unknown as ReturnType<typeof headers>);
}

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/organization/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BFF /api/organization/*', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => mockHeaders());

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  describe('ochrona CSRF na trasach zmieniających stan (POST/PATCH)', () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ['POST /domain/check', () => postCheck()],
      ['PATCH /settings', () => patchSettings(patchRequest({ selfJoinEnabled: true }))],
    ];

    it.each(cases)('%s: Origin z obcej domeny => 403 bez wołania API', async (_name, call) => {
      mockCookie('tok');
      mockHeaders({ origin: 'https://evil.example.com', host: 'localhost:3000' });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      expect((await call()).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(cases)('%s: sąsiednia subdomena (ta sama domena rejestrowalna) => 403', async (_name, call) => {
      mockCookie('tok');
      mockHeaders({ origin: 'https://landing.unfooly.test', host: 'app.unfooly.test' });
      vi.stubGlobal('fetch', vi.fn());

      expect((await call()).status).toBe(403);
    });

    it.each(cases)('%s: brak Origin i Sec-Fetch-Site => 403 (fail-closed)', async (_name, call) => {
      mockCookie('tok');
      mockHeaders({ host: 'localhost:3000' });
      vi.stubGlobal('fetch', vi.fn());

      expect((await call()).status).toBe(403);
    });

    it.each(cases)('%s: Sec-Fetch-Site same-origin bez Origin => przepuszcza', async (_name, call) => {
      mockCookie('tok');
      mockHeaders({ 'sec-fetch-site': 'same-origin', host: 'localhost:3000' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) }));

      expect((await call()).status).toBe(200);
    });

    it.each(cases)('%s: za proxy używa x-forwarded-host', async (_name, call) => {
      mockCookie('tok');
      mockHeaders({ origin: 'https://app.unfooly.test', host: 'web:3000', 'x-forwarded-host': 'app.unfooly.test' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) }));

      expect((await call()).status).toBe(200);
    });

    it('GET /me nie wymaga Origin (odczyt)', async () => {
      mockCookie('tok');
      mockHeaders({});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) }));

      expect((await getMe()).status).toBe(200);
    });
  });

  describe.each([
    ['GET /me', () => getMe()],
    ['POST /domain/check', () => postCheck()],
    ['PATCH /settings', () => patchSettings(patchRequest({ selfJoinEnabled: true }))],
  ])('%s', (_name, call) => {
    it('bez cookie access_token: 401 i bez wołania backendu', async () => {
      mockCookie(undefined);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await call();

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('backend nieosiągalny: 502 z komunikatem', async () => {
      mockCookie('tok');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));

      const response = await call();

      expect(response.status).toBe(502);
    });
  });

  it('GET /me: woła STAŁĄ ścieżkę API z tokenem z cookie i przekazuje ciało 1:1', async () => {
    mockCookie('tok');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: 'ACTIVE' }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getMe();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/organization/me`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
    expect(await response.json()).toEqual({ status: 'ACTIVE' });
  });

  it('POST /domain/check: bez ciała żądania (domenę zna tylko API), kody błędów przechodzą 1:1', async () => {
    mockCookie('tok');
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 400, json: async () => ({ code: 'DOMAIN_VERIFICATION_FAILED', message: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await postCheck();

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('DOMAIN_VERIFICATION_FAILED');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/organization/domain/check`);
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('POST /domain/check: 429 (cooldown) przechodzi do UI', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, json: async () => ({ code: 'DOMAIN_CHECK_TOO_FREQUENT' }) }));

    expect((await postCheck()).status).toBe(429);
  });

  describe('PATCH /settings - allowlista pól', () => {
    it('przekazuje TYLKO selfJoinEnabled: status, name i inne klucze z żądania nie docierają do API', async () => {
      mockCookie('tok');
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ selfJoinEnabled: true }) });
      vi.stubGlobal('fetch', fetchMock);

      await patchSettings(patchRequest({ selfJoinEnabled: true, status: 'ACTIVE', name: 'X', organizationId: 'inna' }));

      expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/organization/settings`);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ selfJoinEnabled: true });
    });

    it.each([{}, { selfJoinEnabled: 'true' }, { selfJoinEnabled: 1 }, null])('nieprawidłowe ciało %j => 400 bez wołania API', async (body) => {
      mockCookie('tok');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await patchSettings(patchRequest(body));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('błąd biznesowy API (DOMAIN_NOT_VERIFIED) przechodzi z kodem', async () => {
      mockCookie('tok');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400, json: async () => ({ code: 'DOMAIN_NOT_VERIFIED', message: 'm' }) }));

      const response = await patchSettings(patchRequest({ selfJoinEnabled: true }));

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('DOMAIN_NOT_VERIFIED');
    });
  });
});
