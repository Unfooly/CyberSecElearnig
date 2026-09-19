import { describe, it, expect, vi, afterEach } from 'vitest';
import { headers } from 'next/headers';
import { apiFetch } from './api-fetch';

vi.mock('next/headers', () => ({ headers: vi.fn() }));

function mockIncoming(values: Record<string, string>) {
  vi.mocked(headers).mockReturnValue({ get: (name: string) => values[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('bez TRUST_PROXY wywołuje zwykły fetch z niezmienionymi argumentami (nagłówków klienta nie przekazuje)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    mockIncoming({ 'cf-connecting-ip': '203.0.113.7' });
    const init = { method: 'POST', headers: { Authorization: 'Bearer t' } };

    await apiFetch('http://api/x', init);

    expect(fetchMock).toHaveBeenCalledWith('http://api/x', init);
  });

  it('z TRUST_PROXY=true dokłada CF-Connecting-IP klienta do nagłówków wywołania API', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    mockIncoming({ 'cf-connecting-ip': '203.0.113.7' });

    await apiFetch('http://api/x', { method: 'POST', headers: { Authorization: 'Bearer t' } });

    expect(fetchMock).toHaveBeenCalledWith('http://api/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'CF-Connecting-IP': '203.0.113.7' },
    });
  });

  it('poza zakresem żądania (headers() rzuca) działa bez nagłówka zamiast się wywrócić', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(headers).mockImplementation(() => {
      throw new Error('outside request scope');
    });

    await apiFetch('http://api/x', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledWith('http://api/x', { method: 'GET' });
  });

  it('zachowuje nagłówki podane jako Headers albo tablica par (nie gubi Authorization)', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    mockIncoming({ 'cf-connecting-ip': '203.0.113.7' });

    await apiFetch('http://api/x', { headers: new Headers({ Authorization: 'Bearer t' }) });
    await apiFetch('http://api/x', { headers: [['Authorization', 'Bearer u']] });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer t', 'CF-Connecting-IP': '203.0.113.7' });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ authorization: 'Bearer u', 'CF-Connecting-IP': '203.0.113.7' });
  });

  it('nie pozwala klientowi podać własnego nagłówka CF-Connecting-IP dalej przez init (nadpisuje go adres z żądania)', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    mockIncoming({ 'cf-connecting-ip': '203.0.113.7' });

    await apiFetch('http://api/x', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });

    expect(fetchMock.mock.calls[0][1].headers['CF-Connecting-IP']).toBe('203.0.113.7');
  });
});
