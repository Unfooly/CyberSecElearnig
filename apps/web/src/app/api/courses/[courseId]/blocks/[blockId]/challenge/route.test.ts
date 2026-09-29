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

const REF = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const buildRequest = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/courses/course-1/blocks/przesluchanie/challenge', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const ctx = (courseId = 'course-1', blockId = 'przesluchanie') => ({ params: { courseId, blockId } });

// Podważenie kwestii przesłuchania (D-118): BFF przekazuje wyłącznie { lineId, noteRef } na stałą ścieżkę API.
describe('POST /api/courses/[courseId]/blocks/[blockId]/challenge', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ lineId: 'kod-1', correct: false }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('woła apps/api ze STAŁĄ ścieżką, tokenem z ciasteczka i ciałem tylko z { lineId, noteRef }', async () => {
    const response = await POST(buildRequest({ lineId: 'kod-1', noteRef: REF, correct: true, organizationId: 'obca' }), ctx());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/blocks/przesluchanie/challenge`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ lineId: 'kod-1', noteRef: REF }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('obcy Origin - 403 bez wołania API; bez ciasteczka - 401', async () => {
    mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
    expect((await POST(buildRequest({ lineId: 'kod-1', noteRef: REF }), ctx())).status).toBe(403);
    mockSession(undefined);
    expect((await POST(buildRequest({ lineId: 'kod-1', noteRef: REF }), ctx())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['courseId z kropkami', ctx('..', 'przesluchanie')],
    ['blockId z ukośnikiem', ctx('course-1', 'a/b')],
  ])('odrzuca identyfikator: %s (400, bez wołania API)', async (_label, context) => {
    expect((await POST(buildRequest({ lineId: 'kod-1', noteRef: REF }), context)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['brak noteRef', { lineId: 'kod-1' }],
    ['lineId jako liczba', { lineId: 1, noteRef: REF }],
    ['zbyt długi lineId', { lineId: 'x'.repeat(65), noteRef: REF }],
    ['lineId z ukośnikiem', { lineId: '../x', noteRef: REF }],
    ['noteRef ze spacją', { lineId: 'kod-1', noteRef: 'a b' }],
    ['ciało nieparsowalne', 'nie json'],
  ])('odrzuca ciało: %s (400, bez wołania API)', async (_label, body) => {
    expect((await POST(buildRequest(body), ctx())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404, 429])('przekazuje status %i z API', async (status) => {
    fetchMock.mockResolvedValue({ status, json: async () => ({ message: 'błąd z API' }) });
    expect((await POST(buildRequest({ lineId: 'kod-1', noteRef: REF }), ctx())).status).toBe(status);
  });
});
