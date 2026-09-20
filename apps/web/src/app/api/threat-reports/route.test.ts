import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { POST } from './route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (token === undefined ? undefined : { name: 'access_token', value: token }),
  } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const jsonRequest = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/threat-reports', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('BFF POST /api/threat-reports', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 201, json: async () => ({ id: 'r1', isSimulation: false }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('przekazuje TYLKO dozwolone pola na STAŁĄ ścieżkę API z tokenem z cookie (obce pola są odrzucane)', async () => {
    const response = await POST(jsonRequest({ sender: 'a@b.pl', subject: 'Temat', body: 'treść', headers: 'h', comment: 'k', organizationId: 'obca', kind: 'SIMULATION', reporterUserId: 'x' }));

    expect(response.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/threat-reports`);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ sender: 'a@b.pl', subject: 'Temat', body: 'treść', headers: 'h', comment: 'k' });
  });

  it('pomija puste pola opcjonalne', async () => {
    await POST(jsonRequest({ sender: 'a@b.pl', subject: 'Temat', body: '', headers: '', comment: '' }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sender: 'a@b.pl', subject: 'Temat' });
  });

  it.each([
    ['brak nadawcy', { subject: 'x' }],
    ['brak tematu', { sender: 'x' }],
    ['nadawca jako liczba', { sender: 1, subject: 'x' }],
    ['treść jako obiekt', { sender: 'a', subject: 'x', body: { $ne: 1 } }],
    ['komentarz jako tablica', { sender: 'a', subject: 'x', comment: ['a'] }],
  ])('400 bez wołania API: %s', async (_label, body) => {
    expect((await POST(jsonRequest(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 dla ciała niebędącego JSON-em', async () => {
    const request = new NextRequest('http://localhost:3000/api/threat-reports', { method: 'POST', body: 'nie-json' });

    expect((await POST(request)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 bez cookie i 403 dla żądania z obcego Origin - bez wołania API', async () => {
    mockSession(undefined);
    expect((await POST(jsonRequest({ sender: 'a', subject: 'b' }))).status).toBe(401);

    mockSession('tok', { origin: 'https://evil.example', host: 'localhost:3000' });
    expect((await POST(jsonRequest({ sender: 'a', subject: 'b' }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje kod i status błędu z API (limit zgłoszeń 429)', async () => {
    fetchMock.mockResolvedValue({ status: 429, json: async () => ({ code: 'REPORT_RATE_LIMIT', message: 'Limit.' }) });

    const response = await POST(jsonRequest({ sender: 'a', subject: 'b' }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'REPORT_RATE_LIMIT', message: 'Limit.' });
  });
});
