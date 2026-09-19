import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';
import { setAuthCookies } from '@/lib/auth-cookies';
import { decodeJwtPayload } from '@/lib/jwt';
import { Role } from '@cyberszkolo/shared';
import { homePathForRole, ONBOARDING_PATH } from '@/lib/home-path';
import { fetchOrganization } from '@/lib/organization';

// Proxy server-side do apps/api - przeglądarka woła TYLKO ten endpoint,
// nigdy nie łączy się z apps/api bezpośrednio i nigdy nie widzi tokenów.
// Ustawiamy je jako httpOnly cookies tutaj, po stronie serwera Next.js.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ message: 'Podaj e-mail i hasło.' }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await apiFetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    // Nie logujemy `error` bezpośrednio (mógłby zawierać fragmenty żądania) -
    // tylko fakt i typ awarii, dla diagnostyki bez ryzyka wycieku danych.
    console.error('Nie udało się połączyć z apps/api podczas logowania:', (error as Error).message);
    return NextResponse.json(
      { message: 'Nie udało się połączyć z serwerem. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  const data = await backendResponse.json().catch(() => null);

  if (!backendResponse.ok) {
    // Komunikat błędu przechodzi wprost z apps/api - już jest generyczny
    // ("Nieprawidłowy e-mail lub hasło"), nie ujawnia które pole jest złe.
    return NextResponse.json(
      { message: data?.message ?? 'Logowanie nie powiodło się.', code: data?.code },
      { status: backendResponse.status },
    );
  }

  // Walidacja kształtu odpowiedzi 200 - analogicznie do refreshTokens() w
  // middleware.ts. Bez tego nieoczekiwane body z apps/api (błąd deployu,
  // proxy przechwytujący health-check, cokolwiek) skończyłoby się albo
  // crashem handlera, albo fałszywym "success: true" bez realnych tokenów.
  if (typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
    console.error('Odpowiedź /auth/login z apps/api ma nieoczekiwany kształt.');
    return NextResponse.json(
      { message: 'Logowanie nie powiodło się. Spróbuj ponownie później.' },
      { status: 502 },
    );
  }

  setAuthCookies(cookies(), { accessToken: data.accessToken, refreshToken: data.refreshToken });

  // Rola tylko do wyboru strony startowej (UX) - dostęp i tak egzekwuje middleware + apps/api.
  const role = decodeJwtPayload(data.accessToken)?.role;

  // Admin organizacji, która nie zweryfikowała jeszcze domeny, ląduje na ekranie
  // weryfikacji, nie na dashboardzie (API i tak zablokowałoby dane - guard PENDING).
  // Błąd tego zapytania nie blokuje logowania: wtedy zwykła strona startowa.
  if (role === Role.ORG_ADMIN) {
    const organization = await fetchOrganization(data.accessToken);
    if (organization.ok && organization.data.status === 'PENDING_DOMAIN_VERIFICATION') {
      return NextResponse.json({ success: true, redirectTo: ONBOARDING_PATH });
    }
  }
  return NextResponse.json({ success: true, redirectTo: homePathForRole(role) });
}
