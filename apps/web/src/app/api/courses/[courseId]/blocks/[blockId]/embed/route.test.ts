import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cookies } from 'next/headers';
import { GET } from './route';
import { API_URL } from '@/lib/config';
import { EMBED_DOCUMENT_HEADERS } from '@/lib/bff';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}
const ctx = (courseId = 'course-1', blockId = 'gra') => ({ params: { courseId, blockId } });
const request = new Request('http://localhost:3000/api/courses/course-1/blocks/gra/embed');

// Nagłówki, które MUSZĄ towarzyszyć każdemu dokumentowi embed (także stronom błędu): treść jest niezaufana i wykonuje JS.
function expectHardenedHeaders(response: Response) {
  const csp = response.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'unsafe-inline'");
  expect(csp).toContain('sandbox allow-scripts');
  expect(csp).not.toContain('allow-same-origin');
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("form-action 'none'");
  expect(csp).toContain('img-src data:');
  // Żadnej sieci: brak connect-src/img-src z hostami, brak default-src poza 'none'.
  expect(csp).not.toMatch(/https?:/);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
}

describe('GET /api/courses/[courseId]/blocks/[blockId]/embed', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ html: '<p>Gra</p><script>window.x=1</script>' }) });
    vi.stubGlobal('fetch', fetchMock);
    mockCookie('tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('sukces: sam dokument z API (bez opakowania) z pełnym zestawem nagłówków, STAŁA ścieżka API i token z ciasteczka', async () => {
    const response = await GET(request, ctx());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<p>Gra</p><script>window.x=1</script>');
    expectHardenedHeaders(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/courses/course-1/blocks/gra/embed`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('eksportowane nagłówki są jedynym źródłem prawdy: brak allow-same-origin, allow-downloads, allow-forms, allow-popups', () => {
    const csp = EMBED_DOCUMENT_HEADERS['Content-Security-Policy'];
    for (const forbidden of ['allow-same-origin', 'allow-downloads', 'allow-forms', 'allow-popups', 'allow-top-navigation', 'unsafe-eval']) {
      expect(csp).not.toContain(forbidden);
    }
  });

  it.each([
    ['brak ciasteczka', undefined, 401],
  ])('%s: statyczna strona błędu z tymi samymi nagłówkami, bez wołania API', async (_label, token, status) => {
    mockCookie(token);
    const response = await GET(request, ctx());
    expect(response.status).toBe(status);
    expectHardenedHeaders(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, 404],
    [401, 401],
    [403, 502],
    [500, 502],
  ])('błąd API %i: status %i i STATYCZNA strona błędu (treść z API nigdy nie jest odbijana), nagłówki jak dla dokumentu', async (apiStatus, status) => {
    fetchMock.mockResolvedValue({ ok: false, status: apiStatus, json: async () => ({ message: '<script>alert(1)</script>' }) });
    const response = await GET(request, ctx());
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain('Nie udało się załadować modułu.');
    expect(text).not.toContain('alert(1)');
    expectHardenedHeaders(response);
  });

  it('zły kształt odpowiedzi API (brak html albo nie tekst) to 502, bez wykonywania czegokolwiek', async () => {
    for (const body of [{}, { html: 5 }, null, { html: { x: 1 } }]) {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
      const response = await GET(request, ctx());
      expect(response.status).toBe(502);
      expectHardenedHeaders(response);
    }
  });

  it('błąd sieci: 502 bez szczegółów', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED secret-host:5432'));
    const response = await GET(request, ctx());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-host');
  });

  it.each([
    ['courseId z kropkami', ctx('..', 'gra')],
    ['blockId z ukośnikiem', ctx('course-1', 'a/b')],
    ['blockId ze znakiem zapytania', ctx('course-1', 'a?b')],
    ['pusty blockId', ctx('course-1', '')],
    ['zbyt długi blockId', ctx('course-1', 'x'.repeat(65))],
  ])('odrzuca identyfikator: %s (400 z nagłówkami dokumentu, bez wołania API)', async (_label, context) => {
    const response = await GET(request, context);
    expect(response.status).toBe(400);
    expectHardenedHeaders(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
