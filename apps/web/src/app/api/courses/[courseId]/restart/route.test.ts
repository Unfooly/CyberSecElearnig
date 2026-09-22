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

const buildRequest = () => new NextRequest('http://localhost:3000/api/courses/course-1/restart', { method: 'POST' });
const ctx = (courseId = 'course-1') => ({ params: { courseId } });

describe('POST /api/courses/[courseId]/restart', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ assignmentId: 'a2' }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('access-token-value');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockSession(undefined);
    const response = await POST(buildRequest(), ctx());
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api ze STAŁĄ ścieżką, bez ciała', async () => {
    await POST(buildRequest(), ctx());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/restart`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer access-token-value' }) }),
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('odrzuca niebezpieczny courseId (400, bez wołania API)', async () => {
    const response = await POST(buildRequest(), ctx('..'));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('ochrona CSRF (jak w pozostałych trasach BFF: proxyAuthenticated)', () => {
    it('Origin obcego hosta: 403 bez wołania API', async () => {
      mockSession('tok', { origin: 'https://sasiednia.example', host: 'localhost:3000' });
      const response = await POST(buildRequest(), ctx());
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bez Origin i bez Sec-Fetch-Site: same-origin: 403; z Sec-Fetch-Site: same-origin: przechodzi', async () => {
      mockSession('tok', { host: 'localhost:3000' });
      expect((await POST(buildRequest(), ctx())).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      mockSession('tok', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
      expect((await POST(buildRequest(), ctx())).status).toBe(200);
    });
  });

  it('przekazuje status i body z apps/api 1:1 do klienta (sukces i błąd biznesowy)', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ assignmentId: 'a2' }) });
    const ok = await POST(buildRequest(), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ assignmentId: 'a2' });

    fetchMock.mockResolvedValueOnce({ status: 409, json: async () => ({ message: 'Kurs nie jest ukończony - nie można rozpocząć go od nowa.' }) });
    const bad = await POST(buildRequest(), ctx());
    expect(bad.status).toBe(409);
    expect((await bad.json()).message).toMatch(/nie można rozpocząć/i);
  });

  it('502, gdy backend jest nieosiągalny', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const down = await POST(buildRequest(), ctx());
    expect(down.status).toBe(502);
    expect((await down.json()).message).toMatch(/nie udało się połączyć/i);
  });
});
