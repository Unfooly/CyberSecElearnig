import { PhishingMailMessage, PhishingMailTransport, PhishingSendResult, PhishingTransportError } from './phishing-mail-transport';

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * MailerSend (REST) dla symulacji. Używa WŁASNEGO tokenu (PHISHING_MAILERSEND_API_TOKEN) - nigdy tokenu
 * poczty transakcyjnej (MAILERSEND_API_TOKEN). Treść wiadomości, adres odbiorcy i token NIE trafiają do logów ani
 * do komunikatów błędów (błąd niesie tylko kod HTTP).
 */
export class MailerSendPhishingTransport extends PhishingMailTransport {
  readonly name = 'mailersend';

  constructor(private readonly token: string) {
    super();
  }

  async send(message: PhishingMailMessage): Promise<PhishingSendResult> {
    let response: Response;
    try {
      response = await fetch(MAILERSEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          from: { email: message.fromEmail, name: message.fromName },
          to: [{ email: message.toEmail }],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Timeout / brak sieci: przejściowe. Komunikat oryginalnego błędu pomijamy (bywa z adresem).
      // UWAGA: po timeoucie dostawca mógł już przyjąć wiadomość - ponowienie może dać duplikat. Job wysyłający
      // (commit 3) świadomie przyjmuje "co najwyżej raz" dla takich błędów albo akceptuje ryzyko duplikatu.
      throw new PhishingTransportError('MailerSend: brak odpowiedzi (sieć/timeout).', true, 'NETWORK');
    }

    if (response.ok) {
      return { providerMessageId: response.headers.get('x-message-id') };
    }
    // 429 i 5xx przejściowe; pozostałe 4xx (zły token, niepoprawny adres, blokada konta) trwałe.
    const retryable = response.status === 429 || response.status >= 500;
    throw new PhishingTransportError(`MailerSend odrzucił wiadomość (HTTP ${response.status}).`, retryable, `HTTP_${response.status}`);
  }
}
