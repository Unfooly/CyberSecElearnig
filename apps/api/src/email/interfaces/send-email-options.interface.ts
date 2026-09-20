export interface SendEmailOptions {
  to: string;
  subject: string;
  // Nazwa szablonu z apps/api/src/email/templates (render w kodzie) - NIE
  // treść HTML. Zmiana treści maila = zmiana szablonu w kodzie i
  // deploy backendu.
  templateName: string;
  templateData: Record<string, unknown>;
}

/**
 * Sklasyfikowany wynik wysyłki - ten sam podział co w wysyłce kampanii phishingowych (docs/phishing-simulations.md):
 *  - SENT: dostawca przyjął wiadomość;
 *  - REJECTED: PEWNE niepowodzenie, wiadomość nie wyszła (odrzucona 4xx, brak połączenia z dostawcą, nieznany szablon);
 *  - UNCERTAIN: dostawca MÓGŁ przyjąć wiadomość (timeout, HTTP 5xx, zerwane połączenie, nieoczekiwany błąd) - nie ponawiamy po cichu.
 * Kody nie zawierają danych osobowych.
 */
export type MailResult =
  | { status: 'SENT' }
  | { status: 'REJECTED'; code: string }
  | { status: 'UNCERTAIN'; code: string };

/** Opcjonalny "odbiornik" wyniku: `send` nadal zwraca boolean (kompatybilność), a wołający, któremu zależy na rozróżnieniu, czyta `result`. */
export interface MailOutcome {
  result?: MailResult;
}
