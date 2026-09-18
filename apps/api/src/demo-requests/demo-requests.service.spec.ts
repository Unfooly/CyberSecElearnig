import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoRequestsService } from './demo-requests.service';
import { EmailService } from '../email/email.service';

function build(env: Record<string, string>, sendResult = true) {
  const send = jest.fn().mockResolvedValue(sendResult);
  const service = new DemoRequestsService(
    { get: (key: string) => env[key] } as unknown as ConfigService,
    { send } as unknown as EmailService,
  );
  return { service, send };
}

const DTO = { email: 'jan@firma.pl', employeeCount: 120 };

describe('DemoRequestsService', () => {
  it('wysyła szablon demo-request na adres sprzedaży z e-mailem i liczbą pracowników', async () => {
    const { service, send } = build({ SALES_EMAIL: 'sprzedaz@unfooly.test' });

    const result = await service.create(DTO);

    expect(result.message).toMatch(/Dziękujemy/);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sprzedaz@unfooly.test',
        templateName: 'demo-request',
        templateData: { email: 'jan@firma.pl', employeeCount: 120 },
      }),
    );
  });

  it('pułapka na boty: wypełnione pole "website" => sukces bez wysyłki', async () => {
    const { service, send } = build({ SALES_EMAIL: 'sprzedaz@unfooly.test' });

    await expect(service.create({ ...DTO, website: 'http://spam.test' })).resolves.toBeDefined();

    expect(send).not.toHaveBeenCalled();
  });

  it('brak SALES_EMAIL => 503, nic nie jest wysyłane', async () => {
    const { service, send } = build({});

    await expect(service.create(DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(send).not.toHaveBeenCalled();
  });

  it('nieudana wysyłka => 503 (klient nie dostaje fałszywego sukcesu)', async () => {
    const { service } = build({ SALES_EMAIL: 'sprzedaz@unfooly.test' }, false);

    await expect(service.create(DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
