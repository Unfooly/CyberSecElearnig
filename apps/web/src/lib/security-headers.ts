// Content-Security-Policy dla apps/web (D-053). Budowana w middleware PER ŻĄDANIE, bo skrypty inline Next.js dostają nonce
// (bez 'unsafe-inline' w script-src), a nonce musi być inny w każdej odpowiedzi.
//
// Konsekwencje, o których trzeba pamiętać:
// - Strony z nonce muszą być renderowane dynamicznie (root layout ma `dynamic = 'force-dynamic'`); statyczny HTML miałby
//   skrypty bez nonce i przeglądarka by je zablokowała.
// - Dokument iframe `srcdoc` DZIEDZICZY politykę rodzica (sprawdzone w Chromium): inline-skrypty w treści `EMBEDDED_HTML` wstawionej
//   przez `srcDoc` byłyby blokowane przez script-src rodzica. Dlatego `EMBEDDED_HTML` ma być serwowany jako osobny dokument
//   (`frame-src 'self'`) z własnym nagłówkiem CSP - patrz plan PR 2. Podglądy maili (`srcDoc`, sandbox bez skryptów) potrzebują
//   `style-src 'unsafe-inline'` (style inline w treści maila też dziedziczą politykę).
// - Zasoby modułów (obrazy, audio) idą z CONTENT_BASE_URL: konkretny host z env, nigdy wildcard.

/** Nonce dla jednej odpowiedzi (128 bitów losowości, base64). Działa w runtime Edge (middleware) i w Node 20+. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Origin (schemat + host + port) z CONTENT_BASE_URL albo null. Zwraca WYŁĄCZNIE konkretny origin: odrzuca wildcardy, inne schematy niż
 * https (http tylko dla localhost/127.0.0.1 w developmentcie) oraz wartości niepoprawne - wtedy zasoby modułów są dozwolone tylko z 'self'
 * (lokalnie: apps/web/public/content).
 */
export function resolveContentOrigin(raw: string | undefined, development = false): string | null {
  if (!raw || raw.trim() === '' || raw.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const allowed = url.protocol === 'https:' || (development && url.protocol === 'http:' && localHost);
  if (!allowed || url.username || url.password) return null;
  // Host tylko z liter, cyfr, kropek i myślników (po punycode): parser URL przepuszcza w hoście m.in. ';' , ',' i apostrof, a ';'
  // kończyłby dyrektywę CSP i pozwalał dopisać kolejną (np. https://a.com;script-src).
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return null;
  return url.origin;
}

export interface CspOptions {
  nonce: string;
  /** Origin z CONTENT_BASE_URL (resolveContentOrigin) albo null. */
  contentOrigin?: string | null;
  /** Tryb deweloperski Next.js: React i HMR potrzebują eval i WebSocket. Nigdy w produkcji. */
  development?: boolean;
}

/** Nagłówek Content-Security-Policy. Produkcyjnie: script-src bez 'unsafe-inline' i bez 'unsafe-eval'. */
export function buildContentSecurityPolicy({ nonce, contentOrigin = null, development = false }: CspOptions): string {
  const content = contentOrigin ? ` ${contentOrigin}` : '';
  const directives = [
    `default-src 'self'`,
    // 'self' dla chunków /_next/static, nonce dla skryptów inline frameworka. W dev dodatkowo eval (React/HMR).
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ''}`,
    // Tailwind nie wymaga inline, ale style inline w atrybutach (style={{}}) i w podglądach maili w iframe srcdoc (dziedziczą
    // politykę rodzica) tak; 'unsafe-inline' dotyczy wyłącznie stylów, nie skryptów.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:${content}`,
    `media-src 'self'${content}`,
    `font-src 'self'`,
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    `frame-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  return directives.join('; ');
}
