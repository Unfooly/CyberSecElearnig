import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy server-side do apps/api. Potwierdzenie rejestracji na adres z cudzym nieaktywowanym zaproszeniem (klik w link z maila):
// przejmuje adres i tworzy administratora, a hasło ustawia się kolejnym linkiem z maila. Nie loguje (brak cookies).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';

  if (!token) {
    return NextResponse.json({ message: 'Brak tokenu potwierdzającego.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/claim-registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas claim-registration:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // Każda porażka ma ten sam kod i komunikat (CLAIM_INVALID_OR_EXPIRED) - front go tylko przekazuje.
    return NextResponse.json(
      { message: data?.message ?? 'Nie udało się potwierdzić rejestracji.', code: data?.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({ message: data?.message ?? 'Adres potwierdzony.' });
}
