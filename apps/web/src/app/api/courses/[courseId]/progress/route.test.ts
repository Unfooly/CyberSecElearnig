import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/courses/course-1/progress', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/courses/[courseId]/progress', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ blockIndex: 0 }), { params: { courseId: 'course-1' } });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api z poprawnym, zakodowanym URL i nagłówkiem Authorization', async () => {
    mockCookie('access-token-value');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ assignmentId: 'a1', status: 'IN_PROGRESS' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await POST(buildRequest({ blockIndex: 0, answer: 1 }), {
      params: { courseId: 'course with spaces' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course%20with%20spaces/progress`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }),
        body: JSON.stringify({ blockIndex: 0, answer: 1 }),
      }),
    );
  });

  it('przekazuje status i body z apps/api 1:1 do klienta (sukces)', async () => {
    mockCookie('access-token-value');
    const backendBody = {
      assignmentId: 'a1',
      status: 'COMPLETED',
      currentBlockIndex: 1,
      score: 100,
      completedAt: '2026-01-01T00:00:00.000Z',
      lastResult: { blockIndex: 0, type: 'QUIZ', correct: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: async () => backendBody }),
    );

    const response = await POST(buildRequest({ blockIndex: 0, answer: 1 }), {
      params: { courseId: 'course-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(backendBody);
  });

  it('przekazuje status i komunikat błędu z apps/api 1:1 (np. 400 przy złej kolejności bloków)', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: async () => ({ message: 'Bloki trzeba ukończyć po kolei' }),
      }),
    );

    const response = await POST(buildRequest({ blockIndex: 3 }), { params: { courseId: 'course-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe('Bloki trzeba ukończyć po kolei');
  });

  it('zwraca 502, gdy backend jest nieosiągalny (fetch rzuca wyjątkiem)', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(buildRequest({ blockIndex: 0 }), { params: { courseId: 'course-1' } });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toMatch(/nie udało się połączyć/i);
  });

  it('nie crashuje, gdy backend zwraca ciało, które nie parsuje się jako JSON', async () => {
    mockCookie('access-token-value');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    );

    const response = await POST(buildRequest({ blockIndex: 0 }), { params: { courseId: 'course-1' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
});
