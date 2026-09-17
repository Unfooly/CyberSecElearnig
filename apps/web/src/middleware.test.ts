import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { API_URL } from '@/lib/config';

function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (value: string) =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

function buildRequest(path: string, cookieHeader?: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe('middleware', () => {
  it('przekierowuje na /login, gdy nie ma żadnych cookies (niezalogowany)', async () => {
    const response = await middleware(buildRequest('/dashboard'));

    expect(response.headers.get('location')).toContain('/login');
  });

  it('przekierowuje na /login, gdy access token wskazuje rolę inną niż ORG_ADMIN', async () => {
    const token = fakeJwt({
      sub: 'user-1',
      organizationId: 'org-1',
      role: 'EMPLOYEE',
      email: 'employee@example.test',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const response = await middleware(
      buildRequest('/dashboard', `access_token=${token}; refresh_token=some-refresh-token`),
    );

    expect(response.headers.get('location')).toContain('/login');
  });

  it('przepuszcza żądanie dla poprawnej roli ORG_ADMIN z ważnym tokenem (brak przekierowania)', async () => {
    const token = fakeJwt({
      sub: 'user-1',
      organizationId: 'org-1',
      role: 'ORG_ADMIN',
      email: 'admin@example.test',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const response = await middleware(
      buildRequest('/dashboard', `access_token=${token}; refresh_token=some-refresh-token`),
    );

    expect(response.headers.get('location')).toBeNull();
  });

  it('nie dotyka żądań spoza chronionych ścieżek', async () => {
    const response = await middleware(buildRequest('/login'));

    expect(response.headers.get('location')).toBeNull();
  });

  describe('/courses - dostępne dla każdej zalogowanej roli', () => {
    it.each(['SUPER_ADMIN', 'ORG_ADMIN', 'DEPARTMENT_MANAGER', 'EMPLOYEE'])(
      'przepuszcza rolę %s',
      async (role) => {
        const token = fakeJwt({
          sub: 'user-1',
          organizationId: 'org-1',
          role,
          email: 'user@example.test',
          exp: Math.floor(Date.now() / 1000) + 900,
        });
        const response = await middleware(
          buildRequest('/courses', `access_token=${token}; refresh_token=some-refresh-token`),
        );

        expect(response.headers.get('location')).toBeNull();
      },
    );

    it('przepuszcza podstronę odtwarzacza /courses/:courseId dla EMPLOYEE', async () => {
      const token = fakeJwt({
        sub: 'user-1',
        organizationId: 'org-1',
        role: 'EMPLOYEE',
        email: 'employee@example.test',
        exp: Math.floor(Date.now() / 1000) + 900,
      });
      const response = await middleware(
        buildRequest('/courses/course-123', `access_token=${token}; refresh_token=some-refresh-token`),
      );

      expect(response.headers.get('location')).toBeNull();
    });

    it('przekierowuje niezalogowanego (brak cookies) do /login', async () => {
      const response = await middleware(buildRequest('/courses'));

      expect(response.headers.get('location')).toContain('/login');
    });
  });

  describe('proaktywny refresh wygasłego access tokenu', () => {
    const expiredToken = fakeJwt({
      sub: 'user-1',
      organizationId: 'org-1',
      role: 'ORG_ADMIN',
      email: 'admin@example.test',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sukces: odświeża token, przepuszcza żądanie i nadpisuje cookies na odpowiedzi', async () => {
      const newAccessToken = fakeJwt({
        sub: 'user-1',
        organizationId: 'org-1',
        role: 'ORG_ADMIN',
        email: 'admin@example.test',
        exp: Math.floor(Date.now() / 1000) + 900,
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: newAccessToken, refreshToken: 'new-refresh-token' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await middleware(
        buildRequest('/dashboard', `access_token=${expiredToken}; refresh_token=old-refresh-token`),
      );

      expect(response.headers.get('location')).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_URL}/auth/refresh`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'old-refresh-token' }),
        }),
      );
      expect(response.cookies.get('access_token')?.value).toBe(newAccessToken);
      expect(response.cookies.get('refresh_token')?.value).toBe('new-refresh-token');
    });

    it('brak access_token w ogóle (tylko refresh_token) też wyzwala odświeżenie', async () => {
      const newAccessToken = fakeJwt({
        sub: 'user-1',
        organizationId: 'org-1',
        role: 'ORG_ADMIN',
        email: 'admin@example.test',
        exp: Math.floor(Date.now() / 1000) + 900,
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: newAccessToken, refreshToken: 'new-refresh-token' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await middleware(buildRequest('/dashboard', 'refresh_token=old-refresh-token'));

      expect(fetchMock).toHaveBeenCalled();
      expect(response.headers.get('location')).toBeNull();
    });

    it('porażka: backend odrzuca refresh (401) -> redirect do /login', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal('fetch', fetchMock);

      const response = await middleware(
        buildRequest('/dashboard', `access_token=${expiredToken}; refresh_token=old-refresh-token`),
      );

      expect(response.headers.get('location')).toContain('/login');
    });

    it('porażka: fetch do /auth/refresh rzuca wyjątkiem (backend nieosiągalny) -> redirect do /login', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);

      const response = await middleware(
        buildRequest('/dashboard', `access_token=${expiredToken}; refresh_token=old-refresh-token`),
      );

      expect(response.headers.get('location')).toContain('/login');
    });

    it('porażka: backend zwraca 200 z niepoprawnym kształtem body -> redirect do /login, nie crash', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      const response = await middleware(
        buildRequest('/dashboard', `access_token=${expiredToken}; refresh_token=old-refresh-token`),
      );

      expect(response.headers.get('location')).toContain('/login');
    });
  });
});
