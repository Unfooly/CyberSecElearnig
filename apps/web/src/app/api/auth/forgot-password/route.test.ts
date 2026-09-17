import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/forgot-password', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400, gdy brakuje e-maila, bez wołania backendu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ email: '' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 502 z generycznym komunikatem, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(buildRequest({ email: 'a@example.test' }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toMatch(/nie udało się połączyć/i);
  });

  it('przy sukcesie zwraca 200 z komunikatem z apps/api niezależnie od tego, czy e-mail istnieje', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Jeśli podany adres e-mail istnieje w systemie, wysłaliśmy link.' }),
      }),
    );

    const response = await POST(buildRequest({ email: 'ktokolwiek@example.test' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/jeśli podany adres/i);
  });

  it('przekazuje status i komunikat błędu 1:1 z backendu (np. 429 rate limit)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: 'ThrottlerException: Too Many Requests' }),
      }),
    );

    const response = await POST(buildRequest({ email: 'a@example.test' }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.message).toBe('ThrottlerException: Too Many Requests');
  });
});
