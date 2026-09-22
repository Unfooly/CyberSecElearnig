// @vitest-environment node
// Środowisko node: FormData/File z Node (undici) serializują się do multipart (podgląd importu); FormData z jsdom nie.
/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

// Ochrona przed CSRF w BFF (B-080): KAŻDA trasa zmieniająca stan (POST/PATCH/DELETE/PUT) w apps/web/src/app/api musi odrzucać żądania
// bez własnego Origin: obcy Origin => 403, brak Origin i Sec-Fetch-Site => 403 (fail-closed), własny Origin albo Sec-Fetch-Site: same-origin =>
// żądanie idzie dalej. Ta sama reguła co w proxyAuthenticated (lib/bff.ts), bez drugiej. SameSite=Lax nie chroni przed żądaniami z sąsiedniej
// subdomeny (ta sama domena rejestrowalna), stąd kontrola nagłówków.
//
// Test SAM PILNUJE KOMPLETNOŚCI: skanuje pliki tras i wymaga, żeby każda trasa zmieniająca stan była albo w tabeli PROTECTED (sprawdzana
// tutaj), albo na jawnej liście PUBLIC (trasy bez sesji do nadużycia; ich ocena to B-081). Nowa trasa POST/PATCH/DELETE bez wpisu = czerwony test.

const sources = import.meta.glob('./**/route.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const loaders = import.meta.glob('./**/route.ts') as Record<string, () => Promise<Record<string, (request: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>>>>;

const csv = () => new File(['email;imie;nazwisko\na@b.pl;A;B'], 'pracownicy.csv', { type: 'text/csv' });

interface Row {
  route: string;
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  params?: Record<string, string>;
  body?: unknown;
  /** Podgląd importu: multipart z plikiem. */
  file?: boolean;
  /** Trasa może zakończyć się sukcesem bez wołania API (np. wylogowanie bez refresh tokena). */
  optionalFetch?: boolean;
}

const PROTECTED: Row[] = [
  // Kursy (PR 2)
  { route: './courses/[courseId]/progress/route.ts', method: 'POST', params: { courseId: 'c1' }, body: { blockIndex: 0 } },
  { route: './courses/[courseId]/blocks/[blockId]/attempt/route.ts', method: 'POST', params: { courseId: 'c1', blockId: 'b1' }, body: { answer: 'x' } },
  // Katalog kursów (D-065, hotfix widoczności zaimportowanego kursu)
  { route: './courses/[courseId]/self-assign/route.ts', method: 'POST', params: { courseId: 'c1' } },
  // "Rozpocznij od nowa" (D-069)
  { route: './courses/[courseId]/restart/route.ts', method: 'POST', params: { courseId: 'c1' } },
  // Pracownicy i konto (B-080)
  { route: './users/route.ts', method: 'POST', body: { email: 'a@b.pl', firstName: 'A', lastName: 'B', role: 'EMPLOYEE' } },
  { route: './users/[id]/route.ts', method: 'PATCH', params: { id: 'u1' }, body: { firstName: 'A' } },
  { route: './users/[id]/route.ts', method: 'DELETE', params: { id: 'u1' } },
  { route: './users/[id]/resend-invite/route.ts', method: 'POST', params: { id: 'u1' } },
  { route: './users/me/avatar/route.ts', method: 'PATCH', body: { avatarUrl: 'preset:owl' } },
  // Własne zdjęcie (D-067): wgranie (multipart) i usunięcie.
  { route: './users/me/avatar/image/route.ts', method: 'POST', file: true },
  { route: './users/me/avatar/image/route.ts', method: 'DELETE' },
  { route: './users/me/preferences/route.ts', method: 'PATCH', body: { narrationEnabled: false } },
  // Import pracowników
  { route: './users/import/preview/route.ts', method: 'POST', file: true },
  { route: './users/import/[id]/route.ts', method: 'DELETE', params: { id: 'i1' } },
  { route: './users/import/[id]/confirm/route.ts', method: 'POST', params: { id: 'i1' } },
  { route: './users/import/[id]/stop/route.ts', method: 'POST', params: { id: 'i1' } },
  // Zgłoszenia zagrożeń
  { route: './threat-reports/route.ts', method: 'POST', body: { sender: 'a@b.pl', subject: 'Temat' } },
  { route: './threat-reports/inbox/[id]/notes/route.ts', method: 'POST', params: { id: 'r1' }, body: { note: 'x' } },
  { route: './threat-reports/inbox/[id]/status/route.ts', method: 'POST', params: { id: 'r1' }, body: { status: 'SAFE' } },
  // Panel operatora: partnerzy i przypisanie organizacji klienckich (D-069)
  { route: './resellers/route.ts', method: 'POST', body: { name: 'Partner', adminEmail: 'a@b.pl', adminFirstName: 'A', adminLastName: 'B' } },
  { route: './resellers/[id]/organizations/route.ts', method: 'POST', params: { id: 'r1' }, body: { organizationId: 'o1' } },
  { route: './resellers/[id]/organizations/[organizationId]/route.ts', method: 'DELETE', params: { id: 'r1', organizationId: 'o1' } },
  // Organizacja
  { route: './organization/domain/check/route.ts', method: 'POST', body: {} },
  { route: './organization/settings/route.ts', method: 'PATCH', body: { selfJoinEnabled: true } },
  // Symulacje phishingowe
  { route: './phishing/campaigns/route.ts', method: 'POST', body: {
    name: 'Kampania',
    templateId: 'phishtpl_kurier',
    audience: { type: 'DEPARTMENTS', departmentIds: ['d1'] },
    windowStart: '2027-01-01T08:00:00.000Z',
    windowEnd: '2027-01-01T16:00:00.000Z',
    acknowledged: true,
  } },
  { route: './phishing/campaigns/audience/route.ts', method: 'POST', body: { audience: { type: 'DEPARTMENTS', departmentIds: ['d1'] } } },
  { route: './phishing/campaigns/[id]/cancel/route.ts', method: 'POST', params: { id: 'k1' } },
  { route: './phishing/results/settings/personal-results/route.ts', method: 'POST', body: { enabled: true } },
  { route: './phishing/templates/preview/route.ts', method: 'POST', body: { subject: 'x', bodyHtml: '<p>x</p>', landingHtml: '<p>x</p>' } },
  { route: './phishing/templates/[id]/clone/route.ts', method: 'POST', params: { id: 't1' }, body: {} },
  { route: './phishing/templates/[id]/route.ts', method: 'PATCH', params: { id: 't1' }, body: { name: 'x' } },
  { route: './phishing/templates/[id]/route.ts', method: 'DELETE', params: { id: 't1' } },
  // Wylogowanie (własna kontrola origin na początku handlera)
  // logout bez refresh tokena w ciasteczkach tylko czyści sesję (nie woła API), więc dla niego nie wymagamy wywołania fetch.
  { route: './auth/logout/route.ts', method: 'POST', optionalFetch: true },
  { route: './auth/logout-all/route.ts', method: 'POST' },
];

// Trasy BEZ sesji (nie ma czego nadużyć przez CSRF; login CSRF, spam i limity: B-081). Publiczne linki symulacji (t/*) muszą działać z zewnątrz.
const PUBLIC = [
  './auth/login/route.ts#POST',
  './auth/register/route.ts#POST',
  './auth/forgot-password/route.ts#POST',
  './auth/reset-password/route.ts#POST',
  './auth/verify-email/route.ts#POST',
  './auth/claim-registration/route.ts#POST',
  './auth/resend-verification/route.ts#POST',
  './demo-request/route.ts#POST',
  './t/[token]/view/route.ts#POST',
  './t/[token]/submit/route.ts#POST',
];

const key = (row: Row) => `${row.route}#${row.method}`;

function mockSession(headerValues: Record<string, string>) {
  vi.mocked(cookies).mockReturnValue({
    get: (name: string) => (name === 'access_token' ? { name, value: 'tok' } : undefined),
    // Wylogowanie czyści ciasteczka po udanym żądaniu.
    set: vi.fn(),
    delete: vi.fn(),
  } as unknown as ReturnType<typeof cookies>);
  vi.mocked(headers).mockReturnValue({ get: (name: string) => headerValues[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

function buildRequest(row: Row): NextRequest {
  const url = 'http://localhost:3000/api/x';
  if (row.file) {
    const form = new FormData();
    form.append('file', csv());
    return new NextRequest(url, { method: row.method, body: form });
  }
  if (row.body === undefined) return new NextRequest(url, { method: row.method });
  return new NextRequest(url, { method: row.method, body: JSON.stringify(row.body), headers: { 'Content-Type': 'application/json' } });
}

async function call(row: Row): Promise<Response> {
  const handlers = await loaders[row.route]();
  return handlers[row.method](buildRequest(row), { params: row.params ?? {} });
}

describe('BFF: kontrola same-origin w KAŻDEJ trasie zmieniającej stan (B-080)', () => {
  const fetchMock = vi.fn();
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockClear();
  });

  it('kompletność: każda trasa POST/PATCH/DELETE/PUT jest w tabeli PROTECTED albo na liście PUBLIC (nowa trasa bez wpisu = błąd)', () => {
    const found = new Set<string>();
    for (const [route, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/export\s+async\s+function\s+(POST|PATCH|DELETE|PUT)\b/g)) found.add(`${route}#${match[1]}`);
      // Inne formy eksportu handlera (const/let/var, `export { POST }`, re-eksport) nie są obsługiwane przez ten skan: wymagamy zamiast tego,
      // żeby ich nie było, inaczej nowa niechroniona trasa przeszłaby test kompletności bez wpisu.
      expect(source, `${route}: handler zmieniający stan musi być zapisany jako "export async function"`).not.toMatch(
        /export\s+(?:const|let|var)\s+(?:POST|PATCH|DELETE|PUT)\b|export\s*\{[^}]*\b(?:POST|PATCH|DELETE|PUT)\b[^}]*\}/,
      );
    }
    const covered = new Set([...PROTECTED.map(key), ...PUBLIC]);
    expect([...found].filter((entry) => !covered.has(entry)).sort()).toEqual([]);
    // Wpisy tabel wskazują istniejące handlery (literówka w ścieżce nie może po cichu wyłączyć sprawdzenia).
    expect([...covered].filter((entry) => !found.has(entry)).sort()).toEqual([]);
  });

  describe.each(PROTECTED.map((row) => [key(row), row] as const))('%s', (_name, row) => {
    it('obcy Origin: 403, API nie jest wołane', async () => {
      mockSession({ origin: 'https://sasiednia-subdomena.example', host: 'localhost:3000' });
      const response = await call(row);
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bez Origin i bez Sec-Fetch-Site: 403 (fail-closed), API nie jest wołane', async () => {
      mockSession({ host: 'localhost:3000' });
      const response = await call(row);
      expect(response.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('własny Origin: żądanie idzie dalej (nie 403); Sec-Fetch-Site: same-origin bez Origin też', async () => {
      mockSession({ origin: 'http://localhost:3000', host: 'localhost:3000' });
      const response = await call(row);
      expect(response.status, `odpowiedź: ${await response.clone().text()}`).not.toBe(403);
      if (!row.optionalFetch) expect(fetchMock, `status ${response.status}: ${await response.clone().text()}`).toHaveBeenCalled();

      fetchMock.mockClear();
      mockSession({ host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
      expect((await call(row)).status).not.toBe(403);
      if (!row.optionalFetch) expect(fetchMock).toHaveBeenCalled();
    });
  });
});
