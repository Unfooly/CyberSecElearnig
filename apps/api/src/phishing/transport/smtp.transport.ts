import { createTransport, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { PhishingMailMessage, PhishingMailTransport, PhishingSendResult, PhishingTransportError } from './phishing-mail-transport';

function isLoopback(smtpUrl: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(smtpUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * SMTP (nodemailer) dla symulacji: PHISHING_SMTP_URL (smtp:// albo smtps://user:haslo@host:port). Alternatywa dla
 * MailerSend, gdyby dostawca zmienił się z przyczyn regulaminowych. Adres URL zawiera dane dostępowe - nigdy
 * nie jest logowany. Treść i adresy nie trafiają do logów ani do komunikatów błędów.
 */
export class SmtpPhishingTransport extends PhishingMailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(smtpUrl: string, transporter?: Transporter) {
    super();
    this.transporter =
      transporter ??
      createTransport({
        url: smtpUrl,
        // Bez oportunistycznego STARTTLS (da się je wyciąć): dla smtp:// wymuszamy TLS, poza lokalnym Mailpitem.
        requireTLS: !isLoopback(smtpUrl),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      } as SMTPTransport.Options);
  }

  async send(message: PhishingMailMessage): Promise<PhishingSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: { name: message.fromName, address: message.fromEmail },
        to: { name: '', address: message.toEmail },
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { providerMessageId: typeof info.messageId === 'string' ? info.messageId : null };
    } catch (error) {
      const { responseCode } = error as { responseCode?: number };
      if (typeof responseCode === 'number') {
        // 4xx = przejściowe (greylisting, limit), 5xx = trwałe odrzucenie (adres, polityka).
        throw new PhishingTransportError(`SMTP odrzucił wiadomość (kod ${responseCode}).`, responseCode >= 400 && responseCode < 500, `SMTP_${responseCode}`);
      }
      // Brak kodu odpowiedzi = problem z połączeniem/TLS/uwierzytelnieniem - traktujemy jako przejściowy.
      throw new PhishingTransportError('SMTP: błąd połączenia.', true, 'NETWORK');
    }
  }
}
