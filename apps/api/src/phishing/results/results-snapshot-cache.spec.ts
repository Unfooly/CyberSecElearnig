import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { Group } from './results-aggregation';
import { DEFAULT_RESULTS_CACHE_TTL_SECONDS, ResultsSnapshotCache } from './results-snapshot-cache';

const HOUR = 3_600_000;
const START = new Date('2027-01-01T10:00:00Z');
const at = (ms: number) => new Date(START.getTime() + ms);

const group = (delivered: number): Group => ({ key: 'd1', departmentId: 'd1', name: 'Dział', stats: { delivered, clicked: 0, submitted: 0, reported: 0, reportedAfterClick: 0 } });

/** Redis niedostępny (client null) => rezerwa w pamięci procesu. */
const noRedis = { client: null, isAvailable: () => false, key: (...parts: string[]) => parts.join(':'), reportFailure: jest.fn(), reportSuccess: jest.fn() } as unknown as RedisService;
const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('ResultsSnapshotCache', () => {
  it('migawka jest ważna godzinę od policzenia (TTL stały, NIE przesuwany odczytami), potem jest przeliczana', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);
    let calls = 0;
    const compute = async () => [group(++calls)];

    const first = await cache.get('org1:overview', compute, at(0));
    const second = await cache.get('org1:overview', compute, at(HOUR - 1000)); // odczyt tuż przed końcem NIE odświeża
    const third = await cache.get('org1:overview', compute, at(HOUR)); // dokładnie po godzinie od policzenia: przeliczenie

    expect(first.groups[0].stats.delivered).toBe(1);
    expect(second.groups[0].stats.delivered).toBe(1);
    expect(second.computedAt).toBe(first.computedAt);
    expect(third.groups[0].stats.delivered).toBe(2);
    expect(third.computedAt).toBe(at(HOUR).getTime());
    expect(calls).toBe(2);
  });

  it('odczyty w środku okna nie wydłużają życia migawki (kolejne przeliczenie dokładnie godzinę po poprzednim, nie po ostatnim odczycie)', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);
    let calls = 0;
    const compute = async () => [group(++calls)];

    await cache.get('k', compute, at(0));
    await cache.get('k', compute, at(HOUR * 0.5));
    await cache.get('k', compute, at(HOUR * 0.9));
    const refreshed = await cache.get('k', compute, at(HOUR * 1.01));

    expect(refreshed.groups[0].stats.delivered).toBe(2);
    expect(calls).toBe(2);
  });

  it('klucze różnych organizacji i kampanii są niezależne (izolacja: migawka A nigdy nie wraca dla B)', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);

    const a = await cache.get('orgA:overview', async () => [group(11)], at(0));
    const b = await cache.get('orgB:overview', async () => [group(4)], at(0));
    const campaign = await cache.get('orgA:campaign:c1', async () => [group(7)], at(0));

    expect([a, b, campaign].map((snapshot) => snapshot.groups[0].stats.delivered)).toEqual([11, 4, 7]);
  });

  it('równoległe żądania o ten sam klucz dzielą jedno przeliczenie', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);
    let calls = 0;
    const compute = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [group(calls)];
    };

    const results = await Promise.all(Array.from({ length: 10 }, () => cache.get('k', compute, at(0))));

    expect(calls).toBe(1);
    expect(new Set(results.map((snapshot) => snapshot.computedAt)).size).toBe(1);
  });

  it('błąd przeliczenia nie zostaje w cache: następne żądanie próbuje ponownie', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);

    await expect(cache.get('k', async () => Promise.reject(new Error('baza')), at(0))).rejects.toThrow('baza');
    const retry = await cache.get('k', async () => [group(3)], at(1000));

    expect(retry.groups[0].stats.delivered).toBe(3);
  });

  describe('konfiguracja TTL (RESULTS_CACHE_TTL_SECONDS)', () => {
    it('domyślnie godzina; w NODE_ENV=test domyślnie wyłączony (0); jawna wartość wygrywa', () => {
      expect(new ResultsSnapshotCache(config({}), noRedis).ttlMs).toBe(DEFAULT_RESULTS_CACHE_TTL_SECONDS * 1000);
      expect(new ResultsSnapshotCache(config({ NODE_ENV: 'test' }), noRedis).ttlMs).toBe(0);
      expect(new ResultsSnapshotCache(config({ NODE_ENV: 'test', RESULTS_CACHE_TTL_SECONDS: '600' }), noRedis).ttlMs).toBe(600_000);
      expect(new ResultsSnapshotCache(config({ RESULTS_CACHE_TTL_SECONDS: '0' }), noRedis).ttlMs).toBe(0);
    });

    it('wartość nieprawidłowa (tekst, liczba ujemna) NIE wyłącza ochrony: wraca domyślna godzina', () => {
      for (const value of ['abc', '-5', 'NaN']) {
        expect(new ResultsSnapshotCache(config({ NODE_ENV: 'production', RESULTS_CACHE_TTL_SECONDS: value }), noRedis).ttlMs).toBe(DEFAULT_RESULTS_CACHE_TTL_SECONDS * 1000);
        expect(new ResultsSnapshotCache(config({ NODE_ENV: 'test', RESULTS_CACHE_TTL_SECONDS: value }), noRedis).ttlMs).toBe(DEFAULT_RESULTS_CACHE_TTL_SECONDS * 1000);
      }
    });

    it('TTL 0 = brak cache: każde żądanie liczy od nowa', async () => {
      const cache = new ResultsSnapshotCache(config({ RESULTS_CACHE_TTL_SECONDS: '0' }), noRedis);
      let calls = 0;

      await cache.get('k', async () => [group(++calls)], at(0));
      const second = await cache.get('k', async () => [group(++calls)], at(1));

      expect(second.groups[0].stats.delivered).toBe(2);
    });
  });

  it('zegar cofnięty (odczyt "z przeszłości" względem migawki) traktuje migawkę jako nieświeżą - nie zamraża wyników', async () => {
    const cache = new ResultsSnapshotCache(config({}), noRedis);
    let calls = 0;

    await cache.get('k', async () => [group(++calls)], at(HOUR));
    const back = await cache.get('k', async () => [group(++calls)], at(0));

    expect(back.groups[0].stats.delivered).toBe(2);
  });

  it('migawka w Redisie: odczyt z Redisa, gdy jest dostępny; uszkodzona wartość jest ignorowana', async () => {
    const store = new Map<string, string>();
    const redis = {
      client: { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => void store.set(key, value) },
      isAvailable: () => true,
      key: (...parts: string[]) => parts.join(':'),
      reportFailure: jest.fn(),
      reportSuccess: jest.fn(),
    } as unknown as RedisService;
    const cache = new ResultsSnapshotCache(config({}), redis);
    let calls = 0;

    await cache.get('orgA:overview', async () => [group(++calls)], at(0));
    // Druga instancja API (pusta pamięć lokalna) widzi migawkę z Redisa i nie przelicza.
    const other = new ResultsSnapshotCache(config({}), redis);
    const shared = await other.get('orgA:overview', async () => [group(++calls)], at(1000));
    expect(shared.groups[0].stats.delivered).toBe(1);
    expect(calls).toBe(1);

    store.set('results-snapshot:orgA:overview', 'to-nie-jest-json');
    const recovered = await other.get('orgA:overview', async () => [group(++calls)], at(2000));
    expect(recovered.groups[0].stats.delivered).toBe(2);
  });

  it.each([
    ['liczba ujemna', { ...group(1), stats: { delivered: -5, clicked: 0, submitted: 0, reported: 0, reportedAfterClick: 0 } }],
    ['liczba jako tekst', { ...group(1), stats: { delivered: '99', clicked: 0, submitted: 0, reported: 0, reportedAfterClick: 0 } }],
    ['brak pola statystyk', { ...group(1), stats: { delivered: 1 } }],
    ['ułamek', { ...group(1), stats: { delivered: 1.5, clicked: 0, submitted: 0, reported: 0, reportedAfterClick: 0 } }],
    ['brak nazwy działu', { key: 'd1', departmentId: 'd1', stats: group(1).stats }],
    ['identyfikator działu obcego typu', { ...group(1), departmentId: 5 }],
  ])('wartość z Redisa o nieprawidłowym kształcie (%s) jest odrzucana, a migawka przeliczana', async (_label, badGroup) => {
    const store = new Map<string, string>([['results-snapshot:orgA:overview', JSON.stringify({ computedAt: at(0).getTime(), groups: [badGroup] })]]);
    const redis = {
      client: { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => void store.set(key, value) },
      isAvailable: () => true,
      key: (...parts: string[]) => parts.join(':'),
      reportFailure: jest.fn(),
      reportSuccess: jest.fn(),
    } as unknown as RedisService;
    const cache = new ResultsSnapshotCache(config({}), redis);

    const snapshot = await cache.get('orgA:overview', async () => [group(7)], at(1000));

    expect(snapshot.groups[0].stats.delivered).toBe(7);
  });
});
