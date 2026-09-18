import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';

// Proxy server-side do apps/api. /auth/register NIE zwraca tokenów -
// logowanie jest zablokowane do potwierdzenia adresu e-mail (link w
// wiadomości), więc tu nie ma cookies do ustawienia; przekazujemy tylko
// komunikat.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ message: 'Uzupełnij wszystkie pola.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api podczas rejestracji:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // apps/api zwraca albo pojedynczy string, albo tablicę komunikatów
    // walidacji (class-validator) - normalizujemy do jednego stringa.
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    return NextResponse.json(
      { message: message ?? 'Rejestracja nie powiodła się.' },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json({
    message: typeof data?.message === 'string' ? data.message : 'Wysłaliśmy link weryfikacyjny na podany adres e-mail.',
    // false = konto utworzone, ale mail nie wyszedł - UI oferuje ponowną wysyłkę.
    emailSent: data?.emailSent !== false,
  });
}
