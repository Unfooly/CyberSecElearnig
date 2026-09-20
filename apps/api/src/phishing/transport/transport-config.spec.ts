import { createPhishingTransport, domainsOverlap, resolvePhishingTransportConfig } from './transport-config';

const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as never;

const PROD = { NODE_ENV: 'production', PHISHING_EMAIL_DOMAIN: 'symulacje.example.net', EMAIL_FROM: 'no-reply@unfooly.example.com', FRONTEND_URL: 'https://app.unfooly.example.com' };

describe('resolvePhishingTransportConfig', () => {
  describe('wybór transportu', () => {
    it('brak PHISHING_MAIL_TRANSPORT: poza produkcją log (nic nie wychodzi), na produkcji "none"', () => {
      expect(resolvePhishingTransportConfig(config({ NODE_ENV: 'development' }))).toEqual({ kind: 'log' });
      expect(resolvePhishingTransportConfig(config({}))).toEqual({ kind: 'log' });
      expect(resolvePhishingTransportConfig(config(PROD))).toEqual({ kind: 'none', reason: 'TRANSPORT_NOT_SELECTED' });
    });

    it('log jest ZABRONIONY na produkcji', () => {
      expect(resolvePhishingTransportConfig(config({ ...PROD, PHISHING_MAIL_TRANSPORT: 'log' }))).toEqual({
        kind: 'none',
        reason: 'LOG_TRANSPORT_FORBIDDEN_IN_PRODUCTION',
      });
    });

    it('mailersend: wymaga WŁASNEGO tokenu (PHISHING_MAILERSEND_API_TOKEN); token poczty transakcyjnej nie wystarcza', () => {
      const base = { ...PROD, PHISHING_MAIL_TRANSPORT: 'mailersend' };

      expect(resolvePhishingTransportConfig(config({ ...base, PHISHING_MAILERSEND_API_TOKEN: 'ph-token' }))).toEqual({ kind: 'mailersend', token: 'ph-token' });
      expect(resolvePhishingTransportConfig(config({ ...base, MAILERSEND_API_TOKEN: 'tx-token' }))).toEqual({ kind: 'none', reason: 'MAILERSEND_TOKEN_MISSING' });
      expect(resolvePhishingTransportConfig(config({ ...base, PHISHING_MAILERSEND_API_TOKEN: '   ' }))).toEqual({ kind: 'none', reason: 'MAILERSEND_TOKEN_MISSING' });
    });

    it('smtp: wymaga PHISHING_SMTP_URL ze schematem smtp:// albo smtps://', () => {
      const base = { ...PROD, PHISHING_MAIL_TRANSPORT: 'smtp' };

      expect(resolvePhishingTransportConfig(config({ ...base, PHISHING_SMTP_URL: 'smtps://u:p@smtp.example.net:465' }))).toEqual({ kind: 'smtp', url: 'smtps://u:p@smtp.example.net:465' });
      expect(resolvePhishingTransportConfig(config(base))).toEqual({ kind: 'none', reason: 'SMTP_URL_MISSING' });
      for (const url of ['http://smtp.example.net', 'nie-url', 'ftp://x.example.net']) {
        expect(resolvePhishingTransportConfig(config({ ...base, PHISHING_SMTP_URL: url }))).toEqual({ kind: 'none', reason: 'SMTP_URL_INVALID' });
      }
    });

    it('nieznana wartość (literówka) => "none", nigdy cichy fallback na inny transport', () => {
      expect(resolvePhishingTransportConfig(config({ ...PROD, PHISHING_MAIL_TRANSPORT: 'sendgrid' }))).toEqual({ kind: 'none', reason: 'UNKNOWN_TRANSPORT' });
    });

    it('wartość jest normalizowana (wielkość liter, spacje)', () => {
      expect(resolvePhishingTransportConfig(config({ ...PROD, PHISHING_MAIL_TRANSPORT: '  MailerSend ', PHISHING_MAILERSEND_API_TOKEN: 't' }))).toEqual({ kind: 'mailersend', token: 't' });
    });
  });

  describe('domena nadawcy', () => {
    const mailersend = { ...PROD, PHISHING_MAIL_TRANSPORT: 'mailersend', PHISHING_MAILERSEND_API_TOKEN: 't' };

    it('prawdziwy transport wymaga PHISHING_EMAIL_DOMAIN', () => {
      expect(resolvePhishingTransportConfig(config({ ...mailersend, PHISHING_EMAIL_DOMAIN: undefined }))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_MISSING' });
    });

    it.each([
      ['ta sama co poczta transakcyjna (EMAIL_FROM)', 'unfooly.example.com'],
      ['subdomena domeny transakcyjnej', 'kampanie.unfooly.example.com'],
      ['domena nadrzędna względem transakcyjnej', 'example.com'],
      ['host aplikacji (FRONTEND_URL)', 'app.unfooly.example.com'],
    ])('NA PRODUKCJI: %s => zablokowane (reputacja kampanii nie może szkodzić mailom transakcyjnym)', (_label, domain) => {
      expect(resolvePhishingTransportConfig(config({ ...mailersend, PHISHING_EMAIL_DOMAIN: domain }))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL' });
    });

    it('ten sam token co poczta transakcyjna => zablokowane (rozdział kont, nie tylko nazw zmiennych)', () => {
      expect(resolvePhishingTransportConfig(config({ ...mailersend, MAILERSEND_API_TOKEN: 't' }))).toEqual({ kind: 'none', reason: 'TOKEN_SHARED_WITH_TRANSACTIONAL' });
      expect(resolvePhishingTransportConfig(config({ ...mailersend, MAILERSEND_API_TOKEN: 'inny' }))).toEqual({ kind: 'mailersend', token: 't' });
    });

    it('fail-closed: nieznana domena EMAIL_FROM albo FRONTEND_URL na produkcji => zablokowane', () => {
      for (const missing of ['EMAIL_FROM', 'FRONTEND_URL']) {
        expect(resolvePhishingTransportConfig(config({ ...mailersend, [missing]: undefined }))).toEqual({ kind: 'none', reason: 'TRANSACTIONAL_DOMAIN_UNKNOWN' });
      }
      expect(resolvePhishingTransportConfig(config({ ...mailersend, FRONTEND_URL: 'nie-url' }))).toEqual({ kind: 'none', reason: 'TRANSACTIONAL_DOMAIN_UNKNOWN' });
    });

    it('EMAIL_FROM w formacie "Nazwa <adres>" też jest rozpoznawany (pokrywanie wykryte)', () => {
      const from = { ...mailersend, EMAIL_FROM: 'Unfooly <no-reply@unfooly.example.com>', PHISHING_EMAIL_DOMAIN: 'unfooly.example.com' };

      expect(resolvePhishingTransportConfig(config(from))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL' });
    });

    it('staging i inne wartości NODE_ENV traktowane jak produkcja (tylko development/test/brak są luźne)', () => {
      expect(resolvePhishingTransportConfig(config({ ...mailersend, NODE_ENV: 'staging', PHISHING_EMAIL_DOMAIN: 'unfooly.example.com' }))).toEqual({
        kind: 'none',
        reason: 'SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL',
      });
      expect(resolvePhishingTransportConfig(config({ NODE_ENV: 'staging', PHISHING_MAIL_TRANSPORT: 'log' }))).toEqual({
        kind: 'none',
        reason: 'LOG_TRANSPORT_FORBIDDEN_IN_PRODUCTION',
      });
    });

    it.each(['symulacje.example.net.', 'symulacje', 'sym ulacje.example.net', 'https://symulacje.example.net'])('nieprawidłowa domena nadawcy "%s" => SENDER_DOMAIN_INVALID', (domain) => {
      expect(resolvePhishingTransportConfig(config({ ...mailersend, PHISHING_EMAIL_DOMAIN: domain }))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_INVALID' });
    });

    it('jawny opt-in środowiska testowego: wspólna domena próbna (nakładanie) przechodzi na "produkcji", ale wspólny TOKEN nadal jest zablokowany', () => {
      const shared = { ...mailersend, PHISHING_EMAIL_DOMAIN: 'unfooly.example.com', PHISHING_ALLOW_SHARED_TRANSACTIONAL_DOMAIN: 'yes-this-is-a-test-environment' };

      expect(resolvePhishingTransportConfig(config(shared))).toEqual({ kind: 'mailersend', token: 't' });
      expect(resolvePhishingTransportConfig(config({ ...shared, MAILERSEND_API_TOKEN: 't' }))).toEqual({ kind: 'none', reason: 'TOKEN_SHARED_WITH_TRANSACTIONAL' });
      expect(resolvePhishingTransportConfig(config({ ...shared, PHISHING_EMAIL_DOMAIN: 'zle domena' }))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_INVALID' });
    });

    it.each(['true', 'yes', '1', 'YES-THIS-IS-A-TEST-ENVIRONMENT', ''])('opt-in o innej wartości ("%s") NIE działa: nakładanie domen nadal zablokowane', (value) => {
      const overlapping = { ...mailersend, PHISHING_EMAIL_DOMAIN: 'unfooly.example.com', PHISHING_ALLOW_SHARED_TRANSACTIONAL_DOMAIN: value };

      expect(resolvePhishingTransportConfig(config(overlapping))).toEqual({ kind: 'none', reason: 'SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL' });
    });

    it('poza produkcją (środowisko testowe z domeną trial) pokrywanie nie blokuje', () => {
      const dev = { ...mailersend, NODE_ENV: 'development', PHISHING_EMAIL_DOMAIN: 'unfooly.example.com' };

      expect(resolvePhishingTransportConfig(config(dev))).toEqual({ kind: 'mailersend', token: 't' });
    });

    it('domainsOverlap: równość i relacja subdomeny, ale nie sufiks tekstowy ("evilunfooly.com" != "unfooly.com")', () => {
      expect(domainsOverlap('a.com', 'a.com')).toBe(true);
      expect(domainsOverlap('x.a.com', 'a.com')).toBe(true);
      expect(domainsOverlap('a.com', 'x.a.com')).toBe(true);
      expect(domainsOverlap('evila.com', 'a.com')).toBe(false);
      expect(domainsOverlap('a.com', 'b.com')).toBe(false);
    });
  });

  describe('createPhishingTransport', () => {
    it('zwraca implementację zgodną z konfiguracją', () => {
      expect(createPhishingTransport(config({ NODE_ENV: 'development' })).name).toBe('log');
      expect(createPhishingTransport(config({ ...PROD, PHISHING_MAIL_TRANSPORT: 'mailersend', PHISHING_MAILERSEND_API_TOKEN: 't' })).name).toBe('mailersend');
      expect(createPhishingTransport(config({ ...PROD, PHISHING_MAIL_TRANSPORT: 'smtp', PHISHING_SMTP_URL: 'smtp://smtp.example.net:587' })).name).toBe('smtp');
      expect(createPhishingTransport(config(PROD)).name).toBe('none');
    });
  });
});
