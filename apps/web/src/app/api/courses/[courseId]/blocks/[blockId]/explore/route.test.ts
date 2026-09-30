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
  new NextRequest('http://localhost:3000/api/courses/course-1/blocks/scena/explore', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const ctx = (courseId = 'course-1', blockId = 'scena') => ({ params: { courseId, blockId } });

// Stan częściowy sceny (D-128): BFF przekazuje wyłącznie { visited, noted } na stałą ścieżkę API.
describe('POST /api/courses/[courseId]/blocks/[blockId]/explore', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ blockId: 'scena', visited: ['h1'], noted: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('woła apps/api ze STAŁĄ ścieżką, tokenem z ciasteczka i ciałem tylko z { visited, noted }', async () => {
    const response = await POST(buildRequest({ visited: ['h1', 'h4-outlook'], noted: ['h1'], done: true, organizationId: 'obca' }), ctx());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/blocks/scena/explore`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ visited: ['h1', 'h4-outlook'], noted: ['h1'] }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('obcy Origin - 403 bez wołania API; bez ciasteczka - 401', async () => {
    mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
    expect((await POST(buildRequest({ visited: ['h1'], noted: [] }), ctx())).status).toBe(403);
    mockSession(undefined);
    expect((await POST(buildRequest({ visited: ['h1'], noted: [] }), ctx())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['brak ciała', 'nie-json'],
    ['brak noted', { visited: ['h1'] }],
    ['visited nie jest listą', { visited: 'h1', noted: [] }],
    ['id z ukośnikiem', { visited: ['../x'], noted: [] }],
    ['id nie jest napisem', { visited: [1], noted: [] }],
    ['za długa lista', { visited: Array.from({ length: 51 }, (_, i) => `x${i}`), noted: [] }],
  ])('nieprawidłowe ciało (%s) - 400 bez wołania API', async (_name, body) => {
    expect((await POST(buildRequest(body), ctx())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nieprawidłowy identyfikator kursu albo bloku - 400 bez wołania API', async () => {
    expect((await POST(buildRequest({ visited: [], noted: [] }), ctx('../x'))).status).toBe(400);
    expect((await POST(buildRequest({ visited: [], noted: [] }), ctx('course-1', 'a/b'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('status API przechodzi 1:1 (np. 400 - blok nie jest bieżący)', async () => {
    fetchMock.mockResolvedValue({ status: 400, json: async () => ({ message: 'Bloki trzeba ukończyć po kolei' }) });
    expect((await POST(buildRequest({ visited: ['h1'], noted: [] }), ctx())).status).toBe(400);
  });
});
