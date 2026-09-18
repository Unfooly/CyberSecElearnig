import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';

// Proxy server-side do apps/api. Weryfikacja NIE loguje (brak cookies) -
// user loguje się po potwierdzeniu, jak po resecie hasła.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';

  if (!token) {
    return NextResponse.json({ message: 'Brak tokenu weryfikacyjnego.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas verify-email:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // `code` rozróżnia TOKEN_ALREADY_USED od TOKEN_INVALID_OR_EXPIRED -
    // komunikat dobiera apps/api, front go tylko przekazuje.
    return NextResponse.json(
      { message: data?.message ?? 'Nie udało się potwierdzić adresu e-mail.', code: data?.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({ message: data?.message ?? 'Adres e-mail potwierdzony.' });
}
