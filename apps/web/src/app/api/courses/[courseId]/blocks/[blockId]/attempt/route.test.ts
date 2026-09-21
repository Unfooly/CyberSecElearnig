import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { POST } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

const SAME_ORIGIN = { origin: 'http://localhost:3000', host: 'localhost:3000' };

function mockSession(token: string | undefined, headerValues: Record<string, string> = SAME_ORIGIN) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (token === undefined ? undefined : { name: 'access_token', value: token }),
  } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const buildRequest = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/courses/course-1/blocks/domena/attempt', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const ctx = (courseId = 'course-1', blockId = 'domena') => ({ params: { courseId, blockId } });

describe('POST /api/courses/[courseId]/blocks/[blockId]/attempt', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ correct: false, attemptsLeft: 3 }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('woła apps/api ze STAŁĄ ścieżką, tokenem z ciasteczka i ciałem tylko z { answer }', async () => {
    const response = await POST(buildRequest({ answer: 'moja próba', userId: 'obcy', organizationId: 'obca', correct: true }), ctx());

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/blocks/domena/attempt`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ answer: 'moja próba' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ correct: false, attemptsLeft: 3 });
  });

  describe('ochrona CSRF (jak w pozostałych trasach BFF: proxyAuthenticated)', () => {
    it('Origin obcego hosta: 403 bez wołania API', async () => {
      mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
      const response = await POST(buildRequest({ answer: 'x' }), ctx());
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bez Origin i bez Sec-Fetch-Site: same-origin: 403 (fail-closed jak w proxyAuthenticated)', async () => {
      mockSession('tok', { host: 'localhost:3000' });
      expect((await POST(buildRequest({ answer: 'x' }), ctx())).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bez Origin, ale Sec-Fetch-Site: same-origin: przechodzi', async () => {
      mockSession('tok', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
      expect((await POST(buildRequest({ answer: 'x' }), ctx())).status).toBe(200);
    });

    it('Origin zgodny z x-forwarded-host (za reverse proxy): przechodzi', async () => {
      mockSession('tok', { origin: 'https://app.unfooly.pl', host: 'internal:3000', 'x-forwarded-host': 'app.unfooly.pl' });
      expect((await POST(buildRequest({ answer: 'x' }), ctx())).status).toBe(200);
    });
  });

  it('401 bez ciasteczka, bez wołania backendu', async () => {
    mockSession(undefined);
    expect((await POST(buildRequest({ answer: 'x' }), ctx())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['courseId z kropkami', ctx('..', 'domena')],
    ['blockId z ukośnikiem', ctx('course-1', 'a/b')],
    ['blockId z kodowanym ukośnikiem', ctx('course-1', 'a%2Fb')],
    ['blockId ze znakiem zapytania', ctx('course-1', 'a?b')],
    ['pusty blockId (brak id bloku nie trafia do żądania)', ctx('course-1', '')],
    ['zbyt długi identyfikator', ctx('course-1', 'x'.repeat(65))],
  ])('odrzuca identyfikator: %s (400, bez wołania API)', async (_label, context) => {
    const response = await POST(buildRequest({ answer: 'x' }), context);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['brak odpowiedzi', {}],
    ['odpowiedź jako liczba', { answer: 5 }],
    ['odpowiedź jako obiekt', { answer: { x: 1 } }],
    ['ciało nieparsowalne', 'to nie jest json'],
    ['ciało null', 'null'],
  ])('odrzuca ciało: %s (400, bez wołania API)', async (_label, body) => {
    const response = await POST(buildRequest(body), ctx());
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404, 429])('przekazuje status %i z API razem z treścią błędu', async (status) => {
    fetchMock.mockResolvedValue({ status, json: async () => ({ message: 'błąd z API' }) });
    const response = await POST(buildRequest({ answer: 'x' }), ctx());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: 'błąd z API' });
  });

  it('błąd sieci to 502 bez szczegółów', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED secret-host:5432'));
    const down = await POST(buildRequest({ answer: 'x' }), ctx());
    expect(down.status).toBe(502);
    expect(JSON.stringify(await down.json())).not.toContain('secret-host');
  });
});
