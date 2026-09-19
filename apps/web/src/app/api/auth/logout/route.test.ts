import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cookies, headers } from 'next/headers';
import { POST } from './route';
import { API_URL } from '@/lib/config';

const setCookieMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockHeaders(values: Record<string, string>) {
  vi.mocked(headers).mockReturnValue({ get: (name: string) => values[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

function mockCookies(refreshToken?: string) {
  vi.mocked(cookies).mockReturnValue({
    set: setCookieMock,
    get: (name: string) => (name === 'refresh_token' && refreshToken ? { name, value: refreshToken } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

const SAME_ORIGIN = { origin: 'http://localhost:3000', host: 'localhost:3000' };

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    setCookieMock.mockClear();
    mockCookies('refresh-abc');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('z własnej strony: unieważnia sesję W API (refresh token z cookie) i czyści oba cookies', async () => {
    mockHeaders(SAME_ORIGIN);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sessionRevoked: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/auth/logout`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ refreshToken: 'refresh-abc' }) }),
    );
    expect(setCookieMock).toHaveBeenCalledWith('access_token', '', expect.objectContaining({ maxAge: 0, httpOnly: true }));
    expect(setCookieMock).toHaveBeenCalledWith('refresh_token', '', expect.objectContaining({ maxAge: 0, httpOnly: true }));
  });

  it('API niedostępne: cookies i tak są czyszczone (użytkownik wylogowany w przeglądarce), błąd tylko w logu', async () => {
    mockHeaders(SAME_ORIGIN);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));

    const response = await POST();

    expect(response.status).toBe(200);
    expect((await response.json()).sessionRevoked).toBe(false);
    expect(setCookieMock).toHaveBeenCalledWith('refresh_token', '', expect.objectContaining({ maxAge: 0 }));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([429, 500, 503])('API odmówiło (status %i): cookies czyszczone, ale odpowiedź mówi sessionRevoked=false i błąd jest w logu', async (status) => {
    mockHeaders(SAME_ORIGIN);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));

    const response = await POST();

    expect(await response.json()).toEqual({ success: true, sessionRevoked: false });
    expect(setCookieMock).toHaveBeenCalledWith('refresh_token', '', expect.objectContaining({ maxAge: 0 }));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(String(status)));
    consoleError.mockRestore();
  });

  it('bez cookie refresh_token: nie woła API, ale czyści cookies', async () => {
    mockHeaders(SAME_ORIGIN);
    mockCookies(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).toHaveBeenCalledWith('access_token', '', expect.objectContaining({ maxAge: 0 }));
  });

  it('z obcego Origin: 403, API nie jest wołane, cookies nietknięte (logout-CSRF)', async () => {
    mockHeaders({ origin: 'https://evil.example.com', host: 'localhost:3000' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST();

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
