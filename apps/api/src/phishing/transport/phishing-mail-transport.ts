/**
 * Transport wysyłki maili SYMULACJI phishingowych. Celowo OSOBNY od EmailService (maile transakcyjne):
 * inny interfejs, inne tokeny/konfiguracja, inna domena nadawcy. Maile transakcyjne nigdy nie idą tym
 * transportem, a maile symulacji nigdy przez EmailService - dostawca dla symulacji może się zmienić
 * (regulamin dostawcy, reputacja) bez dotykania poczty transakcyjnej.
 *
 * Kontrakt: `send` albo zwraca wynik (dostawca PRZYJĄŁ wiadomość), albo rzuca PhishingTransportError.
 * Błąd niesie `retryable` - job wysyłający ponawia TYLKO błędy, przy których wiadomo, że wysyłka nie nastąpiła
 * (błąd połączenia przed wysłaniem, 429, 5xx), a resztę (odrzucony adres, zły token, TIMEOUT_UNKNOWN) oznacza
 * jako nieudane bez ponawiania ("co najwyżej raz").
 */
export interface PhishingMailMessage {
  toEmail: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
}

export interface PhishingSendResult {
  // Identyfikator wiadomości nadany przez dostawcę (jeśli zwraca); do diagnostyki, nie do śledzenia osób.
  providerMessageId: string | null;
}

export class PhishingTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    // Kod diagnostyczny bez danych osobowych (np. "HTTP_429", "SMTP_550", "NETWORK").
    readonly code: string,
  ) {
    super(message);
    this.name = 'PhishingTransportError';
  }
}

/**
 * Kody porażek, przy których NIE wiadomo, czy dostawca wysłał wiadomość (timeout, zerwane połączenie po wysłaniu,
 * przerwany job). Polityka "co najwyżej raz": takich błędów NIE ponawiamy (duplikat maila phishingowego jest gorszy
 * niż brak); odbiorca dostaje failedAt z tym kodem, a szczegóły kampanii pokazują go jako "niepewne".
 */
export const UNCERTAIN_FAILURE_CODES = ['TIMEOUT_UNKNOWN', 'RESULT_UNKNOWN', 'INTERRUPTED_UNKNOWN'] as const;

/**
 * Czy kod porażki oznacza wynik NIEPEWNY (dostawca mógł wysłać): timeouty i nieznane wyniki oraz każde HTTP 5xx
 * (odpowiedź 500/502/504 z bramki nie dowodzi, że wiadomość nie została przyjęta).
 */
export function isUncertainFailureCode(code: string): boolean {
  return (UNCERTAIN_FAILURE_CODES as readonly string[]).includes(code) || /^HTTP_5\d\d$/.test(code);
}

// Błędy zgłaszane PRZED wysłaniem wiadomości (nie udało się nawiązać połączenia / uwierzytelnić): wiadomo, że nic nie wyszło.
// ECONNECTION jest tu TYLKO w fazie łączenia (patrz CONNECT_COMMANDS): nodemailer zgłasza ten sam kod także przy
// zerwaniu połączenia po DATA, gdy wiadomość mogła zostać przyjęta.
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'EDNS', 'EAUTH', 'ETLS']);
const CONNECT_COMMANDS = new Set(['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH']);

function collectCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') codes.push(code);
    current = cause;
  }
  return codes;
}

/**
 * Klasyfikacja błędu bez odpowiedzi dostawcy. Ponawialny tylko wtedy, gdy WIADOMO, że wysyłka nie nastąpiła
 * (błąd połączenia przed wysłaniem); timeout i pozostałe niejednoznaczne błędy => nieponawialne, kod "niepewny".
 * Komunikat oryginalnego błędu jest pomijany (bywa z adresem odbiorcy albo danymi dostępowymi).
 */
export function classifyTransportFailure(error: unknown): PhishingTransportError {
  const codes = collectCodes(error);
  const command = (error as { command?: unknown } | null)?.command;
  const connectPhase = codes.includes('ECONNECTION') && typeof command === 'string' && CONNECT_COMMANDS.has(command);
  if (connectPhase || codes.some((code) => NOT_SENT_CODES.has(code))) {
    return new PhishingTransportError('Nie nawiązano połączenia z dostawcą (wiadomość nie została wysłana).', true, 'NETWORK');
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError' || codes.includes('ETIMEDOUT') || codes.includes('UND_ERR_HEADERS_TIMEOUT') || codes.includes('UND_ERR_BODY_TIMEOUT')) {
    return new PhishingTransportError('Timeout - dostawca mógł wysłać wiadomość.', false, 'TIMEOUT_UNKNOWN');
  }
  return new PhishingTransportError('Nieznany wynik wysyłki - dostawca mógł wysłać wiadomość.', false, 'RESULT_UNKNOWN');
}

export abstract class PhishingMailTransport {
  /** Nazwa implementacji (do logów i statusu w UI): mailersend | smtp | log | none. */
  abstract readonly name: string;

  abstract send(message: PhishingMailMessage): Promise<PhishingSendResult>;
}
