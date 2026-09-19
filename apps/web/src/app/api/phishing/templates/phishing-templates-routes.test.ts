import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/config';
import { GET as list } from './route';
import { GET as getEdits } from './edits/route';
import { POST as postPreview } from './preview/route';
import { DELETE as deleteTemplate, GET as getTemplate, PATCH as patchTemplate } from './[id]/route';
import { POST as cloneTemplate } from './[id]/clone/route';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockSession(token: string | undefined, headerValues: Record<string, string> = { origin: 'http://localhost:3000', host: 'localhost:3000' }) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (token === undefined ? undefined : { name: 'access_token', value: token }),
  } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

const jsonRequest = (method: string, body: unknown) =>
  new NextRequest('http://localhost:3000/api/x', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = (id: string) => ({ params: { id } });

describe('BFF /api/phishing/templates/*', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    mockSession('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lista: STAŁA ścieżka API z tokenem z cookie; bez cookie 401 bez wołania API', async () => {
    await list();
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/phishing/templates`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));

    fetchMock.mockClear();
    mockSession(undefined);
    expect((await list()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['../users', 'a/b', 'a b', '%2e%2e', 'x?y=1', '', 'a'.repeat(65)])('identyfikator "%s" w ścieżce => 400 i API nie jest wołane', async (id) => {
    for (const call of [
      () => getTemplate(new NextRequest('http://localhost:3000/x'), params(id)),
      () => patchTemplate(jsonRequest('PATCH', { name: 'x' }), params(id)),
      () => deleteTemplate(new NextRequest('http://localhost:3000/x', { method: 'DELETE' }), params(id)),
      () => cloneTemplate(jsonRequest('POST', {}), params(id)),
    ]) {
      expect((await call()).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCH: przekazuje TYLKO edytowalne pola (bez organizationId, key, senderDomain, sourceTemplateId)', async () => {
    await patchTemplate(
      jsonRequest('PATCH', {
        subject: 'Temat', senderName: 'Nadawca', senderLocalPart: 'hr', bodyHtml: '<a href="{{trackingLink}}">x</a>', lessonHtml: '<p>x</p>', name: 'N',
        organizationId: 'inna', key: 'kurier', senderDomain: 'evil.example.com', sourceTemplateId: 'x', bodyHtmlExtra: 'x',
      }),
      params('tpl_1'),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/phishing/templates/tpl_1`);
    expect(init.method).toBe('PATCH');
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['bodyHtml', 'lessonHtml', 'name', 'senderLocalPart', 'senderName', 'subject']);
  });

  it('PATCH bez żadnego edytowalnego pola => 400; wartości nie-tekstowe są ignorowane', async () => {
    expect((await patchTemplate(jsonRequest('PATCH', { organizationId: 'x' }), params('tpl_1'))).status).toBe(400);
    expect((await patchTemplate(jsonRequest('PATCH', { subject: { $ne: 1 } }), params('tpl_1'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DELETE 204 przechodzi bez ciała; obcy Origin dla zmieniających metod => 403', async () => {
    fetchMock.mockResolvedValue({ status: 204, json: async () => null });
    const ok = await deleteTemplate(new NextRequest('http://localhost:3000/x', { method: 'DELETE' }), params('tpl_1'));
    expect(ok.status).toBe(204);

    fetchMock.mockClear();
    mockSession('tok', { origin: 'https://evil.example.com', host: 'localhost:3000' });
    expect((await deleteTemplate(new NextRequest('http://localhost:3000/x', { method: 'DELETE' }), params('tpl_1'))).status).toBe(403);
    expect((await patchTemplate(jsonRequest('PATCH', { name: 'x' }), params('tpl_1'))).status).toBe(403);
    expect((await cloneTemplate(jsonRequest('POST', {}), params('tpl_1'))).status).toBe(403);
    expect((await postPreview(jsonRequest('POST', { bodyHtml: '<p>x</p>' }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('klon: przekazuje tylko niepustą nazwę; preview: tylko bodyHtml/lessonHtml', async () => {
    await cloneTemplate(jsonRequest('POST', { name: 'Moja kopia', organizationId: 'inna' }), params('tpl_1'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Moja kopia' });

    await cloneTemplate(jsonRequest('POST', { name: '  ' }), params('tpl_1'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({});

    await postPreview(jsonRequest('POST', { bodyHtml: '<p>x</p>', lessonHtml: '<p>y</p>', evil: 1 }));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ bodyHtml: '<p>x</p>', lessonHtml: '<p>y</p>' });

    expect((await postPreview(jsonRequest('POST', { evil: 1 }))).status).toBe(400);
  });

  it('edits: filtr templateId walidowany i kodowany; śmieciowy => 400', async () => {
    await getEdits(new NextRequest('http://localhost:3000/x?templateId=tpl_1'));
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/phishing/templates/edits?templateId=tpl_1`);

    expect((await getEdits(new NextRequest('http://localhost:3000/x?templateId=../users'))).status).toBe(400);
    await getEdits(new NextRequest('http://localhost:3000/x'));
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/phishing/templates/edits`);
  });

  it('błędy API (403 GLOBAL_TEMPLATE_READONLY) przechodzą 1:1 do UI', async () => {
    fetchMock.mockResolvedValue({ status: 403, json: async () => ({ code: 'GLOBAL_TEMPLATE_READONLY', message: 'm' }) });

    const response = await patchTemplate(jsonRequest('PATCH', { name: 'x' }), params('phishtpl_kurier'));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('GLOBAL_TEMPLATE_READONLY');
  });
});
