import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePhishingTransportConfig } from './transport/transport-config';

export interface PhishingConfigStatus {
  // Wybrany transport (mailersend | smtp | log | none) i czy można nim wysyłać.
  transport: string;
  configured: boolean;
  // Kod przyczyny braku konfiguracji (bez danych wrażliwych); null gdy skonfigurowane.
  reason: string | null;
  senderDomain: string | null;
  // Host strony lądowania (bez ścieżki i tokenów) - do ostrzeżeń w kreatorze.
  landingHost: string | null;
  // "log" nic nie wysyła (tryb deweloperski).
  sendsRealMail: boolean;
}

/** Konfiguracja modułu symulacji (domena nadawcy, strona lądowania, status transportu). */
@Injectable()
export class PhishingConfigService {
  constructor(private readonly config: ConfigService) {}

  senderDomain(): string | null {
    const domain = this.config.get<string>('PHISHING_EMAIL_DOMAIN')?.trim().toLowerCase();
    return domain ? domain : null;
  }

  isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Baza publicznych linków odbiorców: PHISHING_LANDING_BASE_URL, a w środowisku testowym domyślnie FRONTEND_URL. */
  landingBaseUrl(): string {
    const explicit = this.config.get<string>('PHISHING_LANDING_BASE_URL')?.trim();
    if (explicit) {
      return explicit.replace(/\/+$/, '');
    }
    return (this.config.get<string>('FRONTEND_URL')?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  }

  status(): PhishingConfigStatus {
    const resolved = resolvePhishingTransportConfig(this.config);
    let landingHost: string | null = null;
    try {
      landingHost = new URL(this.landingBaseUrl()).host;
    } catch {
      landingHost = null;
    }
    return {
      transport: resolved.kind,
      configured: resolved.kind !== 'none',
      reason: resolved.kind === 'none' ? resolved.reason : null,
      senderDomain: this.senderDomain(),
      landingHost,
      sendsRealMail: resolved.kind === 'mailersend' || resolved.kind === 'smtp',
    };
  }
}
