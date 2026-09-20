import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { DEFAULT_LESSON_HTML } from '@/lib/tracking';
import { POST as view } from './[token]/view/route';
import { POST as submit } from './[token]/submit/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

const TOKEN = 'A'.repeat(43);

function mockHeaders(values: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(headers).mockReturnValue({ get: (name: string) => values[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

// Żądanie, którego ciało wybucha przy próbie odczytu: BFF nie może go czytać.
function requestWithSecretBody() {
  const request = new NextRequest('http://localhost:3000/api/t/x/submit', { method: 'POST', body: JSON.stringify({ password: 'SEKRET-123' }), headers: { 'Content-Type': 'application/json' } });
  const json = vi.spyOn(request, 'json');
  const text = vi.spyOn(request, 'text');
  const formData = vi.spyOn(request, 'formData');
  return { request, spies: [json, text, formData] };
}

describe('BFF /api/t/[token]/(view|submit)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ lessonHtml: '<p>Lekcja</p>', wewnetrzne: 'pole-poza-kontraktem' }) });
    vi.stubGlobal('fetch', fetchMock);
    mockHeaders();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['view', view],
    ['submit', submit],
  ])('%s: woła STAŁĄ ścieżkę API BEZ ciała i BEZ cookie/Authorization, zwraca tylko lessonHtml i no-store', async (kind, handler) => {
    const { request, spies } = requestWithSecretBody();

    const response = await handler(request, { params: { token: TOKEN } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/t/${TOKEN}/${kind}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization|cookie/i);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled(); // ciało żądania nigdy nie jest czytane
    expect(await response.json()).toEqual({ lessonHtml: '<p>Lekcja</p>' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['', 'krotki', 'A'.repeat(44), `${'A'.repeat(42)}!`, '..%2F..', 'ą'.repeat(43), 'A'.repeat(42) + '/'])(
    'token "%s" o złym formacie: ta sama lekcja domyślna co dla nieznanego tokenu, API NIE jest wołane',
    async (token) => {
      const responses = [await view(new NextRequest('http://localhost:3000/x', { method: 'POST' }), { params: { token } }), await submit(new NextRequest('http://localhost:3000/x', { method: 'POST' }), { params: { token } })];

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ lessonHtml: DEFAULT_LESSON_HTML });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('żądanie z innego pochodzenia (CSRF) => 403 bez wołania API', async () => {
    mockHeaders({ origin: 'https://evil.example.com', host: 'localhost:3000' });

    expect((await view(new NextRequest('http://localhost:3000/x', { method: 'POST' }), { params: { token: TOKEN } })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('awaria API => 502, limit => 429; bez treści z API i bez logowania tokenu', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const call = () => view(new NextRequest('http://localhost:3000/x', { method: 'POST' }), { params: { token: TOKEN } });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'wewnętrzny błąd z tokenem' }) });
    const serverError = await call();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    const limited = await call();
    fetchMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED /t/${TOKEN}/view`));
    const unreachable = await call();

    expect([serverError.status, limited.status, unreachable.status]).toEqual([502, 429, 502]);
    expect(JSON.stringify(await serverError.json())).not.toContain('wewnętrzny');
    for (const spy of [errorSpy, warnSpy, logSpy]) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });

  it('nieoczekiwany kształt odpowiedzi API => lekcja domyślna (nie przepuszczamy obcych danych)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ email: 'ofiara@firma.pl' }) });

    const response = await view(new NextRequest('http://localhost:3000/x', { method: 'POST' }), { params: { token: TOKEN } });

    expect(await response.json()).toEqual({ lessonHtml: DEFAULT_LESSON_HTML });
  });
});
