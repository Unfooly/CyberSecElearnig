import { Role } from '@cyberszkolo/shared';

// Dekoduje payload JWT BEZ weryfikacji podpisu. Używane WYŁĄCZNIE do celów
// UX (middleware) - np. pokazać/ukryć nawigację albo zdecydować, czy
// proaktywnie odświeżyć token. Prawdziwa weryfikacja podpisu i autoryzacja
// dzieje się w apps/api (JwtStrategy + RolesGuard) - front nie jest linią
// obrony, więc nie ma potrzeby kryptograficznej weryfikacji tutaj.
export interface JwtPayload {
  sub: string;
  organizationId: string;
  role: Role;
  email: string;
  exp: number;
}

const VALID_ROLES: string[] = Object.values(Role);

function isValidPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === 'string' &&
    typeof payload.organizationId === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.exp === 'number' &&
    typeof payload.role === 'string' &&
    VALID_ROLES.includes(payload.role)
  );
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    // atob (nie Buffer) - middleware Next.js domyślnie działa w Edge
    // Runtime, gdzie Buffer nie jest dostępny, ale atob (Web API) tak.
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const binary = atob(padded);
    // atob zwraca "binary string" (1 znak = 1 bajt) - dekodujemy jako UTF-8,
    // żeby poprawnie obsłużyć np. polskie znaki w payloadzie.
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder('utf-8').decode(bytes);
    const parsed: unknown = JSON.parse(json);
    // Niekompletny/zepsuty payload (np. brak exp) musi zwrócić null, nie
    // przejść dalej jako "ważny" - bez tego np. porównanie
    // `undefined <= liczba` w isExpired dałoby false.
    return isValidPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isExpired(payload: JwtPayload, skewSeconds = 30): boolean {
  const nowSeconds = Date.now() / 1000;
  return payload.exp <= nowSeconds + skewSeconds;
}
