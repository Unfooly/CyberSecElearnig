import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailOutcome, MailResult, SendEmailOptions } from './interfaces/send-email-options.interface';
import { renderTemplate } from './templates';

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';
const REQUEST_TIMEOUT_MS = 10_000;

// Błędy sieci PRZED wysłaniem żądania (nie ma z kim rozmawiać): wiadomość na pewno nie wyszła.
const PRE_SEND_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

/**
 * Timeout i zerwane połączenie po wysłaniu żądania => wynik NIEPEWNY (dostawca mógł przyjąć wiadomość), jak TIMEOUT_UNKNOWN /
 * RESULT_UNKNOWN w wysyłce kampanii; błąd rozwiązywania nazwy albo odmowa połączenia => pewne niepowodzenie.
 */
export function classifyFetchError(error: unknown): MailResult {
  const name = (error as Error | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { status: 'UNCERTAIN', code: 'TIMEOUT_UNKNOWN' };
  }
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  if (cause?.code && PRE_SEND_ERROR_CODES.has(cause.code)) {
    return { status: 'REJECTED', code: 'CONNECTION' };
  }
  return { status: 'UNCERTAIN', code: 'RESULT_UNKNOWN' };
}

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
  async send(options: SendEmailOptions, outcome?: MailOutcome): Promise<boolean> {
    const result = await this.deliver(options);
    if (outcome) outcome.result = result;
    return result.status === 'SENT';
  }

  /** Klasyfikacja wyniku wysyłki: patrz MailResult. Nigdy nie rzuca. */
  private async deliver(options: SendEmailOptions): Promise<MailResult> {
    if (!this.token) {
      // Pełne templateData zawiera jednorazowe linki (aktywacja/reset/
      // weryfikacja) - logujemy je tylko w dev/test albo przy jawnym
      // ALLOW_EMAIL_DEV_MODE; staging z pustym tokenem loguje samo podsumowanie.
      const details = this.logLinksInDevMode ? ` | Dane: ${JSON.stringify(options.templateData)}` : '';
      this.logger.log(
        `[EMAIL DEV MODE] Do: ${options.to} | Temat: ${options.subject} | Szablon: ${options.templateName}${details}`,
      );
      return { status: 'SENT' };
    }

    const rendered = renderTemplate(options.templateName, options.templateData, {
      assetBaseUrl: this.assetBaseUrl,
    });
    if (!rendered) {
      this.logger.error(`Nieznany szablon e-mail: ${options.templateName} (do: ${options.to})`);
      return { status: 'REJECTED', code: 'TEMPLATE_UNKNOWN' };
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
        // 5xx (i 408 - timeout po stronie bramki) nie dowodzi, że nic nie wyszło: bramka mogła zwrócić 502/504 po przekazaniu
        // wiadomości; pozostałe 4xx to pewne odrzucenie.
        return response.status >= 500 || response.status === 408
          ? { status: 'UNCERTAIN', code: `HTTP_${response.status}` }
          : { status: 'REJECTED', code: `HTTP_${response.status}` };
      }
      return { status: 'SENT' };
    } catch (error) {
      this.logger.error(
        `Nie udało się wysłać e-maila (szablon: ${options.templateName}, do: ${options.to}): ${this.extractSafeErrorMessage(error)}`,
      );
      // Świadomie NIE rzucamy dalej - patrz komentarz nad metodą.
      return classifyFetchError(error);
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
