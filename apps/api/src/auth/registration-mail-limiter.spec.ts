import { RedisService } from '../redis/redis.service';
import { mailLimiterKey, RegistrationMailLimiter } from './registration-mail-limiter';

describe('mailLimiterKey', () => {
  it.each([
    ['Ofiara@Firma.pl', 'ofiara@firma.pl'],
    ['ofiara+1@firma.pl', 'ofiara@firma.pl'],
    ['ofiara+abc+def@firma.pl', 'ofiara@firma.pl'],
    ['  ofiara+x@firma.pl ', 'ofiara@firma.pl'],
    ['inna+1@firma.pl', 'inna@firma.pl'],
    ['brak-malpy', 'brak-malpy'],
  ])('%s => %s', (input, expected) => {
    expect(mailLimiterKey(input)).toBe(expected);
  });

  it('alias "+" w domenie nie jest obcinany (tylko część lokalna)', () => {
    expect(mailLimiterKey('a@fi+rma.pl')).toBe('a@fi+rma.pl');
  });
});

// Bez Redisa (brak REDIS_URL): rezerwa w pamięci procesu.
describe('RegistrationMailLimiter - rezerwa w pamięci', () => {
  const T0 = 1_000_000;

  it('aliasy "+tag" tej samej skrzynki dzielą limit', async () => {
    const limiter = new RegistrationMailLimiter();

    expect(await limiter.tryAcquire('ofiara+1@firma.pl', 1000)).toBe(true);
    expect(await limiter.tryAcquire('ofiara+2@firma.pl', 1001)).toBe(false);
    expect(await limiter.tryAcquire('ofiara@firma.pl', 1002)).toBe(false);
  });

  it('pierwsza wysyłka na adres przechodzi, druga w oknie 10 min jest pomijana', async () => {
    const limiter = new RegistrationMailLimiter();

    expect(await limiter.tryAcquire('a@firma.pl', T0)).toBe(true);
    expect(await limiter.tryAcquire('a@firma.pl', T0 + 9 * 60_000)).toBe(false);
  });

  it('po upływie okna znów przechodzi', async () => {
    const limiter = new RegistrationMailLimiter();
    await limiter.tryAcquire('a@firma.pl', T0);

    expect(await limiter.tryAcquire('a@firma.pl', T0 + 10 * 60_000)).toBe(true);
  });

  it('nie rozróżnia wielkości liter i nie blokuje innych adresów', async () => {
    const limiter = new RegistrationMailLimiter();
    await limiter.tryAcquire('A@Firma.pl', T0);

    expect(await limiter.tryAcquire('a@firma.pl', T0 + 1)).toBe(false);
    expect(await limiter.tryAcquire('b@firma.pl', T0 + 1)).toBe(true);
  });

  it('nie rośnie bez granic (atak masowy różnymi adresami)', async () => {
    const limiter = new RegistrationMailLimiter();
    for (let i = 0; i < 6000; i += 1) {
      await limiter.tryAcquire(`u${i}@firma.pl`, T0);
    }

    // Wewnętrzna mapa jest ograniczona: ostatni adres nadal jest zapamiętany,
    // a najstarszy został wyparty.
    expect(await limiter.tryAcquire('u5999@firma.pl', T0 + 1)).toBe(false);
    expect(await limiter.tryAcquire('u0@firma.pl', T0 + 1)).toBe(true);
  });
});

describe('RegistrationMailLimiter - Redis', () => {
  const setMock = jest.fn();
  const isAvailable = jest.fn();
  const reportFailure = jest.fn();
  const reportSuccess = jest.fn();
  const redis = {
    client: { set: setMock },
    key: (...parts: string[]) => ['test', ...parts].join(':'),
    isAvailable,
    reportFailure,
    reportSuccess,
  } as unknown as RedisService;

  beforeEach(() => {
    setMock.mockReset();
    isAvailable.mockReset().mockReturnValue(true);
    reportFailure.mockReset();
    reportSuccess.mockReset();
  });

  it('SET NX PX 10 min: "OK" => wolno, null (klucz już jest) => zbyt wcześnie', async () => {
    const limiter = new RegistrationMailLimiter(redis);
    setMock.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    expect(await limiter.tryAcquire('a@firma.pl')).toBe(true);
    expect(await limiter.tryAcquire('a@firma.pl')).toBe(false);
    expect(setMock).toHaveBeenCalledWith(expect.stringMatching(/^test:reg-mail:[0-9a-f]{64}$/), '1', 'PX', 600_000, 'NX');
  });

  it('klucz to hash znormalizowanego adresu (bez jawnego e-maila; aliasy i wielkość liter dają ten sam klucz)', async () => {
    const limiter = new RegistrationMailLimiter(redis);
    setMock.mockResolvedValue('OK');

    await limiter.tryAcquire('Ofiara+1@Firma.pl');
    await limiter.tryAcquire('ofiara@firma.pl');

    const [first, second] = setMock.mock.calls.map((call) => call[0] as string);
    expect(first).toBe(second);
    expect(first).not.toMatch(/ofiara|firma/i);
  });

  it('awaria Redisa: fail-open z rezerwą w pamięci (mail wychodzi, potem limit per instancja)', async () => {
    const limiter = new RegistrationMailLimiter(redis);
    setMock.mockRejectedValue(new Error('Stream isn\'t writeable'));

    expect(await limiter.tryAcquire('a@firma.pl', 1000)).toBe(true);
    expect(await limiter.tryAcquire('a@firma.pl', 2000)).toBe(false);
  });

  it('błąd zgłasza do RedisService (stan incydentu i logi są tam), sukces też', async () => {
    const limiter = new RegistrationMailLimiter(redis);

    setMock.mockResolvedValueOnce('OK');
    await limiter.tryAcquire('a@firma.pl');
    expect(reportSuccess).toHaveBeenCalledTimes(1);

    setMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await limiter.tryAcquire('b@firma.pl');
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0][0].message).toBe('ECONNREFUSED');
  });

  it('bezpiecznik otwarty / klient niegotowy: Redis NIE jest wołany, działa rezerwa', async () => {
    const limiter = new RegistrationMailLimiter(redis);
    isAvailable.mockReturnValue(false);

    expect(await limiter.tryAcquire('a@firma.pl', 1000)).toBe(true);
    expect(await limiter.tryAcquire('a@firma.pl', 2000)).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('parametr `now` nie wpływa na ścieżkę Redisa (czas wygasania liczy Redis)', async () => {
    const limiter = new RegistrationMailLimiter(redis);
    setMock.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await limiter.tryAcquire('a@firma.pl', 1);
    expect(await limiter.tryAcquire('a@firma.pl', 99 * 60 * 60_000)).toBe(false);
  });

  it('brak klienta Redis (brak REDIS_URL): rezerwa', async () => {
    const limiter = new RegistrationMailLimiter({ client: null, isAvailable: () => false } as unknown as RedisService);

    expect(await limiter.tryAcquire('a@firma.pl')).toBe(true);
    expect(await limiter.tryAcquire('a@firma.pl')).toBe(false);
  });
});
