import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { buildAudience } from '@/lib/campaign-body';
import { GET as list, POST as create } from './route';
import { POST as audience } from './audience/route';
import { GET as getCampaign } from './[id]/route';
import { POST as cancel } from './[id]/cancel/route';
import { GET as getConfig } from '../config/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (token === undefined ? undefined : { name: 'access_token', value: token }),
  } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const jsonRequest = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = (id: string) => ({ params: { id } });

const VALID = {
  name: 'Kampania',
  templateId: 'phishtpl_kurier',
  audience: { type: 'DEPARTMENTS', departmentIds: ['d1', 'd2'] },
  windowStart: '2027-01-01T08:00:00.000Z',
  windowEnd: '2027-01-01T16:00:00.000Z',
  acknowledged: true,
};

describe('BFF /api/phishing/campaigns/*', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lista i konfiguracja: STAŁE ścieżki API z tokenem z cookie; bez cookie 401 bez wołania API', async () => {
    await list();
    await getConfig();
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_URL}/phishing/campaigns`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_URL}/phishing/config`, expect.anything());

    fetchMock.mockClear();
    mockSession(undefined);
    expect((await list()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST kampanii: przekazuje TYLKO dozwolone pola (obce pola typu organizationId są odrzucane)', async () => {
    await create(jsonRequest({ ...VALID, organizationId: 'obca', createdByEmail: 'x@x.pl', status: 'COMPLETED' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/phishing/campaigns`);
    expect(JSON.parse(init.body)).toEqual(VALID);
  });

  it.each([
    ['brak potwierdzenia', { acknowledged: false }],
    ['potwierdzenie jako tekst', { acknowledged: 'true' }],
    ['identyfikator szablonu ze ścieżką', { templateId: '../x' }],
    ['identyfikator działu ze znakiem specjalnym', { audience: { type: 'DEPARTMENTS', departmentIds: ['a/b'] } }],
    ['nieznany typ grona', { audience: { type: 'EVERYONE' } }],
    ['brak grona', { audience: undefined }],
    ['daty nie jako tekst', { windowStart: 123 }],
    ['nazwa nie jako tekst', { name: { a: 1 } }],
  ])('POST kampanii: %s => 400 i API nie jest wołane', async (_label, override) => {
    const response = await create(jsonRequest({ ...VALID, ...override }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST z innego pochodzenia (CSRF) => 403 bez wołania API; nieczytelne ciało => 400', async () => {
    mockSession('tok', { origin: 'https://evil.example.com', host: 'localhost:3000' });
    expect((await create(jsonRequest(VALID))).status).toBe(403);
    expect((await cancel(jsonRequest({}), params('c1'))).status).toBe(403);
    expect((await audience(jsonRequest({ audience: { type: 'ALL' } }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    mockSession('tok');
    expect((await create(new NextRequest('http://localhost:3000/x', { method: 'POST', body: 'nie-json' }))).status).toBe(400);
  });

  it('audience: przekazuje tylko poprawne grono; śmieci => 400', async () => {
    await audience(jsonRequest({ audience: { type: 'USERS', userIds: ['u1'], extra: 'x' }, organizationId: 'obca' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ audience: { type: 'USERS', userIds: ['u1'] } });

    fetchMock.mockClear();
    expect((await audience(jsonRequest({ audience: { type: 'USERS', userIds: ['u1', '../x'] } }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['../users', 'a/b', 'a b', '%2e%2e', 'x?y=1', '', 'a'.repeat(65)])('identyfikator "%s" w ścieżce => 400 i API nie jest wołane', async (id) => {
    expect((await getCampaign(new NextRequest('http://localhost:3000/x'), params(id))).status).toBe(400);
    expect((await cancel(jsonRequest({}), params(id))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('szczegóły i anulowanie wołają STAŁE ścieżki z poprawnym identyfikatorem', async () => {
    await getCampaign(new NextRequest('http://localhost:3000/x'), params('c1'));
    await cancel(jsonRequest({}), params('c1'));

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_URL}/phishing/campaigns/c1`, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_URL}/phishing/campaigns/c1/cancel`, expect.objectContaining({ method: 'POST' }));
  });

  it('błąd biznesowy API (np. TRANSPORT_NOT_CONFIGURED) przechodzi 1:1 razem ze statusem', async () => {
    fetchMock.mockResolvedValue({ status: 409, json: async () => ({ code: 'TRANSPORT_NOT_CONFIGURED', message: 'x' }) });

    const response = await create(jsonRequest(VALID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'TRANSPORT_NOT_CONFIGURED', message: 'x' });
  });
});

describe('buildAudience', () => {
  it('ALL bez list; DEPARTMENTS/USERS z listami identyfikatorów; nadmiarowe pola pomijane', () => {
    expect(buildAudience({ type: 'ALL', junk: 1 })).toEqual({ type: 'ALL' });
    expect(buildAudience({ type: 'DEPARTMENTS', departmentIds: ['d1'] })).toEqual({ type: 'DEPARTMENTS', departmentIds: ['d1'] });
    expect(buildAudience({ type: 'USERS', userIds: [] })).toEqual({ type: 'USERS', userIds: [] }); // pustą listę odrzuci API (INVALID_AUDIENCE)
  });

  it('nieprawidłowe: brak/zły typ, lista nie-tablicą, niebezpieczny identyfikator => null', () => {
    for (const input of [null, undefined, {}, { type: 'X' }, { type: 'USERS', userIds: 'u1' }, { type: 'USERS', userIds: ['../x'] }, { type: 'DEPARTMENTS', departmentIds: [1] }]) {
      expect(buildAudience(input)).toBeNull();
    }
  });
});
