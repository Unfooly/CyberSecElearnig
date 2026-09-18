import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailOptions } from './interfaces/send-email-options.interface';
import { renderTemplate } from './templates';

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';
const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly token: string | undefined;
  private readonly from: string | undefined;
  private readonly fromName: string;
  private readonly assetBaseUrl: string | undefined;
  private readonly logLinksInDevMode: boolean;

  constructor(configService: ConfigService) {
    // Trimowane tu, żeby token porównywany w redactToken() był dokładnie
    // tym, który idzie w nagłówku Authorization.
    const rawToken = configService.get<string>('MAILERSEND_API_TOKEN')?.trim();
    this.token = rawToken && rawToken !== '' ? rawToken : undefined;
    this.from = configService.get<string>('EMAIL_FROM');
    this.fromName = configService.get<string>('EMAIL_FROM_NAME') ?? 'Unfooly';
    this.assetBaseUrl = configService.get<string>('FRONTEND_URL');

    // Bez tokenu send() loguje pełne templateData - w tym jednorazowe linki
    // resetu/aktywacji/weryfikacji. Na produkcji to wyciek sekretów do logów,
    // więc odmawiamy startu, chyba że jawnie zezwolono (lokalny stack testowy).
    if (
      !this.token &&
      configService.get<string>('NODE_ENV') === 'production' &&
      configService.get<string>('ALLOW_EMAIL_DEV_MODE') !== 'true'
    ) {
      throw new Error(
        'Brak MAILERSEND_API_TOKEN przy NODE_ENV=production - ustaw token albo (tylko lokalnie) ALLOW_EMAIL_DEV_MODE=true.',
      );
    }

    if (this.token && !this.from && configService.get<string>('NODE_ENV') === 'production') {
      // Puste from.email = MailerSend odrzuca KAŻDĄ wiadomość (422).
      throw new Error('Brak EMAIL_FROM przy NODE_ENV=production.');
    }

    this.logLinksInDevMode =
      ['development', 'test', undefined].includes(configService.get<string>('NODE_ENV')) ||
      configService.get<string>('ALLOW_EMAIL_DEV_MODE') === 'true';

    if (!this.token) {
      this.logger.warn(
        'MAILERSEND_API_TOKEN nie jest ustawiony - e-maile będą logowane do konsoli zamiast wysyłane.',
      );
    }
  }

  /**
   * Wysyłka przez MailerSend (POST /v1/email). Treść renderowana z szablonów
   * w kodzie (email/templates).
   *
   * Zwraca true, gdy dostawca przyjął wiadomość (albo w trybie dev
   * zalogowano ją zamiast wysłać), false przy błędzie - wywołujący może
   * dzięki temu poinformować użytkownika, że mail nie wyszedł.
   *
   * Nigdy nie rzuca: nieudana wysyłka nie może wywalić flow, który ją
   * zainicjował (np. rejestracji). Jeśli kiedyś powstanie flow, dla którego
   * e-mail jest krytyczny, ta decyzja (nie ta metoda) powinna to obsłużyć
   * osobno - patrz README.
   */
  async send(options: SendEmailOptions): Promise<boolean> {
    if (!this.token) {
      // Pełne templateData zawiera jednorazowe linki (aktywacja/reset/
      // weryfikacja) - logujemy je tylko w dev/test albo przy jawnym
      // ALLOW_EMAIL_DEV_MODE; staging z pustym tokenem loguje samo podsumowanie.
      const details = this.logLinksInDevMode ? ` | Dane: ${JSON.stringify(options.templateData)}` : '';
      this.logger.log(
        `[EMAIL DEV MODE] Do: ${options.to} | Temat: ${options.subject} | Szablon: ${options.templateName}${details}`,
      );
      return true;
    }

    const rendered = renderTemplate(options.templateName, options.templateData, {
      assetBaseUrl: this.assetBaseUrl,
    });
    if (!rendered) {
      this.logger.error(`Nieznany szablon e-mail: ${options.templateName} (do: ${options.to})`);
      return false;
    }

    try {
      const response = await fetch(MAILERSEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          from: { email: this.from ?? '', name: this.fromName },
          to: [{ email: options.to }],
          subject: options.subject,
          html: rendered.html,
          text: rendered.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(
          `MailerSend odrzucił e-mail (szablon: ${options.templateName}, do: ${options.to}): HTTP ${response.status} ${this.redactToken(detail).slice(0, 300)}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Nie udało się wysłać e-maila (szablon: ${options.templateName}, do: ${options.to}): ${this.extractSafeErrorMessage(error)}`,
      );
      // Świadomie NIE rzucamy dalej - patrz komentarz nad metodą.
      return false;
    }
  }

  private extractSafeErrorMessage(error: unknown): string {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return this.redactToken(rawMessage);
  }

  private redactToken(message: string): string {
    if (this.token && message.includes(this.token)) {
      return message.split(this.token).join('[REDACTED]');
    }
    return message;
  }
}
