import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { GET as departmentsCsv } from './campaigns/[id]/departments.csv/route';
import { GET as people } from './campaigns/[id]/people/route';
import { GET as peopleCsv } from './campaigns/[id]/people.csv/route';
import { GET as getSettings } from './settings/route';
import { GET as getAudit } from './settings/audit/route';
import { POST as setPersonal } from './settings/personal-results/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({ get: () => (token === undefined ? undefined : { name: 'access_token', value: token }) } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const req = (path = '/x', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost:3000${path}`, init);
const json = (body: unknown) => req('/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = (id: string) => ({ params: { id } });

describe('BFF /api/phishing/results/*', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="wyniki.csv"' }), text: async () => 'a,b\r\n', json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('CSV: STAŁA ścieżka z tokenem z cookie, treść i Content-Disposition z API, no-store', async () => {
    const response = await departmentsCsv(req(), params('c1'));

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/phishing/results/campaigns/c1/departments.csv`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(await response.text()).toBe('a,b\r\n');
    expect(response.headers.get('content-disposition')).toContain('wyniki.csv');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('CSV osobowy: błąd API (403 PERSONAL_RESULTS_DISABLED) przechodzi jako JSON z tym samym statusem - NIGDY jako plik', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, headers: new Headers(), text: async () => '', json: async () => ({ code: 'PERSONAL_RESULTS_DISABLED' }) });

    const response = await peopleCsv(req('/x?filter=ALL'), params('c1'));

    expect(response.status).toBe(403);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('content-type')).toMatch(/json/);
    expect(await response.json()).toEqual({ code: 'PERSONAL_RESULTS_DISABLED' });
  });

  it.each(['ALL', 'PROBLEMS', 'CLICKED', 'SUBMITTED'])('filtr "%s" jest przekazywany do API', async (filter) => {
    await people(req(`/x?filter=${filter}`), params('c1'));
    await peopleCsv(req(`/x?filter=${filter}`), params('c1'));

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API_URL}/phishing/results/campaigns/c1/people?filter=${filter}`,
      `${API_URL}/phishing/results/campaigns/c1/people.csv?filter=${filter}`,
    ]);
  });

  it.each(['DROP', 'all', '1;x', 'ALL&campaignId=obca', '../x'])('nieznany filtr "%s" jest POMIJANY (nic obcego nie trafia do API)', async (filter) => {
    await people(req(`/x?filter=${encodeURIComponent(filter)}`), params('c1'));

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/phishing/results/campaigns/c1/people`);
  });

  it.each(['../users', 'a/b', 'a b', '%2e%2e', 'x?y=1', '', 'a'.repeat(65)])('identyfikator "%s" w ścieżce => 400 i API nie jest wołane', async (id) => {
    for (const call of [() => departmentsCsv(req(), params(id)), () => people(req(), params(id)), () => peopleCsv(req(), params(id))]) {
      expect((await call()).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bez cookie: 401 bez wołania API (CSV, JSON, ustawienia, audyt)', async () => {
    mockSession(undefined);

    const statuses = [(await departmentsCsv(req(), params('c1'))).status, (await peopleCsv(req(), params('c1'))).status, (await people(req(), params('c1'))).status, (await getSettings()).status, (await getAudit()).status];

    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ustawienia i audyt: STAŁE ścieżki API', async () => {
    await getSettings();
    await getAudit();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${API_URL}/phishing/results/settings`, `${API_URL}/phishing/results/settings/audit`]);
  });

  it('przełącznik: przekazuje TYLKO enabled i justification; obce pola odrzucane; zły typ => 400', async () => {
    await setPersonal(json({ enabled: true, justification: 'Uzasadnienie dłuższe niż dwadzieścia znaków', organizationId: 'obca', role: 'SUPER_ADMIN' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/phishing/results/settings/personal-results`);
    expect(JSON.parse(init.body)).toEqual({ enabled: true, justification: 'Uzasadnienie dłuższe niż dwadzieścia znaków' });

    fetchMock.mockClear();
    for (const bad of [{ enabled: 'true' }, { justification: 'x' }, { enabled: true, justification: 5 }, null]) {
      expect((await setPersonal(json(bad))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przełącznik z innego pochodzenia (CSRF) => 403 bez wołania API', async () => {
    mockSession('tok', { origin: 'https://evil.example.com', host: 'localhost:3000' });

    expect((await setPersonal(json({ enabled: false }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
