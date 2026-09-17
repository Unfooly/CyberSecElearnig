import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from './config';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Wspólny minimalny kształt zarówno ResponseCookies (Route Handler/
// middleware), jak i next/headers cookies() w Route Handlerze - jedyna
// metoda, jakiej tu potrzebujemy, to `set`.
export interface CookieJar {
  set(name: string, value: string, options: Record<string, unknown>): void;
}

const baseOptions = {
  httpOnly: true,
  // Wymuszone HTTPS tylko w produkcji - w lokalnym dev (http://localhost)
  // "secure" zablokowałoby wysyłanie cookie w ogóle.
  //
  // UWAGA (zweryfikowane security review): Next.js statycznie podmienia
  // `process.env.NODE_ENV` na literał "production" w skompilowanym
  // bundlu podczas `next build`, niezależnie od zmiennej NODE_ENV w
  // powłoce/kontenerze uruchamiającym `next start` później - ta wartość
  // jest więc "zamrożona" już na etapie builda, nie odczytywana w
  // runtime. Dlatego to bezpieczne bez własnej zmiennej env, o ile
  // artefakt produkcyjny zawsze powstaje przez standardowe `next build`
  // (nie serwuj `next dev` na produkcji).
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Ustawia oba httpOnly cookies z parą tokenów. Wołane WYŁĄCZNIE z Route
 * Handlera logowania i z middleware (proaktywny refresh) - nigdy z kodu
 * działającego w przeglądarce (tam httpOnly cookies i tak są niewidoczne
 * dla JS, o to właśnie chodzi).
 */
export function setAuthCookies(cookies: CookieJar, tokens: TokenPair): void {
  cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookies(cookies: CookieJar): void {
  cookies.set(ACCESS_TOKEN_COOKIE, '', { ...baseOptions, maxAge: 0 });
  cookies.set(REFRESH_TOKEN_COOKIE, '', { ...baseOptions, maxAge: 0 });
}
