import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, databaseHost, databaseProblems, LOCAL_DATABASE_HOSTS } from '../../lib/local-db-guard.mjs';

// B-140: skrypty e2e i layout-check odmawiają startu, gdy baza nie jest lokalna ani kontenerem testowym CI. Adresy w testach są zmyślone.
const url = (host: string, extra = '') => `postgresql://user:haslo@${host}:5432/baza?schema=public${extra}`;
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
    ['mysql://u:p@localhost/baza', 'inny protokół'],
    [url('localhost', '&host=/var/run/postgresql'), 'parametr host nadpisuje hosta'],
    ['postgresql:///baza', 'bez hosta'],
  ])('nie do odczytania (%s, %s) -> null', (value, _why) => {
    expect(databaseHost(value)).toBeNull();
  });
});

describe('databaseProblems', () => {
  it.each(LOCAL_DATABASE_HOSTS)('host lokalny %s przechodzi (obie zmienne)', (host) => {
    const value = url(host.includes(':') ? `[${host}]` : host);
    expect(databaseProblems({ DATABASE_URL: value, DATABASE_URL_APP: value })).toEqual([]);
  });

  it('GitHub Actions (localhost z kontenerem serwisowym) przechodzi', () => {
    expect(databaseProblems({ DATABASE_URL: url('localhost'), DATABASE_URL_APP: url('localhost', '&connection_limit=10') })).toEqual([]);
  });

  it.each(['db.example.com', '10.0.0.5', 'postgres', 'localhost.example.com', 'ci-pg.example.com', '127.0.0.1.example.com', 'host.docker.internal'])(
    'host nielokalny %s blokuje',
    (host) => {
      const problems = databaseProblems({ DATABASE_URL: url(host) });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`"${host}"`);
    },
  );

  it('lokalny DATABASE_URL nie wystarczy, gdy DATABASE_URL_APP (rola API) jest nielokalny', () => {
    const problems = databaseProblems({ DATABASE_URL: url('localhost'), DATABASE_URL_APP: url('db.example.com') });
    expect(problems).toEqual(['DATABASE_URL_APP wskazuje na host "db.example.com"']);
  });

  it('brak DATABASE_URL blokuje skrypt, który pisze do bazy, a nie blokuje skryptu bez bazy (layout-check)', () => {
    expect(databaseProblems({})).toEqual(['DATABASE_URL nie jest ustawiony']);
    expect(databaseProblems({}, { required: false })).toEqual([]);
    expect(databaseProblems({ DATABASE_URL: url('db.example.com') }, { required: false })).toHaveLength(1);
  });

  it('adres nie do odczytania blokuje (fail-closed) i nie trafia do komunikatu', () => {
    const problems = databaseProblems({ DATABASE_URL: 'postgresql://user:tajne-haslo@' });
    expect(problems).toEqual(['DATABASE_URL: nie da się odczytać hosta bazy z adresu']);
  });

  it('komunikat nie zawiera loginu ani hasła', () => {
    const problems = databaseProblems({ DATABASE_URL: 'postgresql://admin:tajne-haslo@db.example.com:5432/prod' }).join(' ');
    expect(problems).not.toContain('tajne-haslo');
    expect(problems).not.toContain('admin');
  });
});

describe('assertLocalDatabase', () => {
  const run = (env: Record<string, string | undefined>, required = true) => {
    const codes: number[] = [];
    const messages: string[] = [];
    assertLocalDatabase('scripts/test.mjs', { env, required, exit: (code) => codes.push(code), log: (message) => messages.push(message) });
    return { codes, message: messages.join('\n') };
  };

  it('baza lokalna: bez komunikatu i bez wyjścia', () => {
    expect(run({ DATABASE_URL: url('localhost') })).toEqual({ codes: [], message: '' });
  });

  it('baza nielokalna: kod 1 i czytelny komunikat z nazwą skryptu, hostem i dozwolonymi hostami, bez adresu', () => {
    const { codes, message } = run({ DATABASE_URL: 'postgresql://admin:tajne-haslo@db.example.com:5432/prod' });
    expect(codes).toEqual([1]);
    expect(message).toContain('ODMOWA: scripts/test.mjs');
    expect(message).toContain('"db.example.com"');
    expect(message).toContain('localhost, 127.0.0.1, ::1, ci-pg');
    expect(message).toContain('nie da się wyłączyć flagą');
    expect(message).not.toContain('tajne-haslo');
  });

  it('nie ma zmiennej ani argumentu, który wyłącza blokadę', () => {
    const env = { DATABASE_URL: url('db.example.com'), E2E_ALLOW_REMOTE_DB: '1', FORCE: '1', ALLOW_REMOTE_DB: 'true' };
    expect(run(env).codes).toEqual([1]);
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
