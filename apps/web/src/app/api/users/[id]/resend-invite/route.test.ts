import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { POST } from './route';
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

const request = () => new NextRequest('http://localhost:3000/api/users/u1/resend-invite', { method: 'POST' });

describe('POST /api/users/[id]/resend-invite', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request(), { params: { id: 'u1' } });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api z Bearer tokenem i przekazuje odpowiedź', async () => {
    mockCookie('token-a');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ inviteEmailSent: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request(), { params: { id: 'u1' } });

    expect(await response.json()).toEqual({ inviteEmailSent: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/u1/resend-invite`,
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token-a' } }),
    );
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('token-a');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const response = await POST(request(), { params: { id: 'u1' } });

    expect(response.status).toBe(502);
  });
});
