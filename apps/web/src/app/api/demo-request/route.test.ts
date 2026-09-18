import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/demo-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/demo-request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('przekazuje ciało do apps/api bez autoryzacji i zwraca jego status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, json: async () => ({ message: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(req({ email: 'a@firma.pl', employeeCount: 5 }, { 'x-forwarded-for': '1.2.3.4' }));

    expect(response.status).toBe(202);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/demo-requests');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-Forwarded-For']).toBe('1.2.3.4');
  });

  it('400 dla niepoprawnego JSON', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await POST(req('{nie-json'))).status).toBe(400);
  });

  it('502 przy awarii sieci', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await POST(req({ email: 'a@firma.pl', employeeCount: 5 }))).status).toBe(502);
  });
});
