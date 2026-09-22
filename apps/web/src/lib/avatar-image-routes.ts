import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api-fetch';
import { isSameOriginRequest } from '@/lib/bff';
import { decodeJwtPayload } from '@/lib/jwt';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';

/**
 * Własny avatar z pliku (D-067). Obrazek MUSI iść przez nasz origin: CSP dopuszcza
 * `img-src 'self' data: <CONTENT_BASE_URL>` (D-053), więc obrazek serwowany wprost z API
 * (inny host) nie wyświetliłby się - to był powód, dla którego avatar z dowolnego URL-a
 * nigdy nie działał (B-075).
 */

// Ten sam limit co w apps/api - odrzucamy za duży plik, zanim pojdzie dalej.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function unauthorized(): NextResponse {
  return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
}

/** Id zalogowanego użytkownika z tokena (jak w middleware: podpisu nie weryfikujemy, to nie jest linia obrony - API i tak sprawdza token). */
function currentUserId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  return payload?.sub ?? null;
}

export async function uploadAvatarImage(request: NextRequest): Promise<NextResponse> {
  // Trasa zmieniająca stan: tylko żądania z naszej własnej strony (CSRF), jak w proxyAuthenticated.
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return unauthorized();
  }

  const incoming = await request.formData().catch(() => null);
  const file = incoming?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ message: 'Brak pliku w żądaniu.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ message: 'Plik jest za duży (maksymalnie 2 MB).' }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append('file', file, file.name || 'avatar');

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/me/avatar/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: outgoing,
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy wgrywaniu avatara:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }, { status: 502 });
  }
  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}

export async function deleteAvatarImage(): Promise<NextResponse> {
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return unauthorized();
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/me/avatar/image`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy usuwaniu avatara:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' }, { status: 502 });
  }
  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}

/**
 * Obrazek avatara: `userId` z adresu albo "me" (wtedy bierzemy `sub` z tokena - klient nie
 * musi znać własnego identyfikatora). O tym, czyj avatar wolno pobrać, decyduje WYŁĄCZNIE
 * apps/api: filtruje po organizationId z tokena, więc obcej organizacji nie zobaczymy.
 */
export async function getAvatarImage(userId: string): Promise<NextResponse> {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return unauthorized();
  }
  const targetId = userId === 'me' ? currentUserId(accessToken) : userId;
  if (!targetId || !/^[A-Za-z0-9_-]{1,64}$/.test(targetId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/${targetId}/avatar/image`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy pobieraniu avatara:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem.' }, { status: 502 });
  }
  if (!backendResponse.ok) {
    // Błąd przechodzi jako JSON, nigdy jako obrazek (przeglądarka pokaże wtedy fallback z inicjałami).
    const data = await backendResponse.json().catch(() => null);
    return NextResponse.json(data ?? { message: 'Nie udało się pobrać avatara.' }, { status: backendResponse.status });
  }

  return new NextResponse(await backendResponse.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': backendResponse.headers.get('content-type') ?? 'image/webp',
      // Wizerunek pracownika: nigdy w cache współdzielonym. Adres ma skrót treści, więc
      // krótki cache w przeglądarce nie pokaże starego obrazka po zmianie.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
