import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ServerClient } from 'postmark';
import { EmailService } from './email.service';

jest.mock('postmark', () => ({
  ServerClient: jest.fn().mockImplementation(() => ({
    sendEmailWithTemplate: jest.fn(),
  })),
}));

async function createService(configValues: Record<string, string | undefined>): Promise<EmailService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EmailService,
      { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
    ],
  }).compile();
  return module.get(EmailService);
}

describe('EmailService', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('brak POSTMARK_API_TOKEN (dev bez konfiguracji)', () => {
    it('loguje treść maila do konsoli zamiast wysyłać, nie konstruuje klienta Postmark', async () => {
      const service = await createService({ POSTMARK_API_TOKEN: undefined, EMAIL_FROM: 'from@test.pl' });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('logowane do konsoli'));
      expect(ServerClient).not.toHaveBeenCalled();

      await service.send({
        to: 'user@test.pl',
        subject: 'Test',
        templateName: 'welcome',
        templateData: { name: 'Jan' },
      });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL DEV MODE]'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user@test.pl'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('welcome'));
    });

    it('traktuje pusty string tak samo jak brak tokenu (np. jawnie pusty .env.test)', async () => {
      await createService({ POSTMARK_API_TOKEN: '', EMAIL_FROM: 'from@test.pl' });

      expect(ServerClient).not.toHaveBeenCalled();
    });
  });

  describe('z tokenem - wysyłka przez Postmark Templates API', () => {
    it('wysyła poprawny kształt żądania (TemplateAlias/TemplateModel, nie hardkodowany HTML)', async () => {
      const service = await createService({
        POSTMARK_API_TOKEN: 'real-token-123',
        EMAIL_FROM: 'from@test.pl',
      });
      const clientInstance = (ServerClient as unknown as jest.Mock).mock.results[0].value;
      clientInstance.sendEmailWithTemplate.mockResolvedValue({ MessageID: 'abc' });

      await service.send({
        to: 'user@test.pl',
        subject: 'Witaj',
        templateName: 'welcome',
        templateData: { name: 'Jan' },
      });

      expect(clientInstance.sendEmailWithTemplate).toHaveBeenCalledWith({
        From: 'from@test.pl',
        To: 'user@test.pl',
        TemplateAlias: 'welcome',
        TemplateModel: { name: 'Jan', subject: 'Witaj' },
      });
    });

    it('nie rzuca, gdy Postmark API zwraca błąd (graceful degradation - nie wywala wołającego flow)', async () => {
      const service = await createService({
        POSTMARK_API_TOKEN: 'real-token-123',
        EMAIL_FROM: 'from@test.pl',
      });
      const clientInstance = (ServerClient as unknown as jest.Mock).mock.results[0].value;
      clientInstance.sendEmailWithTemplate.mockRejectedValue(new Error('Postmark: invalid recipient'));

      await expect(
        service.send({ to: 'bad@test.pl', subject: 'Test', templateName: 'welcome', templateData: {} }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Postmark: invalid recipient'));
    });

    it('token nigdy nie pojawia się w logach, nawet gdy komunikat błędu Postmark go zawiera', async () => {
      const token = 'super-secret-postmark-token-xyz';
      const service = await createService({ POSTMARK_API_TOKEN: token, EMAIL_FROM: 'from@test.pl' });
      const clientInstance = (ServerClient as unknown as jest.Mock).mock.results[0].value;
      clientInstance.sendEmailWithTemplate.mockRejectedValue(
        new Error(`Request rejected - Authorization header token ${token} is invalid`),
      );

      await service.send({ to: 'user@test.pl', subject: 'Test', templateName: 'welcome', templateData: {} });

      const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((arg) => String(arg))
        .join('\n');

      expect(allLoggedText).not.toContain(token);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
    });

    it('redaguje WSZYSTKIE wystąpienia tokenu, jeśli pojawia się w komunikacie wielokrotnie', async () => {
      const token = 'super-secret-postmark-token-xyz';
      const service = await createService({ POSTMARK_API_TOKEN: token, EMAIL_FROM: 'from@test.pl' });
      const clientInstance = (ServerClient as unknown as jest.Mock).mock.results[0].value;
      clientInstance.sendEmailWithTemplate.mockRejectedValue(
        new Error(`Token ${token} rejected. Retry without token ${token}.`),
      );

      await service.send({ to: 'user@test.pl', subject: 'Test', templateName: 'welcome', templateData: {} });

      const loggedMessage = String(errorSpy.mock.calls[0][0]);
      expect(loggedMessage).not.toContain(token);
      expect(loggedMessage.match(/\[REDACTED\]/g)).toHaveLength(2);
    });

    it('redaguje token też, gdy odrzucona wartość NIE jest instancją Error', async () => {
      const token = 'super-secret-postmark-token-xyz';
      const service = await createService({ POSTMARK_API_TOKEN: token, EMAIL_FROM: 'from@test.pl' });
      const clientInstance = (ServerClient as unknown as jest.Mock).mock.results[0].value;
      // Postmark deklaruje, że zawsze rzuca Error/PostmarkError, ale nie
      // jest to gwarantowane dla KAŻDEGO możliwego wyjątku w łańcuchu
      // (np. błąd sieciowy z innej warstwy) - kod musi być bezpieczny też
      // dla `reject` wartością, która nie jest Error.
      clientInstance.sendEmailWithTemplate.mockRejectedValue(`raw rejection with token ${token}`);

      await expect(
        service.send({ to: 'user@test.pl', subject: 'Test', templateName: 'welcome', templateData: {} }),
      ).resolves.toBeUndefined();

      const loggedMessage = String(errorSpy.mock.calls[0][0]);
      expect(loggedMessage).not.toContain(token);
      expect(loggedMessage).toContain('[REDACTED]');
    });
  });
});
