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

// jsdom (środowisko testowe) nie koduje poprawnie multipart/form-data dla
// body typu FormData w konstruktorze Request/NextRequest (realny problem
// jsdom, nie tego route'a - w prawdziwym Next.js/undici działa poprawnie).
// Obchodzimy to podmieniając request.formData() bezpośrednio, zamiast polegać
// na (nie)działającym kodowaniu wire-format w tym środowisku.
function buildFileRequest(): NextRequest {
  const form = new FormData();
  form.append('file', new File(['email,firstName,lastName\n'], 'import.csv', { type: 'text/csv' }));
  const request = new NextRequest('http://localhost:3000/api/users/import-csv', { method: 'POST' });
  request.formData = async () => form;
  return request;
}

describe('POST /api/users/import-csv', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 401 bez wołania backendu, gdy brak cookie access_token', async () => {
    mockCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildFileRequest());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zwraca 400 bez wołania backendu, gdy żądanie nie ma pliku', async () => {
    mockCookie('token-a');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/users/import-csv', { method: 'POST' });
    request.formData = async () => new FormData();
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje plik do apps/api jako nowy multipart FormData z Bearer tokenem', async () => {
    mockCookie('token-a');
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ successCount: 1, failedCount: 0, errors: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(buildFileRequest());

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/users/import-csv`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
        body: expect.any(FormData),
      }),
    );
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    mockCookie('token-a');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    const response = await POST(buildFileRequest());

    expect(response.status).toBe(502);
  });
});
