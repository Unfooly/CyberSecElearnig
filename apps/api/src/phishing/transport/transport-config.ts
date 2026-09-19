import { ConfigService } from '@nestjs/config';
import { HOSTNAME } from '../phishing-mail-composer';
import { LogPhishingTransport } from './log.transport';
import { MailerSendPhishingTransport } from './mailersend.transport';
import { NotConfiguredPhishingTransport } from './not-configured.transport';
import { PhishingMailTransport } from './phishing-mail-transport';
import { SmtpPhishingTransport } from './smtp.transport';

export type PhishingTransportKind = 'mailersend' | 'smtp' | 'log';

export type PhishingTransportConfig =
  | { kind: 'mailersend'; token: string }
  | { kind: 'smtp'; url: string }
  | { kind: 'log' }
  | { kind: 'none'; reason: string };

/** Domena adresu e-mail (mała litera) albo null. */
function domainOfEmail(email: string | undefined): string | null {
  // Obsługuje też format "Nazwa <adres@domena>".
  const domain = email?.match(/@([^@<>\s]+?)>?\s*$/)?.[1]?.toLowerCase();
  return domain ? domain : null;
}

function hostOfUrl(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Domeny pokrywają się, gdy są równe albo jedna jest subdomeną drugiej. */
export function domainsOverlap(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Wybór transportu symulacji z konfiguracji (env). CZYSTA funkcja - ta sama logika służy fabryce providera i
 * statusowi w UI (GET /phishing/config).
 *
 * - PHISHING_MAIL_TRANSPORT = mailersend | smtp | log (brak: produkcja => "none", poza produkcją => log),
 * - mailersend wymaga PHISHING_MAILERSEND_API_TOKEN (WŁASNY token; token poczty transakcyjnej nie jest używany),
 * - smtp wymaga PHISHING_SMTP_URL (smtp:// lub smtps://),
 * - prawdziwe transporty wymagają PHISHING_EMAIL_DOMAIN, a na produkcji domena nadawcy nie może pokrywać się z
 *   domeną poczty transakcyjnej (EMAIL_FROM) ani domeną aplikacji (FRONTEND_URL) - reputacja kampanii nie może
 *   zaszkodzić mailom transakcyjnym,
 * - transport "log" jest zabroniony na produkcji.
 */
export function resolvePhishingTransportConfig(config: Pick<ConfigService, 'get'>): PhishingTransportConfig {
  // Fail-closed: tylko jawnie lokalne środowiska (development/test/brak NODE_ENV) są luźne; staging i każda inna
  // wartość traktowane są jak produkcja.
  const env = config.get<string>('NODE_ENV')?.trim().toLowerCase() ?? '';
  const production = !['', 'development', 'test'].includes(env);
  const selected = config.get<string>('PHISHING_MAIL_TRANSPORT')?.trim().toLowerCase();
  const kind = selected || (production ? '' : 'log');

  if (kind === '') {
    return { kind: 'none', reason: 'TRANSPORT_NOT_SELECTED' };
  }
  if (kind === 'log') {
    return production ? { kind: 'none', reason: 'LOG_TRANSPORT_FORBIDDEN_IN_PRODUCTION' } : { kind: 'log' };
  }
  if (kind !== 'mailersend' && kind !== 'smtp') {
    return { kind: 'none', reason: 'UNKNOWN_TRANSPORT' };
  }

  const senderDomain = config.get<string>('PHISHING_EMAIL_DOMAIN')?.trim().toLowerCase();
  if (!senderDomain) {
    return { kind: 'none', reason: 'SENDER_DOMAIN_MISSING' };
  }
  if (!HOSTNAME.test(senderDomain)) {
    return { kind: 'none', reason: 'SENDER_DOMAIN_INVALID' };
  }
  if (production) {
    // Nieznana domena poczty transakcyjnej albo aplikacji = nie da się wykluczyć pokrywania => blokada.
    const transactionalDomains = [domainOfEmail(config.get<string>('EMAIL_FROM')), hostOfUrl(config.get<string>('FRONTEND_URL'))];
    if (transactionalDomains.some((domain) => domain === null)) {
      return { kind: 'none', reason: 'TRANSACTIONAL_DOMAIN_UNKNOWN' };
    }
    if (transactionalDomains.some((domain) => domainsOverlap(senderDomain, domain as string))) {
      return { kind: 'none', reason: 'SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL' };
    }
  }

  if (kind === 'mailersend') {
    const token = config.get<string>('PHISHING_MAILERSEND_API_TOKEN')?.trim();
    if (!token) {
      return { kind: 'none', reason: 'MAILERSEND_TOKEN_MISSING' };
    }
    // Ten sam token = to samo konto i ta sama reputacja: rozdział byłby tylko na papierze.
    if (token === config.get<string>('MAILERSEND_API_TOKEN')?.trim()) {
      return { kind: 'none', reason: 'TOKEN_SHARED_WITH_TRANSACTIONAL' };
    }
    return { kind: 'mailersend', token };
  }

  const url = config.get<string>('PHISHING_SMTP_URL')?.trim();
  if (!url) {
    return { kind: 'none', reason: 'SMTP_URL_MISSING' };
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'smtp:' || protocol === 'smtps:' ? { kind: 'smtp', url } : { kind: 'none', reason: 'SMTP_URL_INVALID' };
  } catch {
    return { kind: 'none', reason: 'SMTP_URL_INVALID' };
  }
}

export function createPhishingTransport(config: Pick<ConfigService, 'get'>): PhishingMailTransport {
  const resolved = resolvePhishingTransportConfig(config);
  switch (resolved.kind) {
    case 'mailersend':
      return new MailerSendPhishingTransport(resolved.token);
    case 'smtp':
      return new SmtpPhishingTransport(resolved.url);
    case 'log':
      return new LogPhishingTransport();
    default:
      return new NotConfiguredPhishingTransport(resolved.reason);
  }
}
