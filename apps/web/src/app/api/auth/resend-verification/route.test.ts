import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { API_URL } from '@/lib/config';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/resend-verification', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400 bez wołania backendu, gdy brak e-maila', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({}));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje e-mail do apps/api i zwraca jego komunikat 1:1', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Jeśli konto czeka na potwierdzenie, wysłaliśmy link.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ email: 'a@test.pl' }));
    const body = await response.json();

    expect(body.message).toMatch(/wysłaliśmy link/);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/auth/resend-verification`,
      expect.objectContaining({ body: JSON.stringify({ email: 'a@test.pl' }) }),
    );
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const response = await POST(buildRequest({ email: 'a@test.pl' }));

    expect(response.status).toBe(502);
  });
});
