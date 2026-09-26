import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';

// Proxy server-side do apps/api: imię i inicjał nazwiska WŁASNEGO konta dla legitymacji w odprawie (BriefingBlock, D-081) -
// komponent kliencki nie czyta httpOnly cookie ani nie zna API_URL (ten sam wzorzec co /api/users/me/avatar). Tylko GET, bez
// parametrów: backend bierze użytkownika wyłącznie z tokena.
export async function GET() {
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Wymagane zalogowanie.' }, { status: 401 });
  }

  try {
    const backendResponse = await apiFetch(`${API_URL}/users/me/display-name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const data = await backendResponse.json().catch(() => null);
    if (!backendResponse.ok) {
      return NextResponse.json(data, { status: backendResponse.status });
    }
    // Do przeglądarki wyłącznie te dwa pola, jako tekst albo null - nawet gdyby backend kiedyś zwrócił więcej.
    const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
    // no-store: dane osobowe nie zostają w cache przeglądarki (np. współdzielony komputer).
    return NextResponse.json(
      { firstName: text(data?.firstName), lastInitial: text(data?.lastInitial) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Nie udało się połączyć z apps/api przy pobieraniu imienia:', (error as Error).message);
    return NextResponse.json({ message: 'Nie udało się połączyć z serwerem.' }, { status: 502 });
  }
}
