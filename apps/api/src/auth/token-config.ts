// Czasy życia tokenów - JEDNO źródło prawdy (issueTokens, klucz unieważnienia sesji w Redisie).
// Zmiana TTL access tokenu automatycznie zmienia TTL klucza `sessions-revoked:<userId>`.
// (apps/web/src/lib/config.ts ma lustrzane maxAge ciasteczek - zmieniaj razem.)

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Okno łaski rotacji refresh tokenu. Ponowne użycie tokenu, który został wymieniony
 * przed mniej niż tyle ms, NIE jest traktowane jako kradzież: dostaje kolejny token
 * z tej samej rodziny. Powód: równoległe żądania (middleware web + strony RSC, dwie
 * karty) potrafią odświeżyć ten sam token niemal jednocześnie - bez okna użytkownik
 * dostawałby losowe wylogowania.
 * ŚWIADOMY KOMPROMIS: w tym oknie ktoś, kto przechwycił już wymieniony token, może go
 * odtworzyć i dostać własny, ważny token (replay). Okno jest krótkie (10 s), a po nim
 * obowiązuje ścisłe wykrywanie reuse (unieważnienie całej rodziny).
 */
export const REFRESH_ROTATION_GRACE_MS = 10_000;

/**
 * Ile tokenów jednej rodziny może powstać w oknie łaski (następca + rodzeństwo z odtworzenia).
 * Kolejne odtworzenie tego samego tokenu w oknie = reuse (rodzina unieważniona). Ogranicza tempo
 * mnożenia żywych gałęzi, ale NIE usuwa samego faktu, że odtworzenie w oknie daje żywe rodzeństwo:
 * gałąź atakującego (rotowana niezależnie) trwa do wylogowania / "wyloguj wszędzie" / resetu hasła.
 */
export const MAX_TOKENS_PER_GRACE_WINDOW = 3;

// Zapas na skrzywienie zegarów przy TTL klucza w Redisie.
export const SESSION_REVOKED_KEY_MARGIN_SECONDS = 5;
