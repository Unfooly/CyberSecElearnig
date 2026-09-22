import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { DELETE, GET, POST } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

// decodeJwtPayload nie weryfikuje podpisu - wystarczy poprawny KSZTAŁT tokena.
function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (value: string) =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify(payload))}.sig`;
}

const TOKEN = fakeJwt({
  sub: 'user-1',
  organizationId: 'org-1',
  email: 'a@example.test',
  role: 'EMPLOYEE',
  exp: Math.floor(Date.now() / 1000) + 900,
});

function mockCookie(value: string | undefined, sameOrigin = true) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
  const map: Record<string, string> = sameOrigin
    ? { origin: 'http://localhost:3000', host: 'localhost:3000' }
    : { origin: 'http://evil.test', host: 'localhost:3000' };
  vi.mocked(headers).mockReturnValue({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  } as unknown as ReturnType<typeof headers>);
}

/**
 * Żądanie z gotowym `formData`. Środowisko testowe (jsdom) nie parsuje multipart - sam parser
 * jest częścią Next/undici, nie naszą; testujemy logikę trasy: kontrolę same-origin, token,
 * limit rozmiaru i to, co trafia do apps/api. Pełną ścieżkę z prawdziwym plikiem pokrywa e2e API.
 */
function uploadRequest(blob: Blob | null = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })): NextRequest {
  const form = new FormData();
  if (blob) {
    form.append('file', blob, 'avatar.png');
  }
  const request = new NextRequest('http://localhost:3000/api/users/me/avatar/image', { method: 'POST' });
  Object.defineProperty(request, 'formData', { value: async () => form });
  return request;
}

describe('/api/users/me/avatar/image', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('POST: odrzuca żądanie z obcej strony (CSRF) bez wołania backendu', async () => {
    mockCookie(TOKEN, false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST: zwraca 401 bez wołania backendu, gdy brak cookie', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST: przekazuje plik do apps/api z tokenem i zwraca odpowiedź API', async () => {
    mockCookie(TOKEN);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ avatarUrl: 'upload:abcdef0123456789' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatarUrl: 'upload:abcdef0123456789' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/users/me/avatar/image`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('POST: odrzuca plik większy niż 2 MB bez wołania backendu', async () => {
    mockCookie(TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/png' });

    const response = await POST(uploadRequest(big));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST: brak pliku w żądaniu => 400', async () => {
    mockCookie(TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(uploadRequest(null));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DELETE: odrzuca żądanie z obcej strony (CSRF)', async () => {
    mockCookie(TOKEN, false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE();

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET: pobiera WŁASNY obrazek - "me" zamieniane na id z tokena po stronie serwera', async () => {
    mockCookie(TOKEN);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    // Wizerunek pracownika nie może trafić do cache współdzielonego.
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/users/user-1/avatar/image`);
  });

  it('GET: błąd z API przechodzi jako JSON, nigdy jako obrazek', async () => {
    mockCookie(TOKEN);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ message: 'Avatar nie istnieje.' }),
      }),
    );

    const response = await GET();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
