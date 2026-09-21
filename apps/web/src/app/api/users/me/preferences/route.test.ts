import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { GET, PATCH } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/users/me/preferences (BFF)', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  describe('GET', () => {
    it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
      mockCookie(undefined);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await GET();

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('woła apps/api z tokenem z cookie i przekazuje status i body 1:1', async () => {
      mockCookie('access-token-value');
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ narrationEnabled: true }) });
      vi.stubGlobal('fetch', fetchMock);

      const response = await GET();

      expect(fetchMock).toHaveBeenCalledWith(
        `${API_URL}/users/me/preferences`,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }) }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ narrationEnabled: true });
    });

    it('zwraca 502, gdy apps/api jest nieosiągalne', async () => {
      mockCookie('access-token-value');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      expect((await GET()).status).toBe(502);
    });
  });

  describe('PATCH', () => {
    it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
      mockCookie(undefined);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const response = await PATCH(patchRequest({ narrationEnabled: false }));

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('woła apps/api z nagłówkiem Authorization i przekazuje body 1:1 (bez dopisywania identyfikatora użytkownika)', async () => {
      mockCookie('access-token-value');
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ narrationEnabled: false }) });
      vi.stubGlobal('fetch', fetchMock);

      const response = await PATCH(patchRequest({ narrationEnabled: false }));

      expect(fetchMock).toHaveBeenCalledWith(
        `${API_URL}/users/me/preferences`,
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }),
          body: JSON.stringify({ narrationEnabled: false }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ narrationEnabled: false });
    });

    it('przekazuje błąd walidacji z apps/api (400) do klienta', async () => {
      mockCookie('access-token-value');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400, json: async () => ({ message: ['narrationEnabled must be a boolean value'] }) }));

      const response = await PATCH(patchRequest({ narrationEnabled: 'nie' }));

      expect(response.status).toBe(400);
    });

    it('zwraca 502, gdy apps/api jest nieosiągalne', async () => {
      mockCookie('access-token-value');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      expect((await PATCH(patchRequest({ narrationEnabled: false }))).status).toBe(502);
    });

    it('nieparsowalne body idzie do apps/api jako "null" (API odrzuca 400 - fail-closed), bez własnych domyślnych wartości', async () => {
      mockCookie('access-token-value');
      const fetchMock = vi.fn().mockResolvedValue({ status: 400, json: async () => ({ message: 'Bad Request' }) });
      vi.stubGlobal('fetch', fetchMock);
      const broken = new NextRequest('http://localhost:3000/api/users/me/preferences', {
        method: 'PATCH',
        body: '{nie-json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(broken);

      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: 'null' }));
      expect(response.status).toBe(400);
    });
  });
});
