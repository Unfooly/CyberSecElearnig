import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { apiFetch } from '@/lib/api-fetch';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';

/**
 * Fail-closed: żądanie musi mieć Origin zgodny z hostem aplikacji albo
 * Sec-Fetch-Site: same-origin. Brak obu nagłówków = odrzucone (przeglądarki
 * zawsze wysyłają Origin przy fetch POST/PATCH). Host bierzemy z
 * x-forwarded-host (tunel/reverse proxy), inaczej z host.
 */
export function isSameOriginRequest(): boolean {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const origin = h.get('origin');
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return h.get('sec-fetch-site') === 'same-origin';
}

/**
 * Proxy server-side do apps/api dla ZALOGOWANEGO użytkownika: token bierze z
 * httpOnly cookie (przeglądarka go nie widzi), ścieżka jest STAŁA po stronie
 * serwera (nigdy z danych żądania), a ciało - jeśli jest - musi zostać
 * zbudowane przez wywołującego z jawnej allowlisty pól. Status i JSON z API
 * przechodzą 1:1 (kody błędów biznesowych, np. DOMAIN_VERIFICATION_FAILED,
 * obsługuje UI); awaria sieci = 502.
 */
export async function proxyAuthenticated(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  apiPath: string,
  body?: Record<string, unknown>,
): Promise<NextResponse> {
  // Trasy zmieniające stan: tylko żądania z naszej własnej strony (obrona przed
  // CSRF także z tej samej domeny rejestrowalnej, gdzie SameSite=Lax nie chroni).
  if (method !== 'GET' && !isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }

  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
  } catch (error) {
    console.error(`Nie udało się połączyć z apps/api (${method} ${apiPath}):`, (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  // 204 nie może mieć ciała (np. DELETE).
  if (backendResponse.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}

/**
 * Nagłówki dokumentu EMBEDDED_HTML (treść niezaufana, wykonuje dowolny JS): CSP odcina sieć, formularze i cokolwiek poza samym dokumentem
 * (default-src 'none'; skrypty i style tylko inline; obrazy tylko data:), dyrektywa `sandbox allow-scripts` (bez allow-same-origin,
 * allow-forms, allow-popups, allow-downloads) działa także przy otwarciu adresu poza iframe'em: dokument ma zawsze nieprzezroczysty origin i
 * nie widzi ciasteczek ani danych aplikacji. Osadzić go może wyłącznie nasza własna strona (X-Frame-Options i frame-ancestors).
 */
export const EMBED_DOCUMENT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

function embedDocument(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: EMBED_DOCUMENT_HEADERS });
}

const EMBED_ERROR = '<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;padding:16px">Nie udało się załadować modułu.</p>';

/**
 * Proxy dokumentu HTML bloku EMBEDDED_HTML z apps/api ({ html }) dla zalogowanego użytkownika: token z httpOnly cookie, ścieżka STAŁA po
 * stronie serwera. Sukces: sam dokument z EMBED_DOCUMENT_HEADERS. Każdy błąd (401, 404, 5xx, zły kształt) to statyczna strona błędu z tymi
 * samymi nagłówkami i tym samym statusem: treść z API nigdy nie jest odbijana. GET nie zmienia stanu, więc bez kontroli same-origin;
 * osadzenie przez obcą stronę blokują nagłówki, a dokument bez sesji użytkownika (opaque origin) nie ma czego wykraść.
 */
export async function proxyEmbeddedDocument(apiPath: string): Promise<NextResponse> {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return embedDocument(EMBED_ERROR, 401);
  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}${apiPath}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  } catch (error) {
    console.error(`Nie udało się połączyć z apps/api (GET ${apiPath}):`, (error as Error).message);
    return embedDocument(EMBED_ERROR, 502);
  }
  if (!backendResponse.ok) return embedDocument(EMBED_ERROR, backendResponse.status === 404 ? 404 : backendResponse.status === 401 ? 401 : 502);
  const data = (await backendResponse.json().catch(() => null)) as { html?: unknown } | null;
  if (typeof data?.html !== 'string') return embedDocument(EMBED_ERROR, 502);
  return embedDocument(data.html, 200);
}

/**
 * Proxy PLIKU (CSV) z apps/api dla zalogowanego użytkownika: token z httpOnly cookie, ścieżka STAŁA po stronie serwera.
 * Sukces: treść + Content-Disposition z backendu (i `no-store`); błąd (403 PERSONAL_RESULTS_DISABLED, 404...) przechodzi
 * jako JSON z tym samym statusem - nigdy jako plik. Tylko GET (nie zmienia stanu po stronie użytkownika).
 */
export async function proxyAuthenticatedFile(apiPath: string): Promise<NextResponse> {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }
  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}${apiPath}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  } catch (error) {
    console.error(`Nie udało się połączyć z apps/api (GET ${apiPath}):`, (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }, { status: 502 });
  }
  if (!backendResponse.ok) {
    const data = await backendResponse.json().catch(() => null);
    return NextResponse.json(data, { status: backendResponse.status });
  }
  return new NextResponse(await backendResponse.text(), {
    status: 200,
    headers: {
      'Content-Type': backendResponse.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition': backendResponse.headers.get('content-disposition') ?? 'attachment; filename="wyniki.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
