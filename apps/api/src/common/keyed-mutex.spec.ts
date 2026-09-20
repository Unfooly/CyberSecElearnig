import { KeyedMutex } from './keyed-mutex';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyedMutex', () => {
  it('zadania o TYM SAMYM kluczu wykonują się pojedynczo i w kolejności zgłoszenia', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await sleep(ms);
      log.push(`end ${name}`);
      running -= 1;
      return name;
    };

    const results = await Promise.all([mutex.run('org', task('a', 30)), mutex.run('org', task('b', 5)), mutex.run('org', task('c', 5))]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('różne klucze nie blokują się nawzajem', async () => {
    const mutex = new KeyedMutex();
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(20);
      running -= 1;
    };

    await Promise.all([mutex.run('a', task), mutex.run('b', task), mutex.run('c', task)]);

    expect(maxRunning).toBe(3);
  });

  it('błąd zadania jest przekazany wołającemu i NIE blokuje kolejnych zadań tego klucza', async () => {
    const mutex = new KeyedMutex();

    const first = mutex.run('org', async () => {
      await sleep(5);
      throw new Error('boom');
    });
    const second = mutex.run('org', async () => 'ok');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('po zakończeniu wszystkich zadań mapa kluczy jest pusta (brak wycieku pamięci)', async () => {
    const mutex = new KeyedMutex();

    await Promise.all(Array.from({ length: 50 }, (_v, i) => mutex.run(`org-${i % 7}`, async () => sleep(1))));
    await mutex.run('org-x', async () => undefined).catch(() => undefined);

    expect(mutex.activeKeys).toBe(0);
  });

  it('wiele równoległych zadań: dokładnie jedno naraz, także gdy część rzuca błąd', async () => {
    const mutex = new KeyedMutex();
    let running = 0;
    let maxRunning = 0;

    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_v, i) =>
        mutex.run('org', async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await sleep(2);
          running -= 1;
          if (i % 4 === 0) throw new Error(`fail ${i}`);
          return i;
        }),
      ),
    );

    expect(maxRunning).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
  });
});
