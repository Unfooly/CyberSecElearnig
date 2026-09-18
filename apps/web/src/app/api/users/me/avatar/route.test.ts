import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { PATCH } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/me/avatar', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PATCH /api/users/me/avatar', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(buildRequest({ avatarUrl: 'fox' }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api z nagłówkiem Authorization i przekazuje body 1:1', async () => {
    mockCookie('access-token-value');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ avatarUrl: 'fox' }) });
    vi.stubGlobal('fetch', fetchMock);

    await PATCH(buildRequest({ avatarUrl: 'fox' }));

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/me/avatar`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }),
        body: JSON.stringify({ avatarUrl: 'fox' }),
      }),
    );
  });

  it('przekazuje status i body z apps/api 1:1 do klienta (sukces)', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: async () => ({ avatarUrl: 'https://example.test/a.png' }) }),
    );

    const response = await PATCH(buildRequest({ avatarUrl: 'https://example.test/a.png' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ avatarUrl: 'https://example.test/a.png' });
  });

  it('przekazuje status i komunikat błędu z apps/api 1:1 (np. 400 przy nieprawidłowym avatarUrl)', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: async () => ({ message: 'avatarUrl musi być jednym z dostępnych presetów albo poprawnym adresem URL (http/https).' }),
      }),
    );

    const response = await PATCH(buildRequest({ avatarUrl: 'nie-to-nie-tamto' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toMatch(/presetów/);
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await PATCH(buildRequest({ avatarUrl: 'fox' }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toMatch(/nie udało się połączyć/i);
  });
});
