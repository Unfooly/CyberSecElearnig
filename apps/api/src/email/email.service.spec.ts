import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { displayName } from './display-name';
import { EmailService } from './email.service';
import { MailOutcome } from './interfaces/send-email-options.interface';
import { renderTemplate } from './templates';

async function createService(configValues: Record<string, string | undefined>): Promise<EmailService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EmailService,
      { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
    ],
  }).compile();
  return module.get(EmailService);
}

const BASE = { MAILERSEND_API_TOKEN: 'mlsn.secret-token', EMAIL_FROM: 'from@test.pl', EMAIL_FROM_NAME: 'Test' };

describe('EmailService (MailerSend)', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('brak tokenu (dev)', () => {
    it('loguje treść zamiast wysyłać i nie woła API', async () => {
      const service = await createService({ EMAIL_FROM: 'from@test.pl' });

      await service.send({
        to: 'a@test.pl',
        subject: 'Temat',
        templateName: 'password-reset',
        templateData: { resetUrl: 'http://x/reset?token=1' },
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('EMAIL DEV MODE'));
    });

    it('odmawia startu na produkcji bez tokenu, chyba że ALLOW_EMAIL_DEV_MODE=true', async () => {
      await expect(createService({ NODE_ENV: 'production' })).rejects.toThrow(/MAILERSEND_API_TOKEN/);
      await expect(createService({ NODE_ENV: 'production', ALLOW_EMAIL_DEV_MODE: 'true' })).resolves.toBeDefined();
    });
  });

  describe('wysyłka', () => {
    it('woła MailerSend z Bearer tokenem i poprawnym payloadem', async () => {
      const service = await createService(BASE);

      await service.send({
        to: 'jan@test.pl',
        subject: 'Weryfikacja',
        templateName: 'email-verification',
        templateData: { verificationUrl: 'http://x/verify-email?token=abc' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.mailersend.com/v1/email');
      expect(init.headers.Authorization).toBe('Bearer mlsn.secret-token');
      const body = JSON.parse(init.body);
      expect(body.from).toEqual({ email: 'from@test.pl', name: 'Test' });
      expect(body.to).toEqual([{ email: 'jan@test.pl' }]);
      expect(body.subject).toBe('Weryfikacja');
      expect(body.html).toContain('http://x/verify-email?token=abc');
      expect(body.text).toContain('http://x/verify-email?token=abc');
    });

    it('nie rzuca, gdy API odrzuci żądanie (np. 422 - niezweryfikowana domena), tylko loguje', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => '{"message":"domain not verified"}' });
      const service = await createService(BASE);

      await expect(
        service.send({ to: 'a@test.pl', subject: 'T', templateName: 'password-reset', templateData: { resetUrl: 'u' } }),
      ).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 422'));
    });

    it('nie rzuca przy błędzie sieci i nie ujawnia tokenu w logu', async () => {
      fetchMock.mockRejectedValue(new Error('boom mlsn.secret-token boom'));
      const service = await createService(BASE);

      await expect(
        service.send({ to: 'a@test.pl', subject: 'T', templateName: 'password-reset', templateData: { resetUrl: 'u' } }),
      ).resolves.toBe(false);

      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('[REDACTED]');
      expect(logged).not.toContain('mlsn.secret-token');
    });

    describe('klasyfikacja wyniku (jak w wysyłce kampanii: wysłano / pewne niepowodzenie / niepewne)', () => {
      const MAIL = { to: 'a@test.pl', subject: 'T', templateName: 'password-reset', templateData: { resetUrl: 'u' } };
      const resultOf = async (arrange: () => void) => {
        arrange();
        const outcome: MailOutcome = {};
        const service = await createService(BASE);
        const accepted = await service.send(MAIL, outcome);
        return { accepted, result: outcome.result };
      };

      it('2xx: SENT', async () => {
        expect(await resultOf(() => fetchMock.mockResolvedValue({ ok: true, status: 202 }))).toEqual({ accepted: true, result: { status: 'SENT' } });
      });

      it('4xx (np. 422 odrzucony adres, 429 limit): pewne niepowodzenie REJECTED', async () => {
        for (const status of [400, 422, 429]) {
          const { accepted, result } = await resultOf(() => fetchMock.mockResolvedValue({ ok: false, status, text: async () => '' }));
          expect(accepted).toBe(false);
          expect(result).toEqual({ status: 'REJECTED', code: `HTTP_${status}` });
        }
      });

      it('5xx: NIEPEWNE (bramka mogła zwrócić 502/504 po przekazaniu wiadomości)', async () => {
        for (const status of [408, 500, 502, 504]) {
          const { result } = await resultOf(() => fetchMock.mockResolvedValue({ ok: false, status, text: async () => '' }));
          expect(result).toEqual({ status: 'UNCERTAIN', code: `HTTP_${status}` });
        }
      });

      it('timeout żądania: NIEPEWNE TIMEOUT_UNKNOWN', async () => {
        const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        const { accepted, result } = await resultOf(() => fetchMock.mockRejectedValue(timeout));
        expect(accepted).toBe(false);
        expect(result).toEqual({ status: 'UNCERTAIN', code: 'TIMEOUT_UNKNOWN' });
      });

      it('brak połączenia przed wysłaniem (DNS, odmowa): pewne niepowodzenie; zerwane połączenie i nieznany błąd: niepewne', async () => {
        const failed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
        for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']) {
          const { result } = await resultOf(() => fetchMock.mockRejectedValue(failed(code)));
          expect(result).toEqual({ status: 'REJECTED', code: 'CONNECTION' });
        }
        expect((await resultOf(() => fetchMock.mockRejectedValue(failed('ECONNRESET')))).result).toEqual({ status: 'UNCERTAIN', code: 'RESULT_UNKNOWN' });
        expect((await resultOf(() => fetchMock.mockRejectedValue(new Error('coś dziwnego')))).result).toEqual({ status: 'UNCERTAIN', code: 'RESULT_UNKNOWN' });
      });

      it('nieznany szablon: REJECTED bez wołania API; tryb dev (bez tokenu): SENT', async () => {
        const service = await createService(BASE);
        const outcome: MailOutcome = {};
        await service.send({ ...MAIL, templateName: 'nie-ma-takiego' }, outcome);
        expect(outcome.result).toEqual({ status: 'REJECTED', code: 'TEMPLATE_UNKNOWN' });
        expect(fetchMock).not.toHaveBeenCalled();

        const dev = await createService({ EMAIL_FROM: 'from@test.pl' });
        const devOutcome: MailOutcome = {};
        await dev.send(MAIL, devOutcome);
        expect(devOutcome.result).toEqual({ status: 'SENT' });
      });
    });

    it('loguje błąd i nie wysyła dla nieznanego szablonu', async () => {
      const service = await createService(BASE);

      await service.send({ to: 'a@test.pl', subject: 'T', templateName: 'nie-ma-takiego', templateData: {} });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Nieznany szablon'));
    });
  });
});

describe('renderTemplate', () => {
  it('escapuje HTML w wartościach od użytkownika (imię, nazwa organizacji)', () => {
    const rendered = renderTemplate('user-invite', {
      firstName: '<script>alert(1)</script>',
      organizationName: '"><img src=x>',
      invitedBy: 'admin@firma.pl',
      activationUrl: 'http://x/reset-password?token=t',
    });

    expect(rendered?.html).not.toContain('<script>');
    expect(rendered?.html).not.toContain('<img src=x>');
    expect(rendered?.html).toContain('&lt;script&gt;');
  });

  it('zaproszenie zawiera nazwę organizacji i osobę zapraszającą', () => {
    const rendered = renderTemplate('user-invite', {
      firstName: 'Jan',
      organizationName: 'firma.pl',
      invitedBy: 'admin@firma.pl',
      activationUrl: 'http://x/a',
    });

    expect(rendered?.text).toContain('firma.pl');
    expect(rendered?.text).toContain('admin@firma.pl');
  });

  describe('maile do osoby trzeciej z nazwą organizacji od obcej strony (registration-claim, invite-address-taken)', () => {
    const LONG = `Pilne: konto zablokowane\r\nBcc: ofiara@x.pl kliknij i potwierdź natychmiast inaczej stracisz dostęp ${'x'.repeat(200)}`;
    const claimUrl = 'http://x/claim-registration?token=t';

    it('nazwa jest przycięta do 50 znaków, bez nowych linii i znaków sterujących (HTML i tekst)', () => {
      for (const [name, data] of [
        ['registration-claim', { organizationName: LONG, claimUrl }],
        ['invite-address-taken', { organizationName: LONG }],
      ] as const) {
        const rendered = renderTemplate(name, data);
        const shown = displayName(LONG);

        expect(Array.from(shown)).toHaveLength(50);
        expect(rendered?.html).toContain(shown);
        expect(rendered?.text).toContain(shown);
        expect(rendered?.html).not.toContain('x'.repeat(60));
        expect(rendered?.text).not.toContain('x'.repeat(60));
        expect(rendered?.text).not.toContain('\r');
        expect(rendered?.text).not.toMatch(/Pilne: konto zablokowane\nBcc/);
      }
    });

    it('registration-claim ma zdanie ostrzegawcze o skutku kliknięcia, a nazwa jest escapowana', () => {
      const rendered = renderTemplate('registration-claim', { organizationName: '<b>Zła</b>', claimUrl });

      expect(rendered?.text).toContain('Kliknij tylko, jeśli to Ty rejestrowałeś/-aś organizację. Kliknięcie unieważni zaproszenie do innej firmy, jeśli takie masz.');
      expect(rendered?.html).toContain('Kliknij tylko, jeśli to Ty rejestrowałeś/-aś organizację.');
      expect(rendered?.html).not.toContain('<b>Zła</b>');
      expect(rendered?.html).toContain(claimUrl);
    });

    it('invite-address-taken nie ma linków i informuje, że nie wymaga akcji', () => {
      const rendered = renderTemplate('invite-address-taken', { organizationName: 'Firma' });

      expect(rendered?.text).not.toMatch(/https?:\/\//);
      expect(rendered?.text).toContain('nie zawiera linków');
      expect(renderTemplate('invite-address-taken', {})?.text).toContain('do organizacji w Unfooly');
    });
  });
});

describe('renderTemplate - branding', () => {
  it('używa logo PNG z publicznego adresu aplikacji i kolorów marki', () => {
    const rendered = renderTemplate(
      'password-reset',
      { resetUrl: 'https://app.unfooly.test/reset-password?token=abc' },
      { assetBaseUrl: 'https://app.unfooly.test/' },
    );

    expect(rendered?.html).toContain('src="https://app.unfooly.test/brand/png/unfooly-wordmark-1600.png"');
    expect(rendered?.html).not.toContain('.svg');
    expect(rendered?.html).toContain('#6C5CE7');
    expect(rendered?.html).not.toContain('#059669');
  });

  it('bez adresu aplikacji pokazuje tekstowy wordmark zamiast niedziałającego obrazka', () => {
    const rendered = renderTemplate('email-verification', { verificationUrl: 'http://localhost:3000/verify-email?token=x' });

    expect(rendered?.html).not.toContain('<img');
    expect(rendered?.html).toContain('unfooly');
  });
});

describe('renderTemplate - demo-request', () => {
  it('escapuje dane z formularza i pokazuje liczbę pracowników', () => {
    const rendered = renderTemplate('demo-request', { email: '<b>x</b>@firma.pl', employeeCount: 120 });

    expect(rendered?.html).toContain('&lt;b&gt;x&lt;/b&gt;@firma.pl');
    expect(rendered?.html).toContain('120');
    expect(rendered?.html).not.toContain('<b>x</b>');
    expect(rendered?.text).toContain('120');
  });
});
