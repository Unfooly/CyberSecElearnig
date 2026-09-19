import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('RedisService - stan incydentu i bezpiecznik', () => {
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('log error RAZ NA INCYDENT (nie na każdy błąd), info po powrocie, potem znów error przy kolejnym incydencie', () => {
    const service = new RedisService(config({}));

    for (let i = 0; i < 5; i += 1) {
      service.reportFailure(new Error('ECONNREFUSED'));
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/Redis niedostępny/);
    expect(logSpy).not.toHaveBeenCalled();

    service.reportSuccess();
    service.reportSuccess();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/Redis znów dostępny/);

    service.reportFailure(new Error('ETIMEDOUT'));
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('sukces bez wcześniejszego incydentu nic nie loguje', () => {
    new RedisService(config({})).reportSuccess();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('bezpiecznik: po błędzie Redis jest pomijany przez ~5 s, potem znów dostępny (gdy klient gotowy)', async () => {
    const service = new RedisService(config({ REDIS_URL: 'redis://127.0.0.1:1' }));
    // Wymuszamy stan "ready" (bez prawdziwego połączenia), żeby sprawdzić samą logikę bezpiecznika.
    Object.defineProperty(service.client!, 'status', { value: 'ready', configurable: true });
    const t0 = Date.now();

    expect(service.isAvailable(t0)).toBe(true);
    service.reportFailure(new Error('timeout'));
    expect(service.isAvailable(Date.now())).toBe(false);
    expect(service.isAvailable(t0 + 4900)).toBe(false);
    expect(service.isAvailable(Date.now() + 5100)).toBe(true);

    await service.onModuleDestroy();
  });

  it('niegotowy klient nie jest dostępny; brak REDIS_URL: brak klienta', async () => {
    const withUrl = new RedisService(config({ REDIS_URL: 'redis://127.0.0.1:1' }));
    expect(withUrl.isAvailable()).toBe(false);
    await withUrl.onModuleDestroy();

    const without = new RedisService(config({}));
    expect(without.client).toBeNull();
    expect(without.isAvailable()).toBe(false);
  });

  it('podczas zamykania aplikacji błędy nie są zgłaszane jako incydent (brak fałszywych alarmów)', async () => {
    const service = new RedisService(config({}));
    await service.onModuleDestroy();

    service.reportFailure(new Error('Connection is closed'));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('brak REDIS_URL na produkcji: ostrzeżenie przy starcie (cichy tryb per instancja byłby nie do zauważenia)', () => {
    new RedisService(config({ NODE_ENV: 'production' }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Brak REDIS_URL na produkcji/));

    warnSpy.mockClear();
    new RedisService(config({ NODE_ENV: 'development' }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('klucze mają prefiks (REDIS_KEY_PREFIX albo domyślny "unfooly")', () => {
    expect(new RedisService(config({})).key('a', 'b')).toBe('unfooly:a:b');
    expect(new RedisService(config({ REDIS_KEY_PREFIX: 'stg' })).key('a')).toBe('stg:a');
  });
});
