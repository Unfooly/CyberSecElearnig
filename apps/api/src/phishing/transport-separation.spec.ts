import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { MailerSendPhishingTransport } from './transport/mailersend.transport';
import { resolvePhishingTransportConfig } from './transport/transport-config';

// Maile transakcyjne (EmailService) i maile symulacji (PhishingMailTransport) NIGDY się nie mieszają:
// osobne kody, osobne tokeny, osobne moduły. Dostawca dla symulacji może się zmienić bez ruszania poczty transakcyjnej.

const SRC = join(__dirname, '..');

// Skanujemy kod, nie komentarze (komentarze wyjaśniają rozdział, więc wprost wymieniają EmailService itd.).
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('rozdział transportu symulacji i poczty transakcyjnej', () => {
  const files = sourceFiles(SRC);
  const inPhishing = (file: string) => relative(SRC, file).split(sep)[0] === 'phishing';

  it('kod modułu symulacji nie importuje EmailService ani EmailModule (maile symulacji nie mogą iść pocztą transakcyjną)', () => {
    for (const file of files.filter(inPhishing)) {
      const content = code(file);
      expect({ file: relative(SRC, file), imports: /from\s+['"][^'"]*email\/(email\.service|email\.module)['"]/.test(content) }).toEqual({
        file: relative(SRC, file),
        imports: false,
      });
      expect({ file: relative(SRC, file), uses: /\bEmailService\b|\bEmailModule\b/.test(content) }).toEqual({ file: relative(SRC, file), uses: false });
    }
  });

  it('poza modułem symulacji nikt nie importuje PhishingMailTransport ani implementacji transportów (maile transakcyjne nie mogą iść tym transportem)', () => {
    for (const file of files.filter((f) => !inPhishing(f))) {
      const content = code(file);
      expect({ file: relative(SRC, file), uses: /phishing\/transport|PhishingMailTransport/.test(content) }).toEqual({ file: relative(SRC, file), uses: false });
    }
  });

  it('EmailService nie czyta żadnej zmiennej PHISHING_*, a transporty symulacji nie czytają MAILERSEND_API_TOKEN / EMAIL_FROM', () => {
    const emailService = code(join(SRC, 'email', 'email.service.ts'));
    expect(emailService).not.toMatch(/PHISHING_/);

    for (const file of files.filter((f) => relative(SRC, f).startsWith(`phishing${sep}transport${sep}`))) {
      const content = code(file);
      if (file.endsWith('transport-config.ts')) {
        // Konfiguracja porównuje domenę z EMAIL_FROM WYŁĄCZNIE po to, by zablokować pokrywanie się domen; nie używa tokenu transakcyjnego.
        // Token transakcyjny wolno odczytać wyłącznie do porównania (blokada wspólnego tokenu), nigdy jako wartość transportu.
        const reads = content.match(/.*'MAILERSEND_API_TOKEN'.*/g) ?? [];
        expect(reads).toHaveLength(1);
        expect(reads[0]).toMatch(/token === config\.get<string>\('MAILERSEND_API_TOKEN'\)/);
      } else {
        expect(content).not.toMatch(/MAILERSEND_API_TOKEN|EMAIL_FROM/);
      }
    }
  });

  describe('zachowanie', () => {
    const fetchMock = jest.fn();
    const original = global.fetch;
    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ ok: true, status: 202, headers: { get: () => null } });
      global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
      global.fetch = original;
      jest.restoreAllMocks();
    });

    const values: Record<string, string> = {
      NODE_ENV: 'test',
      MAILERSEND_API_TOKEN: 'transakcyjny-token',
      EMAIL_FROM: 'no-reply@unfooly.example.com',
      PHISHING_MAILERSEND_API_TOKEN: 'symulacje-token',
      PHISHING_MAIL_TRANSPORT: 'mailersend',
      PHISHING_EMAIL_DOMAIN: 'symulacje.example.net',
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;

    it('wysyłka przez transport symulacji NIE wywołuje EmailService i używa wyłącznie tokenu symulacji', async () => {
      const sendSpy = jest.spyOn(EmailService.prototype, 'send');

      await new MailerSendPhishingTransport('symulacje-token').send({
        toEmail: 'a@firma.example.pl', fromEmail: 'hr@symulacje.example.net', fromName: 'HR', subject: 'T', html: '<p>x</p>', text: 'x',
      });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer symulacje-token');
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('transakcyjny-token');
    });

    it('EmailService (transakcyjny) używa wyłącznie swojego tokenu i nadawcy, nigdy tokenu ani domeny symulacji', async () => {
      const service = new EmailService(config);

      await service.send({ to: 'u@firma.example.pl', subject: 'Reset', templateName: 'registration-activation', templateData: { activationUrl: 'https://x/y', organizationName: 'F' } });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer transakcyjny-token');
      expect(JSON.parse(init.body).from.email).toBe('no-reply@unfooly.example.com');
      expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/symulacje-token|symulacje\.example\.net/);
    });

    it('sam token poczty transakcyjnej NIE włącza transportu symulacji (osobna konfiguracja)', () => {
      const onlyTransactional = { get: (key: string) => ({ NODE_ENV: 'production', MAILERSEND_API_TOKEN: 'transakcyjny-token', PHISHING_MAIL_TRANSPORT: 'mailersend', PHISHING_EMAIL_DOMAIN: 'symulacje.example.net', EMAIL_FROM: 'no-reply@unfooly.example.com', FRONTEND_URL: 'https://app.unfooly.example.com' })[key as never] } as never;

      expect(resolvePhishingTransportConfig(onlyTransactional)).toEqual({ kind: 'none', reason: 'MAILERSEND_TOKEN_MISSING' });
    });
  });
});
