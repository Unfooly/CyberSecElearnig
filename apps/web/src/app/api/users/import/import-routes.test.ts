// @vitest-environment node
// Środowisko node: FormData/File z Node (undici) serializują się do multipart; FormData z jsdom nie.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { importRowsQuery } from '@/lib/import-routes';
import { POST as preview } from './preview/route';
import { GET as latest } from './latest/route';
import { GET as detail, DELETE as cancel } from './[id]/route';
import { GET as rows } from './[id]/rows/route';
import { POST as confirm } from './[id]/confirm/route';
import { POST as stop } from './[id]/stop/route';
import { GET as report } from './[id]/report/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({ get: () => (token === undefined ? undefined : { name: 'access_token', value: token }) } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const getRequest = (query = '') => new NextRequest(`http://localhost:3000/api/users/import/x${query}`);
const params = (id: string) => ({ params: { id } });

function previewRequest(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return new NextRequest('http://localhost:3000/api/users/import/preview', { method: 'POST', body: form });
}
const csvFile = () => new File(['email;imie;nazwisko\r\na@firma.pl;A;B\r\n'], 'ludzie.csv', { type: 'text/csv' });

describe('BFF /api/users/import*', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, ok: true, headers: new Headers(), json: async () => ({ ok: true }), text: async () => 'csv', arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('trasy odczytu: STAŁE ścieżki API z tokenem z cookie; bez cookie 401 bez wołania API', async () => {
    await latest();
    await detail(getRequest(), params('b1'));
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_URL}/users/import/latest`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_URL}/users/import/b1`, expect.anything());

    fetchMock.mockClear();
    mockSession(undefined);
    expect((await latest()).status).toBe(401);
    expect((await detail(getRequest(), params('b1'))).status).toBe(401);
    expect((await rows(getRequest(), params('b1'))).status).toBe(401);
    expect((await report(getRequest(), params('b1'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identyfikator partii przechodzi isSafeId; obcy znak => 400 bez wołania API (wszystkie trasy)', async () => {
    for (const id of ['../x', 'a/b', 'a b', '']) {
      expect((await detail(getRequest(), params(id))).status).toBe(400);
      expect((await cancel(getRequest(), params(id))).status).toBe(400);
      expect((await rows(getRequest(), params(id))).status).toBe(400);
      expect((await confirm(getRequest(), params(id))).status).toBe(400);
      expect((await stop(getRequest(), params(id))).status).toBe(400);
      expect((await report(getRequest(), params(id))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('potwierdzenie, zatrzymanie i anulowanie: właściwe metody i stałe ścieżki, bez ciała', async () => {
    await confirm(getRequest(), params('b1'));
    await stop(getRequest(), params('b1'));
    await cancel(getRequest(), params('b1'));

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [`${API_URL}/users/import/b1/confirm`, 'POST', undefined],
      [`${API_URL}/users/import/b1/stop`, 'POST', undefined],
      [`${API_URL}/users/import/b1`, 'DELETE', undefined],
    ]);
  });

  it('zapytanie wierszy tylko z allowlisty: status z enumu, page/pageSize jako cyfry; reszta odrzucona', async () => {
    expect(importRowsQuery(getRequest('?status=ERROR&page=2&pageSize=50'))).toBe('?status=ERROR&page=2&pageSize=50');
    expect(importRowsQuery(getRequest('?status=DROP&page=abc&pageSize=1;x&organizationId=o&foo=bar'))).toBe('');
    expect(importRowsQuery(getRequest('?page=12345'))).toBe('');

    await rows(getRequest('?status=VALID&evil=1'), params('b1'));
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/users/import/b1/rows?status=VALID`);
  });

  it('raport CSV: stała ścieżka report.csv', async () => {
    await report(getRequest(), params('b1'));

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/users/import/b1/report.csv`);
  });

  it('żądania zmieniające stan z obcego Origin => 403 bez wołania API (CSRF), także podgląd z plikiem', async () => {
    mockSession('tok', { origin: 'https://evil.example', host: 'localhost:3000' });

    expect((await confirm(getRequest(), params('b1'))).status).toBe(403);
    expect((await stop(getRequest(), params('b1'))).status).toBe(403);
    expect((await cancel(getRequest(), params('b1'))).status).toBe(403);
    expect((await preview(previewRequest({ file: csvFile() }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('podgląd: przekazuje TYLKO pole file (obce pola odrzucone), token z cookie, status i JSON 1:1', async () => {
    fetchMock.mockResolvedValue({ status: 422, json: async () => ({ message: 'Zły plik.' }) });

    const response = await preview(previewRequest({ file: csvFile(), organizationId: 'obca', note: 'x' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/users/import/preview`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const sent = init.body as FormData;
    expect([...sent.keys()]).toEqual(['file']);
    expect((sent.get('file') as File).name).toBe('ludzie.csv');
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: 'Zły plik.' });
  });

  it('podgląd: brak cookie 401, brak pliku (albo pole tekstowe zamiast pliku) 400 - bez wołania API', async () => {
    expect((await preview(previewRequest({ file: 'tekst' }))).status).toBe(400);
    expect((await preview(previewRequest({ inne: 'x' }))).status).toBe(400);
    mockSession(undefined);
    expect((await preview(previewRequest({ file: csvFile() }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('podgląd: awaria sieci => 502', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await preview(previewRequest({ file: csvFile() }))).status).toBe(502);
  });

  it('kod i status błędu z API przechodzą 1:1 (409 SEAT_LIMIT)', async () => {
    fetchMock.mockResolvedValue({ status: 409, json: async () => ({ code: 'SEAT_LIMIT', seatsMissing: 3 }) });

    const response = await confirm(getRequest(), params('b1'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'SEAT_LIMIT', seatsMissing: 3 });
  });
});
