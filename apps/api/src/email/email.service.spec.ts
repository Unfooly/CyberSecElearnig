import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';
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
});
