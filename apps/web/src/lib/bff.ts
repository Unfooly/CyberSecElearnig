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
  method: 'GET' | 'POST' | 'PATCH',
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

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
