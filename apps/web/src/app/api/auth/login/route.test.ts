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

  it('przy sukcesie ustawia cookies i zwraca WYŁĄCZNIE {success:true} - tokeny nigdy w body', async () => {
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
