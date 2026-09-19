import { classifyTransportFailure, PhishingMailMessage, PhishingMailTransport, PhishingSendResult, PhishingTransportError } from './phishing-mail-transport';

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
    } catch (error) {
      // Timeout NIE jest ponawialny (TIMEOUT_UNKNOWN): dostawca mógł już przyjąć wiadomość, a duplikat maila
      // symulacji jest gorszy niż brak. Ponawiamy tylko błąd połączenia PRZED wysłaniem.
      throw classifyTransportFailure(error);
    }

    if (response.ok) {
      return { providerMessageId: response.headers.get('x-message-id') };
    }
    // Ponawiamy TYLKO 429 (limit: dostawca odrzucił żądanie, nic nie wysłał). 5xx NIE dowodzi, że wiadomość nie została
    // przyjęta (bramka mogła zwrócić 502/504 po przekazaniu), więc jest nieponawialne i liczone jako "niepewne"
    // (isUncertainFailureCode). Pozostałe 4xx (zły token, niepoprawny adres, blokada konta) to trwałe odrzucenie.
    const retryable = response.status === 429;
    throw new PhishingTransportError(`MailerSend odrzucił wiadomość (HTTP ${response.status}).`, retryable, `HTTP_${response.status}`);
  }
}
