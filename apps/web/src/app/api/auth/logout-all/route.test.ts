import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cookies, headers } from 'next/headers';
import { POST } from './route';
import { API_URL } from '@/lib/config';

const setCookieMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockRequest(headerValues: Record<string, string>, accessToken?: string) {
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
  vi.mocked(cookies).mockReturnValue({
    set: setCookieMock,
    get: (name: string) => (name === 'access_token' && accessToken ? { name, value: accessToken } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

const SAME_ORIGIN = { origin: 'http://localhost:3000', host: 'localhost:3000' };

describe('POST /api/auth/logout-all', () => {
  beforeEach(() => setCookieMock.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('woła STAŁĄ ścieżkę API z tokenem z cookie, a po sukcesie czyści cookies tej przeglądarki', async () => {
    mockRequest(SAME_ORIGIN, 'acc-1');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/auth/logout-all`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer acc-1' }) }),
    );
    expect(setCookieMock).toHaveBeenCalledWith('refresh_token', '', expect.objectContaining({ maxAge: 0 }));
  });

  it('błąd API (np. 401): cookies NIE są czyszczone, status przechodzi', async () => {
    mockRequest(SAME_ORIGIN, 'acc-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({ code: 'SESSION_REVOKED' }) }));

    const response = await POST();

    expect(response.status).toBe(401);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('obcy Origin: 403 bez wołania API; brak cookie access_token: 401', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    mockRequest({ origin: 'https://evil.example.com', host: 'localhost:3000' }, 'acc-1');
    expect((await POST()).status).toBe(403);

    mockRequest(SAME_ORIGIN, undefined);
    expect((await POST()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
