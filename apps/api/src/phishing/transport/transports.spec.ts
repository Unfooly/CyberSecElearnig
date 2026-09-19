import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { LogPhishingTransport } from './log.transport';
import { MailerSendPhishingTransport } from './mailersend.transport';
import { NotConfiguredPhishingTransport } from './not-configured.transport';
import { PhishingMailMessage, PhishingTransportError } from './phishing-mail-transport';
import { SmtpPhishingTransport } from './smtp.transport';

const MESSAGE: PhishingMailMessage = {
  toEmail: 'anna.kowalska@firma.example.pl',
  fromEmail: 'hr@symulacje.example.net',
  fromName: 'Dział HR',
  subject: 'Aktualizacja planu urlopów',
  html: '<p>Treść <a href="https://landing.example.net/t/TOKENTOKENTOKENTOKENTOKENTOKENTOKENTOKEN123">link</a></p>',
  text: 'Treść link (https://landing.example.net/t/TOKEN)',
};

async function catchError(promise: Promise<unknown>): Promise<PhishingTransportError> {
  try {
    await promise;
  } catch (error) {
    return error as PhishingTransportError;
  }
  throw new Error('Oczekiwano błędu.');
}

describe('MailerSendPhishingTransport', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('wysyła POST /v1/email z własnym tokenem i treścią; zwraca id wiadomości z nagłówka', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, headers: { get: (name: string) => (name === 'x-message-id' ? 'msg-123' : null) } });

    const result = await new MailerSendPhishingTransport('phishing-token').send(MESSAGE);

    expect(result).toEqual({ providerMessageId: 'msg-123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mailersend.com/v1/email');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer phishing-token');
    expect(JSON.parse(init.body)).toEqual({
      from: { email: 'hr@symulacje.example.net', name: 'Dział HR' },
      to: [{ email: 'anna.kowalska@firma.example.pl' }],
      subject: 'Aktualizacja planu urlopów',
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
    expect(init.signal).toBeDefined(); // limit czasu
  });

  it('brak id w odpowiedzi: providerMessageId = null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, headers: { get: () => null } });

    expect(await new MailerSendPhishingTransport('t').send(MESSAGE)).toEqual({ providerMessageId: null });
  });

  it.each([429, 500, 502, 503])('HTTP %i to błąd PRZEJŚCIOWY (retryable)', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, headers: { get: () => null } });

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toBeInstanceOf(PhishingTransportError);
    expect(error).toMatchObject({ retryable: true, code: `HTTP_${status}` });
  });

  it.each([400, 401, 403, 422])('HTTP %i to błąd TRWAŁY (bez ponawiania: zły adres, token, blokada)', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, headers: { get: () => null } });

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: `HTTP_${status}` });
  });

  it('timeout/brak sieci: błąd przejściowy NETWORK, a komunikat nie zawiera adresu odbiorcy ani tokenu', async () => {
    fetchMock.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND api.mailersend.com for ${MESSAGE.toEmail} with phishing-token`));

    const error = await catchError(new MailerSendPhishingTransport('phishing-token').send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: 'NETWORK' });
    expect(JSON.stringify([error.message, error.code])).not.toMatch(/kowalska|phishing-token|firma\.example/);
  });

  it('błąd HTTP nie ujawnia treści odpowiedzi, adresu ani tokenu', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, headers: { get: () => null }, text: async () => `invalid ${MESSAGE.toEmail}` });

    const error = await catchError(new MailerSendPhishingTransport('phishing-token').send(MESSAGE));

    expect(error.message).not.toMatch(/kowalska|phishing-token/);
  });
});

describe('SmtpPhishingTransport', () => {
  const sendMail = jest.fn();
  const transporter = { sendMail } as never;
  beforeEach(() => sendMail.mockReset());

  it('wysyła przez nodemailer z nadawcą (nazwa + adres w naszej domenie) i zwraca messageId', async () => {
    sendMail.mockResolvedValue({ messageId: '<abc@symulacje.example.net>' });

    const result = await new SmtpPhishingTransport('smtp://x', transporter).send(MESSAGE);

    expect(result).toEqual({ providerMessageId: '<abc@symulacje.example.net>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: 'Dział HR', address: 'hr@symulacje.example.net' },
      to: { name: '', address: 'anna.kowalska@firma.example.pl' },
      subject: 'Aktualizacja planu urlopów',
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
  });

  it('smtp:// poza lokalnym hostem wymusza TLS (requireTLS), Mailpit na localhost nie', () => {
    const create = jest.spyOn(nodemailer, 'createTransport');
    new SmtpPhishingTransport('smtp://u:p@smtp.example.net:587');
    new SmtpPhishingTransport('smtp://localhost:1025');

    expect(create.mock.calls[0][0]).toMatchObject({ requireTLS: true });
    expect(create.mock.calls[1][0]).toMatchObject({ requireTLS: false });
    create.mockRestore();
  });

  it.each([421, 450, 451, 452])('SMTP %i (4xx) to błąd przejściowy', async (responseCode) => {
    sendMail.mockRejectedValue(Object.assign(new Error('temp fail for anna.kowalska@firma.example.pl'), { responseCode }));

    const error = await catchError(new SmtpPhishingTransport('smtp://x', transporter).send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: `SMTP_${responseCode}` });
    expect(error.message).not.toMatch(/kowalska/);
  });

  it.each([550, 553, 554])('SMTP %i (5xx) to błąd trwały', async (responseCode) => {
    sendMail.mockRejectedValue(Object.assign(new Error('rejected'), { responseCode }));

    const error = await catchError(new SmtpPhishingTransport('smtp://x', transporter).send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: `SMTP_${responseCode}` });
  });

  it('błąd połączenia/TLS/uwierzytelnienia (bez kodu odpowiedzi) jest przejściowy, a komunikat nie zawiera danych dostępowych ani adresów', async () => {
    sendMail.mockRejectedValue(new Error('Invalid login: smtps://user:sekret@smtp.example.net for anna.kowalska@firma.example.pl'));

    const error = await catchError(new SmtpPhishingTransport('smtps://user:sekret@smtp.example.net', transporter).send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: 'NETWORK' });
    expect(error.message).not.toMatch(/sekret|kowalska/);
  });

  it('konstruktor z URL tworzy transport bez połączenia (nic nie jest wysyłane przy starcie)', () => {
    expect(() => new SmtpPhishingTransport('smtp://user:pass@smtp.example.net:587')).not.toThrow();
  });
});

describe('LogPhishingTransport', () => {
  it('loguje TYLKO podsumowanie: bez treści i bez pełnego adresu odbiorcy', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const result = await new LogPhishingTransport().send(MESSAGE);

    expect(result).toEqual({ providerMessageId: null });
    const logged = String(logSpy.mock.calls[0][0]);
    expect(logged).toContain('@firma.example.pl');
    expect(logged).not.toMatch(/anna|kowalska|TOKEN|Treść/);
    logSpy.mockRestore();
  });
});

describe('NotConfiguredPhishingTransport', () => {
  it('każda wysyłka to błąd TRWAŁY z kodem przyczyny (nic nie wychodzi, nic się nie ponawia)', async () => {
    const error = await catchError(new NotConfiguredPhishingTransport('TRANSPORT_NOT_SELECTED').send());

    expect(error).toMatchObject({ retryable: false, code: 'NOT_CONFIGURED_TRANSPORT_NOT_SELECTED' });
  });
});
