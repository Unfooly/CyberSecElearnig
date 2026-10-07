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
  new NextRequest('http://localhost:3000/api/courses/course-1/blocks/wiadomosci/check', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const ctx = (courseId = 'course-1', blockId = 'wiadomosci') => ({ params: { courseId, blockId } });

// Ocena kliknięcia (D-132): BFF przekazuje wyłącznie { option } albo { card, verdict } na stałą ścieżkę API.
describe('POST /api/courses/[courseId]/blocks/[blockId]/check', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: 'good', feedback: 'Dobrze.', done: false }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('karta: STAŁA ścieżka, token z ciasteczka, ciało tylko { card, verdict }', async () => {
    const response = await POST(buildRequest({ card: 'a1b2c3', verdict: 'suspicious', correct: true }), ctx());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/blocks/wiadomosci/check`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ card: 'a1b2c3', verdict: 'suspicious' }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('wybór: ciało tylko { option }', async () => {
    await POST(buildRequest({ option: 2, verdict: 'ok' }), ctx('course-1', 'wybor'));
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/courses/course-1/blocks/wybor/check`, expect.objectContaining({ body: JSON.stringify({ option: 2 }) }));
  });

  it('obcy Origin - 403 bez wołania API; bez ciasteczka - 401', async () => {
    mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
    expect((await POST(buildRequest({ option: 1 }), ctx())).status).toBe(403);
    mockSession(undefined);
    expect((await POST(buildRequest({ option: 1 }), ctx())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['brak ciała', 'nie-json'],
    ['oba warianty naraz', { option: 1, card: 'a1', verdict: 'ok' }],
    ['ani jeden', {}],
    ['zły werdykt', { card: 'a1', verdict: 'moze' }],
    ['karta z niebezpiecznym id', { card: '../x', verdict: 'ok' }],
    ['indeks poza zakresem', { option: 9 }],
    ['indeks niecałkowity', { option: 1.5 }],
  ])('%s - 400 bez wołania API', async (_label, body) => {
    expect((await POST(buildRequest(body), ctx())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('niebezpieczny identyfikator w ścieżce - 400', async () => {
    expect((await POST(buildRequest({ option: 1 }), ctx('../x'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
