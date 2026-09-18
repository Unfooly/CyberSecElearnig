import { describe, it, expect, vi, afterEach } from 'vitest';
import { cookies } from 'next/headers';
import { GET } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('GET /api/users/departments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api z Bearer tokenem i przekazuje dane 1:1', async () => {
    mockCookie('token-a');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: async () => [{ id: 'd1', name: 'IT' }] }),
    );

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{ id: 'd1', name: 'IT' }]);
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('token-a');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
