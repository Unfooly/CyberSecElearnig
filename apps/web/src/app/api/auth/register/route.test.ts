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

    const response = await POST(buildRequest({ email: '', password: 'haslo123!' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(
      buildRequest({ email: 'a@test.pl', password: 'SuperSecret123!' }),
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
      buildRequest({ email: 'zajety@test.pl', password: 'SuperSecret123!' }),
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
      buildRequest({ email: 'a@test.pl', password: 'krotkie' }),
    );
    const body = await response.json();

    expect(typeof body.message).toBe('string');
    expect(body.message).toMatch(/8 characters/);
  });

  it('przy sukcesie NIE ustawia cookies i przekazuje wyłącznie komunikat (logowanie po weryfikacji e-mail)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ message: 'Wysłaliśmy link weryfikacyjny.' }),
      }),
    );

    const response = await POST(buildRequest({ email: 'nowy@test.pl', password: 'SuperSecret123!' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: 'Wysłaliśmy link weryfikacyjny.', emailSent: true });
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it('przekazuje emailSent=false, gdy backend zgłosił nieudaną wysyłkę maila', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ message: 'Konto utworzone, ale nie udało się wysłać linku.', emailSent: false }),
      }),
    );

    const response = await POST(buildRequest({ email: 'nowy@test.pl', password: 'SuperSecret123!' }));
    const body = await response.json();

    expect(body.emailSent).toBe(false);
  });
});
