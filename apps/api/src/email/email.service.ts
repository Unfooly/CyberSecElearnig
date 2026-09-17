import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServerClient } from 'postmark';
import { SendEmailOptions } from './interfaces/send-email-options.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: ServerClient | null;
  private readonly token: string | undefined;
  private readonly from: string | undefined;

  constructor(configService: ConfigService) {
    // Trimowane tu (nie tylko przy sprawdzaniu pustości) - pakiet postmark
    // sam trimuje token przed użyciem w nagłówku (BaseClient), więc bez
    // tego this.token i token faktycznie wysyłany do Postmarka mogłyby się
    // różnić białymi znakami, co osłabiałoby porównanie w redactToken().
    this.token = configService.get<string>('POSTMARK_API_TOKEN')?.trim();
    this.from = configService.get<string>('EMAIL_FROM');
    this.client = this.token && this.token !== '' ? new ServerClient(this.token) : null;

    if (!this.client) {
      this.logger.warn(
        'POSTMARK_API_TOKEN nie jest ustawiony - e-maile będą logowane do konsoli zamiast wysyłane.',
      );
    }
  }

  /**
   * Generyczna wysyłka przez Postmark Templates API (szablon HTML żyje w
   * panelu Postmark, nie w kodzie - zmiana treści maila nie wymaga deploya).
   * Fundament pod przyszłe flow (reset hasła, powiadomienia) - ta metoda
   * sama w sobie nic jeszcze nie wywołuje.
   *
   * Nigdy nie rzuca: nieudana wysyłka nie może wywalić flow, który ją
   * zainicjował (np. rejestracji). Jeśli kiedyś powstanie flow, dla którego
   * e-mail jest krytyczny, ta decyzja (nie ta metoda) powinna to obsłużyć
   * osobno - patrz README.
   */
  async send(options: SendEmailOptions): Promise<void> {
    if (!this.client) {
      this.logger.log(
        `[EMAIL DEV MODE] Do: ${options.to} | Temat: ${options.subject} | Szablon: ${options.templateName} | Dane: ${JSON.stringify(options.templateData)}`,
      );
      return;
    }

    try {
      await this.client.sendEmailWithTemplate({
        From: this.from ?? '',
        To: options.to,
        TemplateAlias: options.templateName,
        // Postmark Templates API nie ma osobnego pola Subject - temat
        // definiuje szablon w panelu Postmark. `subject` dokładamy do
        // TemplateModel, żeby autor szablonu mógł go użyć (np. {{subject}}
        // w polu tematu szablonu), zamiast go po cichu gubić.
        TemplateModel: { ...options.templateData, subject: options.subject },
      });
    } catch (error) {
      this.logger.error(
        `Nie udało się wysłać e-maila (szablon: ${options.templateName}, do: ${options.to}): ${this.extractSafeErrorMessage(error)}`,
      );
      // Świadomie NIE rzucamy dalej - patrz komentarz nad metodą.
    }
  }

  /**
   * Wyciąga WYŁĄCZNIE komunikat błędu (nigdy cały obiekt) i aktywnie usuwa
   * z niego token, jeśli się tam znajdzie - obrona w głąb, niezależna od
   * tego, co faktycznie robi wewnętrzny klient HTTP Postmarka (sprawdzone:
   * PostmarkError niesie tylko message/code/statusCode zbudowane z treści
   * odpowiedzi API, nie z żądania - ale to nie jest gwarancja API pakietu
   * `postmark`, więc i tak nie ufamy temu bezwarunkowo).
   */
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
