import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { LogPhishingTransport } from './log.transport';
import { MailerSendPhishingTransport } from './mailersend.transport';
import { NotConfiguredPhishingTransport } from './not-configured.transport';
import { isUncertainFailureCode, PhishingMailMessage, PhishingTransportError } from './phishing-mail-transport';
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

  it('HTTP 429 (limit) to jedyny błąd HTTP ponawialny - dostawca nic nie wysłał', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toBeInstanceOf(PhishingTransportError);
    expect(error).toMatchObject({ retryable: true, code: 'HTTP_429' });
  });

  it.each([500, 502, 503, 504])('HTTP %i NIE jest ponawiany ("co najwyżej raz": bramka mogła przyjąć wiadomość) i jest liczony jako niepewny', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, headers: { get: () => null } });

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: `HTTP_${status}` });
    expect(isUncertainFailureCode(error.code)).toBe(true);
  });

  it('isUncertainFailureCode: timeouty, nieznane wyniki i 5xx tak; 4xx, SMTP i kody kampanii nie', () => {
    for (const code of ['TIMEOUT_UNKNOWN', 'RESULT_UNKNOWN', 'INTERRUPTED_UNKNOWN', 'HTTP_500', 'HTTP_599']) expect(isUncertainFailureCode(code)).toBe(true);
    for (const code of ['HTTP_422', 'HTTP_429', 'SMTP_550', 'CANCELLED', 'WINDOW_EXPIRED', 'COMPOSE_FAILED', 'NETWORK']) expect(isUncertainFailureCode(code)).toBe(false);
  });

  it.each([400, 401, 403, 422])('HTTP %i to błąd TRWAŁY (bez ponawiania: zły adres, token, blokada)', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status, headers: { get: () => null } });

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: `HTTP_${status}` });
  });

  it('brak połączenia PRZED wysłaniem (DNS/odmowa): ponawialny NETWORK, komunikat bez adresu odbiorcy i tokenu', async () => {
    const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND api.mailersend.com for ${MESSAGE.toEmail} with phishing-token`), { code: 'ENOTFOUND' });
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));

    const error = await catchError(new MailerSendPhishingTransport('phishing-token').send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: 'NETWORK' });
    expect(JSON.stringify([error.message, error.code])).not.toMatch(/kowalska|phishing-token|firma\.example/);
  });

  it('TIMEOUT: NIE jest ponawialny (co najwyżej raz) - kod TIMEOUT_UNKNOWN, bo dostawca mógł wysłać', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'TIMEOUT_UNKNOWN' });
  });

  it('inny błąd bez odpowiedzi (np. zerwane połączenie po wysłaniu): nieponawialny RESULT_UNKNOWN', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }));

    const error = await catchError(new MailerSendPhishingTransport('t').send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'RESULT_UNKNOWN' });
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

  it('ECONNECTION po DATA (zerwane połączenie, wiadomość mogła zostać przyjęta) albo bez komendy: NIEPONAWIALNY RESULT_UNKNOWN', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'DATA' }));
    sendMail.mockRejectedValueOnce(Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION' }));
    const transport = new SmtpPhishingTransport('smtp://x', transporter);

    expect(await catchError(transport.send(MESSAGE))).toMatchObject({ retryable: false, code: 'RESULT_UNKNOWN' });
    expect(await catchError(transport.send(MESSAGE))).toMatchObject({ retryable: false, code: 'RESULT_UNKNOWN' });
  });

  it.each([
    ['ECONNECTION', 'CONN'],
    ['ECONNECTION', 'EHLO'],
    ['EAUTH', undefined],
    ['ETLS', undefined],
    ['EDNS', undefined],
  ])('błąd %s (%s, przed wysłaniem) jest ponawialny, a komunikat nie zawiera danych dostępowych ani adresów', async (code, command) => {
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login: smtps://user:sekret@smtp.example.net for anna.kowalska@firma.example.pl'), { code, command }));

    const error = await catchError(new SmtpPhishingTransport('smtps://user:sekret@smtp.example.net', transporter).send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: 'NETWORK' });
    expect(error.message).not.toMatch(/sekret|kowalska/);
  });

  it('ETIMEDOUT / ESOCKET / błąd bez kodu: NIEPONAWIALNE (wynik niepewny)', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    sendMail.mockRejectedValueOnce(Object.assign(new Error('socket'), { code: 'ESOCKET' }));
    sendMail.mockRejectedValueOnce(new Error('coś'));
    const transport = new SmtpPhishingTransport('smtp://x', transporter);

    expect(await catchError(transport.send(MESSAGE))).toMatchObject({ retryable: false, code: 'TIMEOUT_UNKNOWN' });
    expect(await catchError(transport.send(MESSAGE))).toMatchObject({ retryable: false, code: 'RESULT_UNKNOWN' });
    expect(await catchError(transport.send(MESSAGE))).toMatchObject({ retryable: false, code: 'RESULT_UNKNOWN' });
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
