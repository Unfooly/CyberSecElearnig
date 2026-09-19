import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy server-side do apps/api - GET listuje pracowników (paginacja/
// wyszukiwanie/filtr przez query string, przekazywane 1:1), POST zaprasza
// nowego. Ten sam wzorzec co apps/web/src/app/api/users/me/avatar/route.ts.
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
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/users/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy zapraszaniu pracownika:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
