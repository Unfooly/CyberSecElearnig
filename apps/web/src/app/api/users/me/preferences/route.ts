import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';
import { proxyAuthenticated } from '@/lib/bff';
import { pickFields } from '@/lib/pick-fields';

// Proxy server-side do apps/api (GET/PATCH /users/me/preferences): przełącznik "Lektor wył." w odtwarzaczu jest komponentem
// klienckim, który nie czyta httpOnly cookie ani nie zna API_URL - ten sam wzorzec co /api/users/me/avatar. Identyfikatora
// użytkownika tu nie ma: API bierze go z tokena, więc zmienić można wyłącznie własne preferencje.
export async function GET() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  try {
    const backendResponse = await apiFetch(`${API_URL}/users/me/preferences`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const data = await backendResponse.json().catch(() => null);
    return NextResponse.json(data, { status: backendResponse.status });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy pobieraniu preferencji:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem.' }, { status: 502 });
  }
}

// Zapis preferencji zmienia stan: proxyAuthenticated wymaga żądania z naszej własnej strony (CSRF), ciało z allowlisty { narrationEnabled }.
export async function PATCH(request: NextRequest) {
  const body = pickFields(await request.json().catch(() => null), ['narrationEnabled']);
  if (!body) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }
  return proxyAuthenticated('PATCH', '/users/me/preferences', body);
}
