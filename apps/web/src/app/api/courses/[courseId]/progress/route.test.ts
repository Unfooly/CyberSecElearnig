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
  new NextRequest('http://localhost:3000/api/courses/course-1/progress', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const ctx = (courseId = 'course-1') => ({ params: { courseId } });

describe('POST /api/courses/[courseId]/progress', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS' }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('access-token-value');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockSession(undefined);
    const response = await POST(buildRequest({ blockIndex: 0 }), ctx());
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api ze STAŁĄ ścieżką, nagłówkiem Authorization i ciałem z allowlisty { blockIndex, answer }', async () => {
    await POST(buildRequest({ blockIndex: 2, answer: { selected: ['a', 'b'] }, correct: true, points: 1, userId: 'obcy' }), ctx());

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/progress`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }),
        body: JSON.stringify({ blockIndex: 2, answer: { selected: ['a', 'b'] } }),
      }),
    );
  });

  it('blok bez odpowiedzi: ciało zawiera tylko blockIndex; odpowiedź liczbowa (quiz) przechodzi', async () => {
    await POST(buildRequest({ blockIndex: 0 }), ctx());
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ blockIndex: 0 }));
    await POST(buildRequest({ blockIndex: 1, answer: 0 }), ctx());
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ blockIndex: 1, answer: 0 }));
  });

  describe('ochrona CSRF (jak w pozostałych trasach BFF: proxyAuthenticated)', () => {
    it('Origin obcego hosta: 403 bez wołania API', async () => {
      mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
      const response = await POST(buildRequest({ blockIndex: 0 }), ctx());
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bez Origin i bez Sec-Fetch-Site: same-origin: 403; z Sec-Fetch-Site: same-origin: przechodzi', async () => {
      mockSession('tok', { host: 'localhost:3000' });
      expect((await POST(buildRequest({ blockIndex: 0 }), ctx())).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      mockSession('tok', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
      expect((await POST(buildRequest({ blockIndex: 0 }), ctx())).status).toBe(200);
    });
  });

  it.each([
    ['courseId z kropkami', ctx('..'), { blockIndex: 0 }],
    ['courseId z ukośnikiem', ctx('a/b'), { blockIndex: 0 }],
    ['brak blockIndex', ctx(), { answer: 1 }],
    ['blockIndex jako tekst', ctx(), { blockIndex: '0' }],
    ['blockIndex ujemny', ctx(), { blockIndex: -1 }],
    ['blockIndex ułamkowy', ctx(), { blockIndex: 1.5 }],
    ['ciało nieparsowalne', ctx(), 'to nie jest json'],
    ['ciało null', ctx(), 'null'],
  ])('odrzuca: %s (400, bez wołania API)', async (_label, context, body) => {
    const response = await POST(buildRequest(body), context);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje status i body z apps/api 1:1 do klienta (sukces i błąd biznesowy)', async () => {
    const backendBody = { assignmentId: 'a1', status: 'COMPLETED', currentBlockIndex: 1, score: 100, lastResult: { blockIndex: 0, type: 'QUIZ', correct: true } };
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => backendBody });
    const ok = await POST(buildRequest({ blockIndex: 0, answer: 1 }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(backendBody);

    fetchMock.mockResolvedValueOnce({ status: 400, json: async () => ({ message: 'Bloki trzeba ukończyć po kolei' }) });
    const bad = await POST(buildRequest({ blockIndex: 3 }), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toBe('Bloki trzeba ukończyć po kolei');
  });

  it('502, gdy backend jest nieosiągalny; ciało niebędące JSON-em nie wywraca trasy', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const down = await POST(buildRequest({ blockIndex: 0 }), ctx());
    expect(down.status).toBe(502);
    expect((await down.json()).message).toMatch(/nie udało się połączyć/i);

    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    const weird = await POST(buildRequest({ blockIndex: 0 }), ctx());
    expect(weird.status).toBe(200);
    expect(await weird.json()).toBeNull();
  });
});
