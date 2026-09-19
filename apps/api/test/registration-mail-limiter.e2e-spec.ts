import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { mailLimiterKey, RegistrationMailLimiter } from '../src/auth/registration-mail-limiter';
import { RedisService } from '../src/redis/redis.service';

// Prawdziwy Redis (REDIS_URL) z własnym prefiksem kluczy - nie dotyka danych deweloperskich.
describe('RegistrationMailLimiter na Redisie (e2e)', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const prefix = `unfooly-test-limiter-${Date.now()}`;
  const services: RedisService[] = [];

  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => ({ REDIS_URL: redisUrl, REDIS_KEY_PREFIX: prefix, ...values })[key] }) as unknown as ConfigService;

  // Świeży klient łączy się asynchronicznie (bez kolejki offline) - czekamy na gotowość,
  // a brak Redisa daje czytelny błąd zamiast fałszywych wyników z rezerwy.
  const makeRedis = async (values: Record<string, string> = {}, expectReady = true) => {
    const service = new RedisService(config(values));
    services.push(service);
    const ready = await service.waitUntilReady();
    if (expectReady && !ready) {
      throw new Error(`Ten pakiet e2e wymaga działającego Redisa pod ${redisUrl}`);
    }
    return service;
  };

  const keyFor = (redis: RedisService, email: string) =>
    redis.key('reg-mail', createHash('sha256').update(mailLimiterKey(email)).digest('hex'));

  afterAll(async () => {
    const cleaner = await makeRedis();
    const keys = await cleaner.client!.keys(`${prefix}:*`);
    if (keys.length > 0) {
      await cleaner.client!.del(...keys);
    }
    for (const service of services) {
      await service.onModuleDestroy();
    }
  });

  it('dwie instancje api (osobne limitery i klienci) dzielą jeden limit - drugi mail do tej skrzynki jest pomijany', async () => {
    const instanceA = new RegistrationMailLimiter(await makeRedis());
    const instanceB = new RegistrationMailLimiter(await makeRedis());

    expect(await instanceA.tryAcquire('wielo-instancyjny@firma.pl')).toBe(true);
    expect(await instanceB.tryAcquire('wielo-instancyjny@firma.pl')).toBe(false);
    expect(await instanceB.tryAcquire('Wielo-Instancyjny+alias@Firma.pl')).toBe(false);
    expect(await instanceB.tryAcquire('inna-skrzynka@firma.pl')).toBe(true);
  });

  it('równoległe próby: dokładnie jedna przechodzi (atomowe SET NX)', async () => {
    const limiters = await Promise.all([1, 2, 3, 4, 5].map(async () => new RegistrationMailLimiter(await makeRedis())));

    const results = await Promise.all(limiters.map((limiter) => limiter.tryAcquire('rownolegle@firma.pl')));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('klucz ma TTL ~10 min (wygasa po stronie Redisa) i nie zawiera jawnego adresu', async () => {
    const redis = await makeRedis();
    const limiter = new RegistrationMailLimiter(redis);
    await limiter.tryAcquire('ttl-test@firma.pl');

    const key = keyFor(redis, 'TTL-Test+x@firma.pl');
    const ttlMs = await redis.client!.pttl(key);

    expect(key).not.toMatch(/firma|@|ttl/i);
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000);
  });

  it('Redis niedostępny: fail-open z rezerwą (mail wychodzi, potem limit per instancja), jeden log error na incydent', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const down = await makeRedis({ REDIS_URL: 'redis://127.0.0.1:1' }, false);
      const limiter = new RegistrationMailLimiter(down);

      const first = await limiter.tryAcquire('awaria@firma.pl');
      const second = await limiter.tryAcquire('awaria@firma.pl');
      const other = await limiter.tryAcquire('awaria-inna@firma.pl');

      expect([first, second, other]).toEqual([true, false, true]);
      // Wszystkie wywołania w jednym incydencie => jeden log error z RedisService (nie na każde żądanie).
      expect(errorSpy.mock.calls.filter(([message]) => /Redis niedostępny/.test(String(message)))).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  }, 15_000);
});
