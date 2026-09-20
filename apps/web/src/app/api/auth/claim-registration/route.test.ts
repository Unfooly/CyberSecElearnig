import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { API_URL } from '@/lib/config';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/claim-registration', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/auth/claim-registration', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400 bez wołania backendu, gdy brak tokenu albo token nie jest tekstem', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect((await POST(buildRequest({}))).status).toBe(400);
    expect((await POST(buildRequest({ token: { $ne: 1 } }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje TYLKO token do apps/api (stała ścieżka) i zwraca komunikat sukcesu', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'OK' }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ token: 't1', organizationId: 'obca' }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/auth/claim-registration`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 't1' }) }),
    );
  });

  it('przekazuje status, komunikat i kod błędu z apps/api (CLAIM_INVALID_OR_EXPIRED)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Link nieważny', code: 'CLAIM_INVALID_OR_EXPIRED' }) }),
    );

    const response = await POST(buildRequest({ token: 't1' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Link nieważny', code: 'CLAIM_INVALID_OR_EXPIRED' });
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    expect((await POST(buildRequest({ token: 't1' }))).status).toBe(502);
  });
});
