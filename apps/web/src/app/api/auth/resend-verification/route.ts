import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Odpowiedź apps/api jest celowo identyczna dla istniejącego i nieistniejącego
// konta (anty-enumeracja) - front tylko ją wyświetla, nie interpretuje.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';

  if (!email) {
    return NextResponse.json({ message: 'Podaj adres e-mail.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas resend-verification:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);
  const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
  return NextResponse.json(
    { message: message ?? 'Nie udało się wysłać linku. Spróbuj ponownie później.' },
    { status: backendResponse.status },
  );
}
