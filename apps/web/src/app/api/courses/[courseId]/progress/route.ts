import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';

// Proxy server-side do apps/api - jedyny nowy Route Handler tego zadania
// (start woła się bezpośrednio z Server Component, tak jak reszta
// dashboardu). W przeciwieństwie do /api/auth/login, tu odpowiedź NIE
// zawiera sekretu (wynik quizu, nie token), więc przekazujemy ją wprost do
// klienta zamiast filtrować pola.
export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(
      `${API_URL}/courses/${encodeURIComponent(params.courseId)}/progress`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy zapisie postępu:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  return NextResponse.json(data, { status: backendResponse.status });
}
