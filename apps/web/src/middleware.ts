import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@cyberszkolo/shared';
import { ACCESS_TOKEN_COOKIE, API_URL, REFRESH_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';
import { clearAuthCookies, setAuthCookies, type TokenPair } from '@/lib/auth-cookies';

// Ścieżka -> role dopuszczone do wejścia. To WYŁĄCZNIE wygoda UX (szybszy
// redirect, brak migotania niezalogowanego widoku) - prawdziwa kontrola
// dostępu jest w apps/api (JwtAuthGuard + RolesGuard), która i tak
// weryfikuje podpis JWT przy każdym żądaniu. Middleware celowo NIE
// weryfikuje podpisu - tylko odczytuje payload, żeby podjąć decyzję o
// przekierowaniu/odświeżeniu tokenu.
//
// UWAGA: middleware uruchamia się WYŁĄCZNIE dla ścieżek pasujących do
// `config.matcher` poniżej - to osobna, statyczna lista. Dodanie tu nowego
// wpisu bez odpowiadającego mu wzorca w matcherze oznacza, że ochrona po
// cichu nie zadziała dla tej ścieżki.
const PROTECTED_ROUTES: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: '/dashboard', roles: [Role.ORG_ADMIN] },
];

function redirectToLogin(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL('/login', request.url));
  clearAuthCookies(response.cookies);
  return response;
}

async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    // Walidacja kształtu - nieoczekiwane body (np. 200 z pustym obiektem)
    // nie może przejść dalej jako "poprawne" tokeny, bo kolejny
    // decodeJwtPayload(accessToken) rzuciłby wyjątkiem na undefined.
    if (typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
      return null;
    }
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const route = PROTECTED_ROUTES.find((r) => request.nextUrl.pathname.startsWith(r.prefix));
  if (!route) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return redirectToLogin(request);
  }

  let accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  let payload = accessToken ? decodeJwtPayload(accessToken) : null;
  let refreshedTokens: TokenPair | null = null;

  // Access token brakuje/wygasł (albo wygasa lada moment) - odśwież
  // proaktywnie, zanim żądanie dotrze do strony. Server Components nie
  // mogą modyfikować cookies, więc to jedyne miejsce, gdzie transparentny
  // refresh może zaktualizować je na odpowiedzi.
  if (!payload || isExpired(payload)) {
    refreshedTokens = await refreshTokens(refreshToken);
    if (!refreshedTokens) {
      return redirectToLogin(request);
    }
    accessToken = refreshedTokens.accessToken;
    payload = decodeJwtPayload(accessToken);
  }

  if (!payload || !route.roles.includes(payload.role)) {
    return redirectToLogin(request);
  }

  const response = NextResponse.next();
  if (refreshedTokens) {
    setAuthCookies(response.cookies, refreshedTokens);
  }
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
