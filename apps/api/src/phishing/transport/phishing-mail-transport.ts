/**
 * Transport wysyłki maili SYMULACJI phishingowych. Celowo OSOBNY od EmailService (maile transakcyjne):
 * inny interfejs, inne tokeny/konfiguracja, inna domena nadawcy. Maile transakcyjne nigdy nie idą tym
 * transportem, a maile symulacji nigdy przez EmailService - dostawca dla symulacji może się zmienić
 * (regulamin dostawcy, reputacja) bez dotykania poczty transakcyjnej.
 *
 * Kontrakt: `send` albo zwraca wynik (dostawca PRZYJĄŁ wiadomość), albo rzuca PhishingTransportError.
 * Błąd niesie `retryable` - job wysyłający ponawia tylko błędy przejściowe (sieć, 429, 5xx), a błędy trwałe
 * (np. odrzucony adres, zły token) oznacza jako nieudane bez ponawiania.
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

export abstract class PhishingMailTransport {
  /** Nazwa implementacji (do logów i statusu w UI): mailersend | smtp | log | none. */
  abstract readonly name: string;

  abstract send(message: PhishingMailMessage): Promise<PhishingSendResult>;
}
