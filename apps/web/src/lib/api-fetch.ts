import { headers } from 'next/headers';
import { clientIpHeaders, isProxyTrusted } from '@/lib/client-ip';

let warnedAboutMissingRequestScope = false;

/**
 * Adres klienta bieżącego żądania (Route Handler / Server Component) jako
 * nagłówki dla API; pusty obiekt bez zaufanego proxy albo poza zakresem żądania.
 */
export function requestClientIpHeaders(): Record<string, string> {
  if (!isProxyTrusted()) {
    return {};
  }
  try {
    return clientIpHeaders(headers());
  } catch (error) {
    // Cicha utrata adresu = wszyscy użytkownicy dzielą jeden limit (np. po zmianie API next/headers).
    // Logujemy raz na proces, żeby to było widoczne.
    if (!warnedAboutMissingRequestScope) {
      warnedAboutMissingRequestScope = true;
      console.warn('apiFetch: brak adresu klienta (headers() niedostępne):', (error as Error).message);
    }
    return {};
  }
}

// init.headers może być zwykłym obiektem, Headers albo tablicą par - zachowujemy wszystkie nagłówki.
function toPlainHeaders(value: RequestInit['headers']): Record<string, string> {
  if (!value) {
    return {};
  }
  if (Array.isArray(value) || (typeof Headers !== 'undefined' && value instanceof Headers)) {
    return Object.fromEntries(new Headers(value).entries());
  }
  return { ...(value as Record<string, string>) };
}

/**
 * fetch do apps/api z przekazaniem adresu klienta (patrz lib/client-ip.ts).
 * Bez zaufanego proxy zachowuje się dokładnie jak zwykły fetch. Nagłówek adresu
 * zawsze pochodzi z bieżącego żądania - wartość podana w `init` jest nadpisywana.
 */
export function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const extra = requestClientIpHeaders();
  if (Object.keys(extra).length === 0) {
    return fetch(input, init);
  }
  const merged = toPlainHeaders(init.headers);
  for (const key of Object.keys(merged)) {
    if (key.toLowerCase() === 'cf-connecting-ip') {
      delete merged[key];
    }
  }
  return fetch(input, { ...init, headers: { ...merged, ...extra } });
}
