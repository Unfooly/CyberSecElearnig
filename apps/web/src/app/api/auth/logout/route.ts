import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api-fetch';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { isSameOriginRequest } from '@/lib/bff';
import { API_URL, REFRESH_TOKEN_COOKIE } from '@/lib/config';

// Wylogowanie: unieważnia sesję W API (rodzina refresh tokenów) i czyści oba httpOnly cookies.
// Tylko POST z własnej strony - GET wylogowywałby przez zwykły link/obrazek z obcej strony
// (logout-CSRF). Cookies czyścimy ZAWSZE, także gdy API nie odpowie: użytkownik ma być wylogowany
// po stronie przeglądarki (refresh token w API i tak wygaśnie; awaria API jest tylko logowana).
export async function POST() {
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403 });
  }

  const jar = cookies();
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;
  // false = API nie potwierdziło unieważnienia (429, 5xx, sieć): token w bazie dalej ważny do 7 dni.
  let sessionRevoked = true;
  if (refreshToken) {
    try {
      const response = await apiFetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      if (!response.ok) {
        sessionRevoked = false;
        console.error(`apps/api nie potwierdziło wylogowania (status ${response.status}) - sesja pozostaje ważna po stronie serwera.`);
      }
    } catch (error) {
      sessionRevoked = false;
      console.error('Nie udało się unieważnić sesji w apps/api przy wylogowaniu:', (error as Error).message);
    }
  }

  clearAuthCookies(jar);
  // `sessionRevoked: false` pozwala UI ostrzec (np. na wspólnym komputerze użyć "Wyloguj wszędzie" po zalogowaniu).
  return NextResponse.json({ success: true, sessionRevoked });
}
