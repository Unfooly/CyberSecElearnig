import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST } from './route';

const setCookieMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ set: setCookieMock })),
}));

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/login', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    setCookieMock.mockClear();
    vi.mocked(cookies).mockClear();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400, gdy brakuje email/hasła, bez wołania backendu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ email: '', password: '' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 502 z generycznym komunikatem, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'haslo123' }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toMatch(/nie udało się połączyć/i);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('przekazuje status i komunikat błędu 1:1 z backendu (np. 401), bez ustawiania cookies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Nieprawidłowy e-mail lub hasło' }),
      }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'zlehaslo' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toBe('Nieprawidłowy e-mail lub hasło');
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('przy sukcesie ustawia cookies i zwraca WYŁĄCZNIE {success:true} - tokeny nigdy w body (poza ścieżką startową)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-value', refreshToken: 'refresh-value' }),
      }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'SuperSecret123!' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['redirectTo', 'success']);
    expect(body.success).toBe(true);
    expect(JSON.stringify(body)).not.toContain('access-value');
    expect(setCookieMock).toHaveBeenCalledWith(
      'access_token',
      'access-value',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(setCookieMock).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-value',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  describe('strona startowa zależna od statusu organizacji (ORG_ADMIN)', () => {
    const jwt = (role: string) => {
      const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
      return `${b64({ alg: 'none' })}.${b64({ sub: 'u', organizationId: 'o', role, email: 'a@example.test', exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
    };
    const loginThenOrg = (role: string, org: { ok: boolean; status?: number; body?: unknown }) =>
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: jwt(role), refreshToken: 'r' }) })
        .mockResolvedValueOnce({ ok: org.ok, status: org.status ?? 200, json: async () => org.body });

    it('organizacja PENDING => /onboarding (zapytanie o status z tokenem świeżo zalogowanego)', async () => {
      const fetchMock = loginThenOrg('ORG_ADMIN', { ok: true, body: { status: 'PENDING_DOMAIN_VERIFICATION' } });
      vi.stubGlobal('fetch', fetchMock);

      const response = await POST(buildRequest({ email: 'a@example.test', password: 'x' }));

      expect((await response.json()).redirectTo).toBe('/onboarding');
      expect(fetchMock.mock.calls[1][0]).toMatch(/\/organization\/me$/);
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${jwt('ORG_ADMIN')}`);
    });

    it('organizacja ACTIVE => /dashboard', async () => {
      vi.stubGlobal('fetch', loginThenOrg('ORG_ADMIN', { ok: true, body: { status: 'ACTIVE' } }));

      const response = await POST(buildRequest({ email: 'a@example.test', password: 'x' }));

      expect((await response.json()).redirectTo).toBe('/dashboard');
    });

    it('błąd zapytania o status nie blokuje logowania (zwykła strona startowa)', async () => {
      vi.stubGlobal('fetch', loginThenOrg('ORG_ADMIN', { ok: false, status: 503 }));

      const response = await POST(buildRequest({ email: 'a@example.test', password: 'x' }));

      expect(response.status).toBe(200);
      expect((await response.json()).redirectTo).toBe('/dashboard');
    });

    it('EMPLOYEE: bez zapytania o organizację, /courses', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: jwt('EMPLOYEE'), refreshToken: 'r' }) });
      vi.stubGlobal('fetch', fetchMock);

      const response = await POST(buildRequest({ email: 'a@example.test', password: 'x' }));

      expect((await response.json()).redirectTo).toBe('/courses');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('odrzuca 200 z apps/api, gdy body nie ma accessToken/refreshToken (fail closed, nie fałszywy sukces)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'SuperSecret123!' }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).not.toHaveProperty('success');
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('nie crashuje, gdy backend zwraca 200 z ciałem, które nie parsuje się jako JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'SuperSecret123!' }));

    expect(response.status).toBe(502);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login - redirectTo wg roli z JWT', () => {
  const jwtFor = (role: string) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'a@b.pl', role, organizationId: 'o1', exp: 9999999999 })}.sig`;
  };

  it.each([
    ['ORG_ADMIN', '/dashboard'],
    ['EMPLOYEE', '/courses'],
    ['DEPARTMENT_MANAGER', '/courses'],
    // Role platformy mają własne panele (D-070).
    ['SUPER_ADMIN', '/dashboard/admin'],
    ['RESELLER_ADMIN', '/dashboard/reseller'],
  ])('%s => %s', async (role, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: jwtFor(role), refreshToken: 'r' }) }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test', password: 'SuperSecret123!' }));

    expect((await response.json()).redirectTo).toBe(expected);
  });
});
