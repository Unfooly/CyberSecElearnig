import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@cyberszkolo/shared';
import { ACCESS_TOKEN_COOKIE, API_URL, REFRESH_TOKEN_COOKIE } from '@/lib/config';
import { clientIpHeaders } from '@/lib/client-ip';
import { decodeJwtPayload, isExpired } from '@/lib/jwt';
import { clearAuthCookies, setAuthCookies, type TokenPair } from '@/lib/auth-cookies';
import { buildContentSecurityPolicy, generateNonce, resolveContentOrigin } from '@/lib/security-headers';

// Ścieżka -> role dopuszczone do wejścia. To WYŁĄCZNIE wygoda UX (szybszy
// redirect, brak migotania niezalogowanego widoku) - prawdziwa kontrola
// dostępu jest w apps/api (JwtAuthGuard + RolesGuard), która i tak
// weryfikuje podpis JWT przy każdym żądaniu. Middleware celowo NIE
// weryfikuje podpisu - tylko odczytuje payload, żeby podjąć decyzję o
// przekierowaniu/odświeżeniu tokenu.
//
// UWAGA: middleware uruchamia się dla ścieżek pasujących do `config.matcher`
// na dole pliku (wszystkie strony poza /api, /_next i plikami statycznymi) -
// nie dodawaj do matchera wyjątków, które pominęłyby ścieżkę z tej listy.
const ALL_ROLES = Object.values(Role);

const PROTECTED_ROUTES: Array<{ prefix: string; roles: Role[] }> = [
  // KOLEJNOŚĆ MA ZNACZENIE: wygrywa PIERWSZY pasujący prefiks, więc trasy głębsze niż
  // /dashboard muszą stać przed nim - inaczej wpadłyby pod regułę "/dashboard tylko ORG_ADMIN".
  // Panel operatora platformy (partnerzy, organizacje) - wyłącznie SUPER_ADMIN (D-069).
  { prefix: '/dashboard/admin', roles: [Role.SUPER_ADMIN] },
  // Panel partnera: lista jego klientów. Bez dostępu do danych klienta (to osobny krok).
  { prefix: '/dashboard/reseller', roles: [Role.RESELLER_ADMIN] },
  { prefix: '/dashboard', roles: [Role.ORG_ADMIN] },
  // Ekran weryfikacji domeny organizacji PENDING (tylko admin organizacji).
  { prefix: '/onboarding', roles: [Role.ORG_ADMIN] },
  // /courses jest dostępne dla każdej zalogowanej roli, w przeciwieństwie
  // do /dashboard (tylko ORG_ADMIN).
  { prefix: '/courses', roles: ALL_ROLES },
  // Zgłaszanie podejrzanych wiadomości: każda zalogowana rola.
  { prefix: '/report', roles: ALL_ROLES },
  // Ustawienia KONTA (avatar itd.) - każda zalogowana rola, w odróżnieniu od
  // /dashboard/settings, czyli ustawień ORGANIZACJI dla ORG_ADMIN-a.
  { prefix: '/account', roles: ALL_ROLES },
  // Skrzynka zgłoszeń: ORG_ADMIN (pełna) i DEPARTMENT_MANAGER (ograniczona lista działu); pracownik zgłasza przez /report.
  { prefix: '/reports', roles: [Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER] },
];

// Prefiks dopasowujemy po SEGMENCIE ścieżki: "/report" nie może obejmować "/reports" (panel zgłoszeń ma inne role).
const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

function redirectToLogin(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL('/login', request.url));
  clearAuthCookies(response.cookies);
  return response;
}

async function refreshTokens(refreshToken: string, clientIp: Record<string, string>): Promise<TokenPair | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clientIp },
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

// Single-flight: równoległe żądania z TYM SAMYM refresh tokenem (przeładowanie strony z wieloma
// zasobami, kilka RSC naraz) dzielą jedno odświeżenie zamiast wołać /auth/refresh po kilka razy.
// Pamięć procesu/izolatu: zmniejsza zależność od okna łaski rotacji w API, ale go nie zastępuje
// (inne instancje web albo inne izolaty middleware nie widzą tej mapy).
const inFlightRefreshes = new Map<string, Promise<TokenPair | null>>();

function refreshTokensOnce(refreshToken: string, clientIp: Record<string, string>): Promise<TokenPair | null> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) {
    return existing;
  }
  const pending = refreshTokens(refreshToken, clientIp).finally(() => inFlightRefreshes.delete(refreshToken));
  inFlightRefreshes.set(refreshToken, pending);
  return pending;
}

/**
 * Przepuszcza żądanie z nagłówkiem Content-Security-Policy z nonce (security-headers.ts). Nonce trafia też do nagłówków ŻĄDANIA:
 * Next.js czyta go stamtąd i nakłada na własne skrypty inline. Odpowiedzi przekierowań (redirectToLogin) nie mają treści, więc CSP
 * nie potrzebują.
 */
function passThrough(request: NextRequest): NextResponse {
  const development = process.env.NODE_ENV === 'development';
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    contentOrigin: resolveContentOrigin(process.env.CONTENT_BASE_URL, development),
    development,
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const route = PROTECTED_ROUTES.find((r) => matchesPrefix(request.nextUrl.pathname, r.prefix));
  if (!route) {
    return passThrough(request);
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
    refreshedTokens = await refreshTokensOnce(refreshToken, clientIpHeaders(request.headers));
    if (!refreshedTokens) {
      return redirectToLogin(request);
    }
    accessToken = refreshedTokens.accessToken;
    payload = decodeJwtPayload(accessToken);
  }

  if (!payload || !route.roles.includes(payload.role)) {
    return redirectToLogin(request);
  }

  const response = passThrough(request);
  if (refreshedTokens) {
    setAuthCookies(response.cookies, refreshedTokens);
  }
  return response;
}

// Middleware działa dla WSZYSTKICH stron (CSP z nonce jest potrzebne każdej stronie HTML), poza trasami BFF (`/api/*`: same odpowiedzi
// JSON), zasobami statycznymi Next.js i plikami ikon/manifestu. O ochronie tras decyduje PROTECTED_ROUTES (prefiks), nie matcher:
// nowa chroniona ścieżka wymaga wpisu w PROTECTED_ROUTES, a matcher obejmie ją automatycznie.
export const config = {
  matcher: ['/((?!api/|_next/|favicon\\.ico|icon\\.svg|manifest\\.webmanifest).*)'],
};
