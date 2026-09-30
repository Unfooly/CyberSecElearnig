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

describe('middleware: Content-Security-Policy z nonce', () => {
  const policyOf = (response: Response) => response.headers.get('content-security-policy') ?? '';
  const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];

  it('strona publiczna dostaje CSP z nonce, bez unsafe-inline/unsafe-eval w script-src', async () => {
    const response = await middleware(buildRequest('/login'));
    const policy = policyOf(response);

    expect(nonceOf(policy)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'(;|$)/);
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('nonce jest przekazany do żądania (x-nonce i CSP w nagłówkach żądania) - Next.js czyta go stamtąd', async () => {
    const response = await middleware(buildRequest('/regulamin'));
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(forwarded).toBe(policyOf(response));
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(policyOf(response)));
  });

  it('każda odpowiedź ma inny nonce', async () => {
    const first = nonceOf(policyOf(await middleware(buildRequest('/login'))));
    const second = nonceOf(policyOf(await middleware(buildRequest('/login'))));

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('CSP dostaje też chroniona strona z poprawną sesją (przekierowania go nie potrzebują)', async () => {
    const token = fakeJwt({
      sub: 'user-1',
      organizationId: 'org-1',
      role: 'ORG_ADMIN',
      email: 'admin@example.test',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const response = await middleware(buildRequest('/dashboard', `access_token=${token}; refresh_token=r`));

    expect(nonceOf(policyOf(response))).toBeTruthy();
  });

  // B-141: adres magazynu treści (domena z marką serwisu) nie może trafić do nagłówka strony lądowania symulacji phishingowej.
  it('strona lądowania /t/* ma CSP bez adresu magazynu treści; pozostałe strony go mają', async () => {
    vi.stubEnv('CONTENT_BASE_URL', 'https://content.example.test');
    try {
      expect(policyOf(await middleware(buildRequest('/login')))).toContain('https://content.example.test');
      for (const path of ['/t', '/t/token', '/t/token/dalej', '/t/a/b/c']) {
        const policy = policyOf(await middleware(buildRequest(path)));
        expect(nonceOf(policy), path).toBeTruthy();
        expect(policy, path).not.toContain('content.example.test');
        expect(policy, path).toContain("img-src 'self' data:;");
      }
      // Prefiks po segmencie: /team to zwykła strona.
      expect(policyOf(await middleware(buildRequest('/team')))).toContain('https://content.example.test');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('matcher obejmuje strony, a pomija trasy BFF, zasoby statyczne Next.js i pliki ikon', async () => {
    const { config } = await import('./middleware');
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    // Ścieżki graniczne: prefiksy podobne do wyjątków NIE są wyjątkami (muszą dostać CSP).
    for (const path of ['/', '/login', '/dashboard/users', '/courses/abc', '/t/token', '/regulamin', '/apiary', '/_nextfoo', '/logo.svg', '/brand/x']) {
      expect(matcher.test(path), path).toBe(true);
    }
    for (const path of ['/api/courses/x/progress', '/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/icon.svg', '/manifest.webmanifest']) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});

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

  describe('/onboarding - tylko ORG_ADMIN', () => {
    const tokenFor = (role: string) =>
      fakeJwt({ sub: 'u', organizationId: 'o', role, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900 });

    it('przepuszcza ORG_ADMIN', async () => {
      const response = await middleware(
        buildRequest('/onboarding', `access_token=${tokenFor('ORG_ADMIN')}; refresh_token=r`),
      );
      expect(response.headers.get('location')).toBeNull();
    });

    it.each(['EMPLOYEE', 'DEPARTMENT_MANAGER'])('rola %s => /login', async (role) => {
      const response = await middleware(buildRequest('/onboarding', `access_token=${tokenFor(role)}; refresh_token=r`));
      expect(response.headers.get('location')).toContain('/login');
    });

    it('niezalogowany => /login', async () => {
      const response = await middleware(buildRequest('/onboarding'));
      expect(response.headers.get('location')).toContain('/login');
    });
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

  describe('/account - ustawienia konta dla każdej zalogowanej roli', () => {
    const tokenFor = (role: string) =>
      fakeJwt({ sub: 'u', organizationId: 'o', role, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900 });

    it.each(['ORG_ADMIN', 'DEPARTMENT_MANAGER', 'EMPLOYEE'])('przepuszcza rolę %s', async (role) => {
      const response = await middleware(buildRequest('/account', `access_token=${tokenFor(role)}; refresh_token=r`));

      expect(response.headers.get('location')).toBeNull();
    });

    it('niezalogowany => /login', async () => {
      const response = await middleware(buildRequest('/account'));

      expect(response.headers.get('location')).toContain('/login');
    });
  });

  describe('/report - dostępne dla każdej zalogowanej roli, ale prefiks nie obejmuje /reports', () => {
    const tokenFor = (role: string) =>
      fakeJwt({ sub: 'u', organizationId: 'o', role, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900 });

    it.each(['ORG_ADMIN', 'DEPARTMENT_MANAGER', 'EMPLOYEE'])('przepuszcza rolę %s', async (role) => {
      const response = await middleware(buildRequest('/report', `access_token=${tokenFor(role)}; refresh_token=r`));

      expect(response.headers.get('location')).toBeNull();
    });

    it('niezalogowany => /login', async () => {
      const response = await middleware(buildRequest('/report'));

      expect(response.headers.get('location')).toContain('/login');
    });

    it('prefiks /report nie obejmuje /reports: pracownik na /reports jest odsyłany (dopasowanie po segmencie ścieżki)', async () => {
      const response = await middleware(buildRequest('/reports', `access_token=${tokenFor('EMPLOYEE')}; refresh_token=r`));

      expect(response.headers.get('location')).toContain('/login');
    });
  });

  describe('/reports - skrzynka zgłoszeń: ORG_ADMIN i DEPARTMENT_MANAGER', () => {
    const tokenFor = (role: string) =>
      fakeJwt({ sub: 'u', organizationId: 'o', role, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900 });

    it.each(['ORG_ADMIN', 'DEPARTMENT_MANAGER'])('przepuszcza rolę %s (także podstronę szczegółów)', async (role) => {
      for (const path of ['/reports', '/reports/abc123']) {
        const response = await middleware(buildRequest(path, `access_token=${tokenFor(role)}; refresh_token=r`));
        expect(response.headers.get('location')).toBeNull();
      }
    });

    it('EMPLOYEE => /login; niezalogowany => /login', async () => {
      expect((await middleware(buildRequest('/reports', `access_token=${tokenFor('EMPLOYEE')}; refresh_token=r`))).headers.get('location')).toContain('/login');
      expect((await middleware(buildRequest('/reports/abc123'))).headers.get('location')).toContain('/login');
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

    it('za zaufanym proxy przekazuje adres klienta do /auth/refresh (limit per klient); bez TRUST_PROXY - nie', async () => {
      const okResponse = () => ({ ok: false, status: 401 });
      const cookie = `access_token=${expiredToken}; refresh_token=old-refresh-token`;
      const withIp = (path: string) =>
        new NextRequest(new URL(path, 'http://localhost:3000'), {
          headers: { cookie, 'cf-connecting-ip': '203.0.113.7' },
        });

      const untrusted = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', untrusted);
      await middleware(withIp('/dashboard'));
      expect(untrusted.mock.calls[0][1].headers).not.toHaveProperty('CF-Connecting-IP');

      vi.stubEnv('TRUST_PROXY', 'true');
      const trusted = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', trusted);
      await middleware(withIp('/dashboard'));
      expect(trusted.mock.calls[0][1].headers).toMatchObject({ 'CF-Connecting-IP': '203.0.113.7' });
      vi.unstubAllEnvs();
    });

    it('single-flight: równoległe żądania z tym samym refresh tokenem wołają /auth/refresh JEDEN raz i dostają te same tokeny', async () => {
      const newAccessToken = fakeJwt({
        sub: 'user-1', organizationId: 'org-1', role: 'ORG_ADMIN', email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900,
      });
      let release: (value: unknown) => void = () => {};
      const gate = new Promise((resolve) => (release = resolve));
      const fetchMock = vi.fn().mockImplementation(async () => {
        await gate;
        return { ok: true, json: async () => ({ accessToken: newAccessToken, refreshToken: 'new-refresh' }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      const cookie = `access_token=${expiredToken}; refresh_token=shared-refresh`;

      const pending = [middleware(buildRequest('/dashboard', cookie)), middleware(buildRequest('/dashboard/users', cookie)), middleware(buildRequest('/dashboard', cookie))];
      release(undefined);
      const responses = await Promise.all(pending);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const response of responses) {
        expect(response.cookies.get('refresh_token')?.value).toBe('new-refresh');
      }
    });

    it('single-flight nie zatrzymuje kolejnych odświeżeń: po zakończeniu następne żądanie odświeża od nowa', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal('fetch', fetchMock);
      const cookie = `access_token=${expiredToken}; refresh_token=again-refresh`;

      await middleware(buildRequest('/dashboard', cookie));
      await middleware(buildRequest('/dashboard', cookie));

      expect(fetchMock).toHaveBeenCalledTimes(2);
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
