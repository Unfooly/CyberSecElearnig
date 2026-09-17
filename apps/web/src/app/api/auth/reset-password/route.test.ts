import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/reset-password', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400, gdy brakuje tokenu lub hasła, bez wołania backendu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ token: '', newPassword: 'Cokolwiek1' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(buildRequest({ token: 'abc', newPassword: 'NoweHaslo123' }));
    expect(response.status).toBe(502);
  });

  it('przy sukcesie zwraca 200 z komunikatem z apps/api', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Hasło zostało zmienione. Zaloguj się nowym hasłem.' }),
      }),
    );

    const response = await POST(buildRequest({ token: 'abc', newPassword: 'NoweHaslo123' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Hasło zostało zmienione. Zaloguj się nowym hasłem.');
  });

  it('przekazuje code=TOKEN_ALREADY_USED z odrębnym komunikatem, odróżnialnym od invalid/expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          code: 'TOKEN_ALREADY_USED',
          message: 'Ten link został już wykorzystany.',
        }),
      }),
    );

    const response = await POST(buildRequest({ token: 'juz-uzyty', newPassword: 'NoweHaslo123' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('TOKEN_ALREADY_USED');
    expect(body.message).toBe('Ten link został już wykorzystany.');
  });

  it('przekazuje code=TOKEN_INVALID_OR_EXPIRED dla wygasłego/nieistniejącego tokenu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          code: 'TOKEN_INVALID_OR_EXPIRED',
          message: 'Link do resetowania hasła jest nieprawidłowy lub wygasł. Poproś o nowy.',
        }),
      }),
    );

    const response = await POST(buildRequest({ token: 'zly', newPassword: 'NoweHaslo123' }));
    const body = await response.json();

    expect(body.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });
});
