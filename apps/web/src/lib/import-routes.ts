import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api-fetch';
import { isSameOriginRequest, proxyAuthenticated, proxyAuthenticatedFile } from '@/lib/bff';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { isSafeId } from '@/lib/safe-id';

const badId = () => NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
const ROW_STATUSES = ['VALID', 'EXISTING', 'ERROR'];

/** Zapytanie wierszy tylko z allowlisty: status z enumu, page/pageSize jako cyfry; reszta jest pomijana. */
export function importRowsQuery(request: NextRequest): string {
  const params = request.nextUrl.searchParams;
  const parts: string[] = [];
  const status = params.get('status');
  if (status && ROW_STATUSES.includes(status)) parts.push(`status=${status}`);
  for (const name of ['page', 'pageSize'] as const) {
    const value = params.get(name);
    if (value && /^\d{1,4}$/.test(value)) parts.push(`${name}=${value}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// Wszystkie ścieżki API są STAŁE; identyfikator partii przechodzi przez isSafeId. Uprawnienia (ORG_ADMIN), limity, walidację i
// limit licencji egzekwuje apps/api - BFF niczego nie filtruje ani nie cache'uje.
export const importRoutes = {
  latest: () => proxyAuthenticated('GET', '/users/import/latest'),
  get: (id: string) => (isSafeId(id) ? proxyAuthenticated('GET', `/users/import/${id}`) : badId()),
  rows: (id: string, request: NextRequest) => (isSafeId(id) ? proxyAuthenticated('GET', `/users/import/${id}/rows${importRowsQuery(request)}`) : badId()),
  confirm: (id: string) => (isSafeId(id) ? proxyAuthenticated('POST', `/users/import/${id}/confirm`) : badId()),
  stop: (id: string) => (isSafeId(id) ? proxyAuthenticated('POST', `/users/import/${id}/stop`) : badId()),
  cancel: (id: string) => (isSafeId(id) ? proxyAuthenticated('DELETE', `/users/import/${id}`) : badId()),
  report: (id: string) => (isSafeId(id) ? proxyAuthenticatedFile(`/users/import/${id}/report.csv`) : badId()),
};

/**
 * Proxy multipart podglądu: czytamy FormData z żądania przeglądarki i budujemy NOWY FormData do apps/api (fetch sam ustawi
 * poprawny Content-Type z boundary). Tylko pole `file`; inne pola są odrzucane - API i tak nie przyjmuje pól tekstowych.
 */
export async function previewProxy(request: NextRequest): Promise<NextResponse> {
  // Jak w proxyAuthenticated: trasa zmieniająca stan (zapisuje podgląd) tylko z naszej własnej strony (CSRF).
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }
  const incoming = await request.formData().catch(() => null);
  const file = incoming?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ message: 'Brak pliku CSV w żądaniu.' }, { status: 400 });
  }
  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: outgoing });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy podglądzie importu:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }, { status: 502 });
  }
  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
