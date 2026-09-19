import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy server-side do apps/api - ten endpoint nigdy nie wydaje cookies
// (forgot-password nie loguje), więc jest tu wyłącznie żeby przeglądarka nie
// łączyła się bezpośrednio z apps/api (ten sam wzorzec co login/route.ts).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';

  if (!email) {
    return NextResponse.json({ message: 'Podaj adres e-mail.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas forgot-password:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // np. 429 (rate limit) albo 400 (nieprawidłowy format e-maila) - apps/api
    // i tak zwraca identyczną odpowiedź 200 dla istniejącego i
    // nieistniejącego e-maila, więc ta gałąź nigdy nie jest enumeracją kont.
    return NextResponse.json(
      { message: data?.message ?? 'Nie udało się wysłać żądania. Spróbuj ponownie później.' },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({
    message:
      data?.message ??
      'Jeśli podany adres e-mail istnieje w systemie, wysłaliśmy na niego link do zresetowania hasła.',
  });
}
