import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, databaseHost, databaseProblems, GUARDED_VARIABLES, LOCAL_DATABASE_HOSTS, LOCAL_REDIS_HOSTS, redisHost, refusalMessage } from '../../lib/local-db-guard.mjs';

// B-140/B-141: skrypty e2e, layout-check i testy e2e API odmawiają startu, gdy baza albo Redis nie są lokalne ani kontenerem testowym CI.
// Adresy w testach są zmyślone.
const url = (host: string, extra = '') => `postgresql://user:haslo@${host}:5432/baza?schema=public${extra}`;
const redis = (host: string) => `redis://${host}:6379`;
const bracket = (host: string) => (host.includes(':') ? `[${host}]` : host);
/** Komplet lokalnych zmiennych z podmianą wybranych. */
const env = (overrides: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: url('localhost'),
  DATABASE_URL_APP: url('localhost'),
  REDIS_URL: redis('localhost'),
  ...overrides,
});
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(SCRIPTS, '..');

describe('databaseHost', () => {
  it.each([
    [url('localhost'), 'localhost'],
    [url('127.0.0.1'), '127.0.0.1'],
    [url('[::1]'), '::1'],
    [url('ci-pg'), 'ci-pg'],
    [url('LOCALHOST'), 'localhost'],
    ['postgres://u:p@db.example.com/baza', 'db.example.com'],
  ])('%s -> %s', (value, host) => {
    expect(databaseHost(value)).toBe(host);
  });

  it.each([
    ['', 'pusty'],
    [undefined, 'brak'],
    ['to nie jest adres', 'nie URL'],
    ['localhost:5432/baza', 'bez protokołu'],
    ['mysql://u:p@localhost/baza', 'inny protokół'],
    [redis('localhost'), 'adres Redisa w zmiennej bazy'],
    [url('localhost', '&host=/var/run/postgresql'), 'parametr host nadpisuje hosta'],
    [url('localhost', '&HOST=db.example.com'), 'parametr HOST (wielkie litery)'],
    [url('localhost', '&hostaddr=10.0.0.5'), 'parametr hostaddr'],
    ['postgresql:///baza', 'bez hosta'],
    ['prisma://localhost/?api_key=x', 'inny protokół (prisma)'],
    ['postgresql://user:p@localhost:5432@db.example.com/baza', 'dwa znaki @'],
    ['postgresql://admin:tajne@haslo#1@db.example.com/prod', 'niezakodowane hasło z @ i #'],
    ['postgresql://admin:taj/ne@db.example.com/prod', 'niezakodowane hasło z /'],
    ['postgresql://localhost,db.example.com/baza', 'wiele hostów'],
  ])('nie do odczytania (%s, %s) -> null', (value, _why) => {
    expect(databaseHost(value)).toBeNull();
  });
});

describe('redisHost', () => {
  it.each([
    ['redis://localhost:6379', 'localhost'],
    ['redis://127.0.0.1:6379/2', '127.0.0.1'],
    ['redis://[::1]:6379', '::1'],
    ['redis://ci-redis:6379', 'ci-redis'],
    ['rediss://:haslo@cache.example.com:6380', 'cache.example.com'],
    ['redis://user:haslo@LOCALHOST:6379', 'localhost'],
  ])('%s -> %s', (value, host) => {
    expect(redisHost(value)).toBe(host);
  });

  it.each([
    ['', 'pusty'],
    ['localhost:6379', 'bez protokołu'],
    [url('localhost'), 'adres bazy w zmiennej Redisa'],
    ['redis://:ta@jne@cache.example.com:6379', 'dwa znaki @'],
    ['redis://localhost:6379?host=cache.example.com', 'parametr host'],
    ['redis://localhost,cache.example.com:6379', 'wiele hostów'],
  ])('nie do odczytania (%s, %s) -> null', (value, _why) => {
    expect(redisHost(value)).toBeNull();
  });
});

describe('databaseProblems', () => {
  it.each(LOCAL_DATABASE_HOSTS)('baza lokalna %s przechodzi (obie zmienne)', (host) => {
    const value = url(bracket(host));
    expect(databaseProblems(env({ DATABASE_URL: value, DATABASE_URL_APP: value }))).toEqual([]);
  });

  it.each(LOCAL_REDIS_HOSTS)('Redis lokalny %s przechodzi', (host) => {
    expect(databaseProblems(env({ REDIS_URL: redis(bracket(host)) }))).toEqual([]);
  });

  it('blokada obejmuje adresy bazy (rola migracyjna i aplikacyjna) oraz Redisa', () => {
    expect(GUARDED_VARIABLES).toEqual(['DATABASE_URL', 'DATABASE_URL_APP', 'REDIS_URL']);
  });

  it('listy dozwolonych hostów: pętla zwrotna i kontenery repliki CI, bez nazw usług compose', () => {
    expect(LOCAL_DATABASE_HOSTS).toEqual(['localhost', '127.0.0.1', '::1', 'ci-pg']);
    expect(LOCAL_REDIS_HOSTS).toEqual(['localhost', '127.0.0.1', '::1', 'ci-redis']);
  });

  it('GitHub Actions (localhost z kontenerami serwisowymi) przechodzi', () => {
    expect(databaseProblems({ DATABASE_URL: url('localhost'), DATABASE_URL_APP: url('localhost', '&connection_limit=10'), REDIS_URL: 'redis://localhost:6379' })).toEqual([]);
  });

  it.each(['db.example.com', '10.0.0.5', 'postgres', 'localhost.example.com', 'ci-pg.example.com', '127.0.0.1.example.com', 'host.docker.internal', 'ci-redis'])(
    'baza na hoście nielokalnym %s blokuje',
    (host) => {
      const problems = databaseProblems(env({ DATABASE_URL: url(host) }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`"${host}"`);
    },
  );

  it.each(['cache.example.com', '10.0.0.6', 'redis', 'localhost.example.com', 'ci-redis.example.com', 'host.docker.internal', 'ci-pg'])(
    'Redis na hoście nielokalnym %s blokuje',
    (host) => {
      expect(databaseProblems(env({ REDIS_URL: redis(host) }))).toEqual([`REDIS_URL wskazuje na host "${host}"`]);
    },
  );

  it('lokalny DATABASE_URL nie wystarczy, gdy DATABASE_URL_APP (rola API) jest nielokalny', () => {
    expect(databaseProblems(env({ DATABASE_URL_APP: url('db.example.com') }))).toEqual(['DATABASE_URL_APP wskazuje na host "db.example.com"']);
  });

  // API dociąga brakujące zmienne z pliku .env w katalogu uruchomienia - nieustawiona zmienna mogłaby przyjść stamtąd.
  it('skrypt piszący do bazy wymaga WSZYSTKICH zmiennych w środowisku; skrypt bez bazy (layout-check) nie wymaga żadnej', () => {
    expect(databaseProblems({})).toEqual(['DATABASE_URL nie jest ustawiony', 'DATABASE_URL_APP nie jest ustawiony', 'REDIS_URL nie jest ustawiony']);
    expect(databaseProblems(env({ DATABASE_URL_APP: undefined }))).toEqual(['DATABASE_URL_APP nie jest ustawiony']);
    expect(databaseProblems(env({ DATABASE_URL_APP: '' }))).toEqual(['DATABASE_URL_APP nie jest ustawiony']);
    expect(databaseProblems(env({ REDIS_URL: undefined }))).toEqual(['REDIS_URL nie jest ustawiony']);
    expect(databaseProblems({}, { required: false })).toEqual([]);
    expect(databaseProblems({ DATABASE_URL: url('db.example.com') }, { required: false })).toHaveLength(1);
    expect(databaseProblems({ DATABASE_URL_APP: url('db.example.com') }, { required: false })).toHaveLength(1);
    expect(databaseProblems({ REDIS_URL: redis('cache.example.com') }, { required: false })).toHaveLength(1);
  });

  it('adres nie do odczytania blokuje (fail-closed) i nie trafia do komunikatu', () => {
    expect(databaseProblems(env({ DATABASE_URL: 'postgresql://user:tajne-haslo@' }))).toEqual(['DATABASE_URL: nie da się jednoznacznie odczytać hosta bazy z adresu']);
    expect(databaseProblems(env({ REDIS_URL: 'redis://:tajne@haslo@cache.example.com' }))).toEqual(['REDIS_URL: nie da się jednoznacznie odczytać hosta Redisa z adresu']);
  });

  it.each([
    'postgresql://admin:tajne-haslo@db.example.com:5432/prod',
    'postgresql://admin:tajne@haslo#1@db.example.com/prod',
    'postgresql://admin:tajne/haslo@db.example.com/prod',
    'postgresql://admin:tajne?haslo@db.example.com/prod',
    'rediss://admin:tajne-haslo@cache.example.com:6380',
    'redis://admin:tajne@haslo@cache.example.com:6379',
  ])('komunikat nie zawiera loginu ani żadnego fragmentu hasła (%s)', (value) => {
    const problems = databaseProblems({ DATABASE_URL: value, DATABASE_URL_APP: value, REDIS_URL: value }).join(' ');
    expect(problems).not.toMatch(/tajne|haslo|admin/);
  });
});

describe('assertLocalDatabase', () => {
  const run = (values: Record<string, string | undefined>, required = true) => {
    const codes: number[] = [];
    const messages: string[] = [];
    assertLocalDatabase('scripts/test.mjs', { env: values, required, exit: (code) => codes.push(code), log: (message) => messages.push(message) });
    return { codes, message: messages.join('\n') };
  };

  it('środowisko lokalne: bez komunikatu i bez wyjścia', () => {
    expect(run(env())).toEqual({ codes: [], message: '' });
    expect(run({}, false)).toEqual({ codes: [], message: '' });
  });

  it('baza nielokalna: kod 1 i czytelny komunikat z nazwą skryptu, hostem i dozwolonymi hostami, bez adresu', () => {
    const { codes, message } = run(env({ DATABASE_URL: 'postgresql://admin:tajne-haslo@db.example.com:5432/prod' }));
    expect(codes).toEqual([1]);
    expect(message).toContain('ODMOWA: scripts/test.mjs');
    expect(message).toContain('"db.example.com"');
    expect(message).toContain('localhost, 127.0.0.1, ::1, ci-pg');
    expect(message).toContain('localhost, 127.0.0.1, ::1, ci-redis');
    expect(message).toContain('nie da się wyłączyć flagą');
    expect(message).not.toContain('tajne-haslo');
  });

  it('Redis nielokalny: kod 1 z nazwą zmiennej i hostem', () => {
    const { codes, message } = run(env({ REDIS_URL: 'rediss://:tajne-haslo@cache.example.com:6380' }));
    expect(codes).toEqual([1]);
    expect(message).toContain('REDIS_URL wskazuje na host "cache.example.com"');
    expect(message).not.toContain('tajne-haslo');
  });

  it('nie ma zmiennej ani argumentu, który wyłącza blokadę', () => {
    const values = env({ DATABASE_URL: url('db.example.com'), E2E_ALLOW_REMOTE_DB: '1', FORCE: '1', ALLOW_REMOTE_DB: 'true', SKIP_DB_GUARD: '1' });
    expect(run(values).codes).toEqual([1]);
    // Kod blokady nie czyta żadnej zmiennej poza sprawdzanymi adresami.
    const source = readFileSync(join(SCRIPTS, 'lib', 'local-db-guard.mjs'), 'utf8');
    expect(source.match(/env\[[^\]]+\]/g)).toEqual(['env[name]']);
    expect(source).not.toMatch(/process\.argv/);
  });

  it('refusalMessage: ten sam komunikat dla skryptów i testów e2e API', () => {
    const message = refusalMessage('npm run test:e2e (apps/api)', ['REDIS_URL nie jest ustawiony']);
    expect(message).toContain('ODMOWA: npm run test:e2e (apps/api)');
    expect(message).toContain('REDIS_URL nie jest ustawiony');
  });
});

describe('skrypty wołają blokadę przed czymkolwiek innym', () => {
  it.each([
    ['e2e-module.mjs', true],
    ['e2e-module-01.mjs', true],
    ['e2e-module-02.mjs', true],
    ['e2e-registration.mjs', true],
    ['screenshot-module.mjs', true],
    ['layout-check.mjs', false],
  ])('%s', (file, required) => {
    const source = readFileSync(join(SCRIPTS, file), 'utf8');
    const call = source.indexOf('assertLocalDatabase(');
    expect(call, 'wywołanie assertLocalDatabase').toBeGreaterThan(-1);
    expect(source).toContain("from './lib/local-db-guard.mjs'");
    // Przed blokadą nie startuje żaden proces, przeglądarka ani klient bazy.
    const before = source.slice(0, call);
    expect(before).not.toMatch(/spawn\(|new PrismaClient\(|chromium\.launch\(/);
    const statement = source.slice(call, source.indexOf('\n', call));
    expect(statement.includes('required: false')).toBe(!required);
  });
});

describe('testy e2e API (npm run test:e2e) mają tę samą blokadę w globalSetup', () => {
  const apiTest = join(REPO, 'apps', 'api', 'test');

  it('jest-e2e.json wskazuje globalSetup, a ten używa wspólnej blokady z wymogiem wszystkich zmiennych', () => {
    const config = JSON.parse(readFileSync(join(apiTest, 'jest-e2e.json'), 'utf8')) as { globalSetup?: string };
    expect(config.globalSetup).toBe('<rootDir>/global-setup.cjs');
    const setup = readFileSync(join(apiTest, 'global-setup.cjs'), 'utf8');
    expect(setup).toContain('scripts/lib/local-db-guard.mjs');
    expect(setup).toMatch(/databaseProblems\(process\.env\)/);
    expect(setup).toMatch(/throw new Error\(refusalMessage\(/);
  });

  it('globalSetup odmawia na nielokalnej bazie i przepuszcza lokalne środowisko', async () => {
    const { createRequire } = await import('node:module');
    const globalSetup = createRequire(import.meta.url)(join(apiTest, 'global-setup.cjs')) as () => Promise<void>;
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env({ DATABASE_URL: url('db.example.com') }));
      await expect(globalSetup()).rejects.toThrow(/ODMOWA: npm run test:e2e \(apps\/api\).*DATABASE_URL wskazuje na host "db\.example\.com"/s);
      Object.assign(process.env, env());
      await expect(globalSetup()).resolves.toBeUndefined();
    } finally {
      for (const name of ['DATABASE_URL', 'DATABASE_URL_APP', 'REDIS_URL']) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
