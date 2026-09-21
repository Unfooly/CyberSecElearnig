import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';
import { proxyAuthenticated } from '@/lib/bff';
import { pickFields } from '@/lib/pick-fields';

// Proxy server-side do apps/api - GET listuje pracowników (paginacja/
// wyszukiwanie/filtr przez query string, przekazywane 1:1), POST zaprasza
// nowego (zmienia stan: proxyAuthenticated wymaga żądania z naszej własnej strony, ciało z allowlisty pól zaproszenia).
export async function GET(request: NextRequest) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users${request.nextUrl.search}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy pobieraniu listy pracowników:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}

export async function POST(request: NextRequest) {
  const body = pickFields(await request.json().catch(() => null), ['email', 'firstName', 'lastName', 'departmentId', 'role']);
  if (!body) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }
  return proxyAuthenticated('POST', '/users/invite', body);
}
