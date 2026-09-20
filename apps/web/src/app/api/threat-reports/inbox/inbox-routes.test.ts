import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { inboxQuery } from '@/lib/threat-report-routes';
import { GET as list } from './route';
import { GET as detail } from './[id]/route';
import { POST as changeStatus } from './[id]/status/route';
import { POST as addNote } from './[id]/notes/route';
import { GET as department } from '../department/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({ get: () => (token === undefined ? undefined : { name: 'access_token', value: token }) } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const getRequest = (query = '') => new NextRequest(`http://localhost:3000/api/threat-reports/inbox${query}`);
const postRequest = (body: unknown) => new NextRequest('http://localhost:3000/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = (id: string) => ({ params: { id } });

describe('BFF /api/threat-reports/inbox*', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lista i widok działu: STAŁE ścieżki API z tokenem z cookie; bez cookie 401 bez wołania API', async () => {
    await list(getRequest());
    await department(getRequest());
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_URL}/threat-reports/inbox`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_URL}/threat-reports/department`, expect.anything());

    fetchMock.mockClear();
    mockSession(undefined);
    expect((await list(getRequest())).status).toBe(401);
    expect((await department(getRequest())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zapytanie listy tylko z allowlisty: status z enumu, page/pageSize jako cyfry; reszta odrzucona', () => {
    expect(inboxQuery(getRequest('?status=THREAT&page=2&pageSize=25'))).toBe('?status=THREAT&page=2&pageSize=25');
    expect(inboxQuery(getRequest('?status=DELETE&page=abc&pageSize=1;drop&organizationId=x&foo=bar'))).toBe('');
    expect(inboxQuery(getRequest('?page=-1'))).toBe('');
    expect(inboxQuery(getRequest('?page=1234567'))).toBe('');
  });

  it('lista przekazuje przefiltrowane zapytanie', async () => {
    await list(getRequest('?status=SAFE&page=3&evil=1'));

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/threat-reports/inbox?status=SAFE&page=3`);
  });

  it('szczegóły: identyfikator przechodzi isSafeId (ścieżka stała); obcy znak => 400 bez wołania API', async () => {
    await detail(getRequest(), params('abc_123-X'));
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/threat-reports/inbox/abc_123-X`);

    fetchMock.mockClear();
    for (const id of ['../x', 'a/b', 'a b', '']) {
      expect((await detail(getRequest(), params(id))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zmiana statusu: tylko status z enumu i tylko to pole; obce pola i nieznany status odrzucone', async () => {
    await changeStatus(postRequest({ status: 'IN_REVIEW', organizationId: 'obca', kind: 'SIMULATION' }), params('r1'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/threat-reports/inbox/r1/status`);
    expect(JSON.parse(init.body)).toEqual({ status: 'IN_REVIEW' });
    fetchMock.mockClear();
    for (const body of [{ status: 'DELETED' }, {}, { status: 5 }, null]) {
      expect((await changeStatus(postRequest(body), params('r1'))).status).toBe(400);
    }
    expect((await changeStatus(postRequest({ status: 'SAFE' }), params('../x'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notatka: tylko pole note (tekst); obce pola odrzucone, nie-tekst => 400', async () => {
    await addNote(postRequest({ note: 'Sprawdzone', reportId: 'inny', actorEmail: 'x@y.pl' }), params('r1'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/threat-reports/inbox/r1/notes`);
    expect(JSON.parse(init.body)).toEqual({ note: 'Sprawdzone' });
    fetchMock.mockClear();
    expect((await addNote(postRequest({ note: { $ne: 1 } }), params('r1'))).status).toBe(400);
    expect((await addNote(postRequest({}), params('r1'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('żądania zmieniające stan z obcego Origin => 403 bez wołania API (CSRF)', async () => {
    mockSession('tok', { origin: 'https://evil.example', host: 'localhost:3000' });

    expect((await changeStatus(postRequest({ status: 'SAFE' }), params('r1'))).status).toBe(403);
    expect((await addNote(postRequest({ note: 'x' }), params('r1'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kod i status błędu z API przechodzą 1:1 (409 konflikt statusu)', async () => {
    fetchMock.mockResolvedValue({ status: 409, json: async () => ({ code: 'STATUS_CONFLICT', message: 'Zmieniony.' }) });

    const response = await changeStatus(postRequest({ status: 'SAFE' }), params('r1'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'STATUS_CONFLICT', message: 'Zmieniony.' });
  });
});
