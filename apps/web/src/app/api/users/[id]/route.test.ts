import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { PATCH, DELETE } from './route';
import { API_URL } from '@/lib/config';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('PATCH /api/users/[id]', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/users/u1', { method: 'PATCH', body: '{}' }),
      { params: { id: 'u1' } },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('woła apps/api pod poprawnym id z Bearer tokenem', async () => {
    mockCookie('token-a');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ id: 'u1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await PATCH(
      new NextRequest('http://localhost:3000/api/users/u1', {
        method: 'PATCH',
        body: JSON.stringify({ firstName: 'Jan' }),
      }),
      { params: { id: 'u1' } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/u1`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );
  });
});

describe('DELETE /api/users/[id]', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(new NextRequest('http://localhost:3000/api/users/u1', { method: 'DELETE' }), {
      params: { id: 'u1' },
    });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje 204 od apps/api bez próby parsowania JSON body', async () => {
    mockCookie('token-a');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, json: async () => null }));

    const response = await DELETE(new NextRequest('http://localhost:3000/api/users/u1', { method: 'DELETE' }), {
      params: { id: 'u1' },
    });

    expect(response.status).toBe(204);
  });
});
