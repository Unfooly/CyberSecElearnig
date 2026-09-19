import { Logger } from '@nestjs/common';
import { PhishingMailMessage, PhishingMailTransport, PhishingSendResult } from './phishing-mail-transport';

/**
 * Transport deweloperski: nic nie wysyła, loguje samo podsumowanie (nadawca, domena odbiorcy, długość) - bez treści
 * i bez pełnego adresu odbiorcy. Niedozwolony na produkcji (patrz resolvePhishingTransportConfig).
 */
export class LogPhishingTransport extends PhishingMailTransport {
  readonly name = 'log';
  private readonly logger = new Logger('PhishingMailTransport');

  async send(message: PhishingMailMessage): Promise<PhishingSendResult> {
    const recipientDomain = message.toEmail.split('@')[1] ?? '?';
    this.logger.log(
      `[PHISHING DEV MODE] Od: ${message.fromName} <${message.fromEmail}> | Do: (…)@${recipientDomain} | Temat: ${message.subject} | HTML: ${message.html.length} znaków`,
    );
    return { providerMessageId: null };
  }
}
