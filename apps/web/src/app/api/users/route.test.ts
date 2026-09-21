import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { GET, POST } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
  // Żądanie z naszej własnej strony (proxyAuthenticated wymaga zgodnego Origin); obce Origin: users-csrf.test.ts.
  const sameOrigin: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' };
  vi.mocked(headers).mockReturnValue({ get: (name: string) => sameOrigin[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

describe('GET /api/users', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new NextRequest('http://localhost:3000/api/users'));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje query string 1:1 do apps/api', async () => {
    mockCookie('token-a');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await GET(new NextRequest('http://localhost:3000/api/users?page=2&search=jan'));

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users?page=2&search=jan`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-a' }) }),
    );
  });
});

describe('POST /api/users', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/users', { method: 'POST', body: JSON.stringify({}) }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła /users/invite na apps/api z Bearer tokenem', async () => {
    mockCookie('token-a');
    const fetchMock = vi.fn().mockResolvedValue({ status: 201, json: async () => ({ id: 'u1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(
      new NextRequest('http://localhost:3000/api/users', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@test.pl' }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/invite`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('token-a');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(
      new NextRequest('http://localhost:3000/api/users', { method: 'POST', body: JSON.stringify({}) }),
    );

    expect(response.status).toBe(502);
  });
});
