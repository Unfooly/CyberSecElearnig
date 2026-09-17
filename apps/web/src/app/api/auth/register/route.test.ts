import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST } from './route';

const setCookieMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ set: setCookieMock })),
}));

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/register', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    setCookieMock.mockClear();
    vi.mocked(cookies).mockClear();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400, gdy brakuje któregokolwiek pola, bez wołania backendu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ organizationName: '', email: 'a@test.pl', password: 'haslo123!' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(
      buildRequest({ organizationName: 'Acme', email: 'a@test.pl', password: 'SuperSecret123!' }),
    );

    expect(response.status).toBe(502);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('przy duplikacie e-maila przekazuje generyczny komunikat 1:1 z backendu (bez ujawniania że e-mail zajęty)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Nie udało się utworzyć konta z podanymi danymi. Jeśli masz już konto, zaloguj się.',
        }),
      }),
    );

    const response = await POST(
      buildRequest({ organizationName: 'Acme', email: 'zajety@test.pl', password: 'SuperSecret123!' }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).not.toMatch(/istnieje/i);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('normalizuje tablicę komunikatów walidacji (class-validator) do pojedynczego stringa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: ['password must be longer than or equal to 8 characters'], statusCode: 400 }),
      }),
    );

    const response = await POST(
      buildRequest({ organizationName: 'Acme', email: 'a@test.pl', password: 'krotkie' }),
    );
    const body = await response.json();

    expect(typeof body.message).toBe('string');
    expect(body.message).toMatch(/8 characters/);
  });

  it('przy sukcesie (201 od apps/api) ustawia cookies i zwraca WYŁĄCZNIE {success:true}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ accessToken: 'access-value', refreshToken: 'refresh-value' }),
      }),
    );

    const response = await POST(
      buildRequest({ organizationName: 'Acme', email: 'nowy@test.pl', password: 'SuperSecret123!' }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
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

  it('odrzuca 201 z apps/api bez accessToken/refreshToken (fail closed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) }));

    const response = await POST(
      buildRequest({ organizationName: 'Acme', email: 'nowy@test.pl', password: 'SuperSecret123!' }),
    );

    expect(response.status).toBe(502);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
