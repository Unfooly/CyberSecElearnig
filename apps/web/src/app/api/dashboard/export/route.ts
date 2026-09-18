import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';

// Proxy pliku CSV z GET /dashboard/export?format=csv - przekazuje treść oraz
// Content-Disposition, żeby przeglądarka zapisała plik pod nazwą z backendu.
export async function GET() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${API_URL}/dashboard/export?format=csv`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy eksporcie raportu:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  if (!backendResponse.ok) {
    const data = await backendResponse.json().catch(() => null);
    return NextResponse.json(data, { status: backendResponse.status });
  }

  return new NextResponse(await backendResponse.text(), {
    status: 200,
    headers: {
      'Content-Type': backendResponse.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition': backendResponse.headers.get('content-disposition') ?? 'attachment; filename="raport.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
