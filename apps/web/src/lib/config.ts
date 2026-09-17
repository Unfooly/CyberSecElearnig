// Wołane WYŁĄCZNIE server-side (Route Handlery, middleware, Server
// Components) - przeglądarka nigdy nie łączy się z apps/api bezpośrednio,
// więc nie ma tu problemu CORS ani potrzeby publicznej zmiennej NEXT_PUBLIC_*.
export const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Zgodne z czasem życia tokenów w apps/api/src/auth/auth.service.ts
// (issueTokens: accessToken 15m, refreshToken 7d) - maxAge cookie to tylko
// podpowiedź dla przeglądarki kiedy przestać je wysyłać, realną ważność
// wymusza `exp` w samym JWT, weryfikowany przez apps/api.
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
