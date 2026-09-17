import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL } from '@/lib/config';
import { setAuthCookies } from '@/lib/auth-cookies';

// Proxy server-side do apps/api - /auth/register zwraca parę tokenów tak jak
// /auth/login (auth.service.ts: register() kończy się issueTokens()), więc
// ten route mirroruje login/route.ts 1:1 - rejestracja loguje od razu.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const organizationName = typeof body?.organizationName === 'string' ? body.organizationName : '';
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!organizationName || !email || !password) {
    return NextResponse.json({ message: 'Uzupełnij wszystkie pola.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationName, email, password }),
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
    // apps/api zwraca albo pojedynczy string (np. duplikat e-maila -
    // REGISTRATION_FAILED_MESSAGE), albo tablicę komunikatów walidacji
    // (class-validator, ValidationPipe) - normalizujemy do jednego stringa,
    // żeby front nie musiał znać tego szczegółu.
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    return NextResponse.json({ message: message ?? 'Rejestracja nie powiodła się.' }, {
      status: backendResponse.status,
    });
  }

  // Walidacja kształtu odpowiedzi 200/201 - analogicznie do login/route.ts.
  if (typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
    console.error('Odpowiedź /auth/register z apps/api ma nieoczekiwany kształt.');
    return NextResponse.json(
      { message: 'Rejestracja nie powiodła się. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  setAuthCookies(cookies(), { accessToken: data.accessToken, refreshToken: data.refreshToken });

  return NextResponse.json({ success: true });
}
