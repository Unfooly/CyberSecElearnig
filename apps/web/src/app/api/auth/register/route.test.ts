import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { API_URL } from '@/lib/config';

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID = {
  firstName: 'Anna',
  lastName: 'Nowak',
  email: 'anna@acme.pl',
  organizationLegalName: 'Acme Sp. z o.o.',
  organizationName: 'Acme',
  taxId: '5260250274',
  addressLine: 'ul. Długa 5',
  postalCode: '80-001',
  city: 'Gdańsk',
  acceptTerms: true,
  acceptPrivacyPolicy: true,
};

describe('POST /api/auth/register', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('zwraca 400 bez wołania backendu, gdy brakuje któregokolwiek pola tekstowego', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(buildRequest({ ...VALID, taxId: '' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('przekazuje TYLKO allowlistę pól: hasło, rola, status i kraj z żądania nie docierają do API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ message: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(buildRequest({ ...VALID, password: 'x', role: 'SUPER_ADMIN', status: 'ACTIVE', country: 'DE' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/register`);
    expect(JSON.parse(init.body)).toEqual(VALID);
  });

  it('zgody muszą być dokładnie true (string "true" => false)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Zgoda wymagana' }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(buildRequest({ ...VALID, acceptTerms: 'true' }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).acceptTerms).toBe(false);
  });

  it('zwraca 502, gdy backend jest nieosiągalny', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await POST(buildRequest(VALID));

    expect(response.status).toBe(502);
  });

  it('normalizuje tablicę komunikatów walidacji do stringa i przekazuje kod błędu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: ['Podaj poprawny NIP.'], code: 'X' }),
      }),
    );

    const response = await POST(buildRequest(VALID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Podaj poprawny NIP.', code: 'X' });
  });

  it('przy sukcesie nie ustawia cookies i przekazuje wyłącznie komunikat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ message: 'Wysłaliśmy link.', extra: 1 }) }),
    );

    const response = await POST(buildRequest(VALID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Wysłaliśmy link.' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
