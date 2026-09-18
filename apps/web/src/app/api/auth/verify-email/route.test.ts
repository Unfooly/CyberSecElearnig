import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { API_URL } from '@/lib/config';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/verify-email', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400 bez wołania backendu, gdy brak tokenu', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({}));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje token do apps/api i zwraca komunikat sukcesu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'OK' }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ token: 't1' }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/auth/verify-email`,
      expect.objectContaining({ body: JSON.stringify({ token: 't1' }) }),
    );
  });

  it('przekazuje status, komunikat i kod błędu z apps/api (TOKEN_ALREADY_USED)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Link użyty', code: 'TOKEN_ALREADY_USED' }),
      }),
    );

    const response = await POST(buildRequest({ token: 't1' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Link użyty', code: 'TOKEN_ALREADY_USED' });
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const response = await POST(buildRequest({ token: 't1' }));

    expect(response.status).toBe(502);
  });
});
