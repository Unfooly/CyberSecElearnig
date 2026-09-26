import { describe, it, expect, vi, afterEach } from 'vitest';
import { cookies } from 'next/headers';
import { GET } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('GET /api/users/me/display-name', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api z tokenem i przepuszcza WYŁĄCZNIE firstName/lastInitial (nadmiarowe pola odcięte)', async () => {
    mockCookie('access-token-value');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ firstName: 'Anna', lastInitial: 'K', lastName: 'Kowalska', email: 'a@x.pl' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/me/display-name`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ firstName: 'Anna', lastInitial: 'K' });
  });

  it('brak imienia w profilu: null w obu polach', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ firstName: null, lastInitial: '' }) }));

    expect(await (await GET()).json()).toEqual({ firstName: null, lastInitial: null });
  });

  it('błąd z apps/api przechodzi ze statusem (np. 403 dla organizacji PENDING)', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION' }) }));

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
