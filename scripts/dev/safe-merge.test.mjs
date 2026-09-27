import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, hasSection, main, parseRaw, protectedHit, SCRIPT_PATH, touchesMigrations } from './safe-merge.mjs';

// Atrapa gh/git: stan PR, sprawdzenia, lokalny HEAD i drzewo, zmienione pliki (git diff -z --raw), treść plików z HEAD PR i origin/main.
const HEAD = 'a'.repeat(40);
const BODY = '## Po co\n\nx\n\n## Jak to sprawdzono\n\n- testy\n\n## Decyzje autopilota\n\n| co | dlaczego |\n';
const SCRIPT = 'treść skryptu z origin/main\n';
const raw = (entries) => entries.map(([status, path, mode = '100644']) => `:100644 ${mode} ${'1'.repeat(7)} ${'2'.repeat(7)} ${status}\0${path}\0`).join('');

function fake(overrides = {}) {
  const state = {
    pr: { number: 58, state: 'OPEN', mergeable: 'MERGEABLE', baseRefName: 'main', headRefName: 'feat/x', headRefOid: HEAD, body: BODY },
    checks: [
      { name: 'lint + testy', state: 'SUCCESS', bucket: 'pass', workflow: 'build-images' },
      { name: 'testy e2e (api)', state: 'SUCCESS', bucket: 'pass', workflow: 'build-images' },
      { name: 'obraz ${{ matrix.app }}', state: 'SKIPPED', bucket: 'skipping', workflow: 'build-images' },
    ],
    checksExit: 0,
    checksError: null,
    fetchFails: false,
    localHead: HEAD,
    dirty: '',
    upToDate: true,
    changes: raw([['M', 'apps/web/src/a.tsx'], ['A', 'scripts/dev/b.mjs']]),
    files: {},
    scriptOnMain: SCRIPT,
    localScript: SCRIPT,
    merged: [],
    mergeFails: false,
    ...overrides,
  };
  const run = (cmd, args) => {
    const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
    if (key === 'gh pr view') return JSON.stringify(state.pr);
    if (key === 'gh pr checks') {
      if (state.checksError) throw Object.assign(new Error(state.checksError), { stdout: '' });
      const out = JSON.stringify(state.checks);
      if (state.checksExit !== 0) throw Object.assign(new Error(`exit ${state.checksExit}`), { stdout: out });
      return out;
    }
    if (key === 'gh repo view') return JSON.stringify({ nameWithOwner: 'Unfooly/CyberSecElearnig' });
    if (key === 'gh pr merge') {
      if (state.mergeFails) throw new Error('GraphQL: Head branch was modified');
      state.merged.push(args);
      return 'merged';
    }
    if (cmd === 'git' && args[0] === 'fetch') {
      if (state.fetchFails) throw new Error('fatal: could not read from remote');
      return '';
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return `${state.localHead}\n`;
    if (cmd === 'git' && args[0] === 'status') return state.dirty;
    if (cmd === 'git' && args[0] === 'merge-base') {
      if (!state.upToDate) throw new Error('exit 1');
      return '';
    }
    if (cmd === 'git' && args.includes('diff')) return state.changes;
    if (cmd === 'git' && args[0] === 'show') {
      const [ref, ...rest] = args[1].split(':');
      const path = rest.join(':');
      if (ref === 'origin/main' && path === SCRIPT_PATH) return state.scriptOnMain;
      if (!(path in state.files)) throw new Error(`brak ${path}`);
      return state.files[path];
    }
    throw new Error(`nieoczekiwane wywołanie: ${cmd} ${args.join(' ')}`);
  };
  return { run, state, check: () => evaluate(58, run, () => state.localScript).failures };
}

const has = (failures, fragment) => failures.some((f) => f.includes(fragment));
const pr = (patch) => ({ pr: { ...fake().state.pr, ...patch } });

test('wszystkie warunki spełnione: merge przypięty do sprawdzonego commita, przez -R (bez ruszania lokalnego repo)', () => {
  const { run, state, check } = fake();
  assert.deepEqual(check(), []);
  assert.equal(main(['58'], run, () => {}, () => state.localScript), 0);
  assert.deepEqual(state.merged, [['pr', 'merge', '58', '--rebase', '--delete-branch', '--match-head-commit', HEAD, '-R', 'Unfooly/CyberSecElearnig']]);
});

test('argumenty: --dry-run bez merge; brak numeru, dwa numery albo literówka we fladze = użycie (kod 2), bez merge', () => {
  const { run, state } = fake();
  assert.equal(main(['58', '--dry-run'], run, () => {}, () => state.localScript), 0);
  for (const argv of [[], ['58', '59'], ['58', '--dryrun'], ['58', '--dry']]) assert.equal(main(argv, run, () => {}, () => state.localScript), 2, argv.join(' '));
  assert.deepEqual(state.merged, []);
});

test('błąd samego merge (np. HEAD zmieniony po sprawdzeniu): czytelny komunikat i kod 1, bez stosu', () => {
  const { run, state } = fake({ mergeFails: true });
  const logs = [];
  assert.equal(main(['58'], run, (l) => logs.push(l), () => state.localScript), 1);
  assert.ok(logs.at(-1).startsWith('Warunki spełnione, ale merge PR #58 się nie udał: GraphQL'));
});

test('odmowa: PR zamknięty/zmergowany, nie do main, z konfliktem, UNKNOWN (z podpowiedzią), nieaktualny względem main', () => {
  assert.ok(has(fake(pr({ state: 'MERGED' })).check(), 'nie jest otwarty'));
  assert.ok(has(fake(pr({ baseRefName: 'develop' })).check(), 'nie celuje w main'));
  assert.ok(has(fake(pr({ mergeable: 'CONFLICTING' })).check(), 'nie jest mergeable'));
  assert.ok(has(fake(pr({ mergeable: 'UNKNOWN' })).check(), 'spróbuj ponownie'));
  assert.ok(has(fake({ upToDate: false }).check(), 'nie jest aktualny względem main'));
});

test('odmowa: niepoprawny HEAD albo nazwa gałęzi PR (np. zaczynająca się od "-")', () => {
  assert.ok(has(fake(pr({ headRefOid: 'x' })).check(), 'niepoprawny HEAD PR'));
  assert.ok(has(fake(pr({ headRefName: '--upload-pack=x' })).check(), 'niedozwolona nazwa gałęzi'));
});

test('odmowa: wymagane sprawdzenie czerwone, w toku, brakujące, zdublowane statusem spoza workflow; inne czerwone też blokuje', () => {
  const ok = fake().state.checks;
  assert.ok(has(fake({ checks: [{ ...ok[0], state: 'FAILURE', bucket: 'fail' }, ok[1]], checksExit: 1 }).check(), '"lint + testy" nie jest zielone'));
  assert.ok(has(fake({ checks: [ok[0], { ...ok[1], state: 'IN_PROGRESS', bucket: 'pending' }], checksExit: 8 }).check(), '"testy e2e (api)" nie jest zielone'));
  assert.ok(has(fake({ checks: [ok[0]] }).check(), 'brak wymaganego sprawdzenia "testy e2e (api)"'));
  // Ręczny status commita o tej samej nazwie (bez workflow) nie przykrywa czerwonego prawdziwego sprawdzenia.
  const spoofed = fake({ checks: [{ name: 'lint + testy', state: 'SUCCESS', bucket: 'pass', workflow: '' }, { ...ok[0], state: 'FAILURE', bucket: 'fail' }, ok[1]], checksExit: 1 }).check();
  assert.ok(has(spoofed, 'spoza workflow build-images'));
  assert.ok(has(spoofed, '"lint + testy" nie jest zielone'));
  assert.ok(has(fake({ checks: [...ok, { name: 'inne', state: 'FAILURE', bucket: 'fail', workflow: 'x' }], checksExit: 1 }).check(), 'sprawdzenie "inne" jest fail'));
});

test('odmowa: brak sprawdzeń / stary gh bez --json (błąd bez stdout) i nieudane gh pr view', () => {
  assert.ok(has(fake({ checksError: 'no checks reported on the feat/x branch' }).check(), 'nie udało się odczytać sprawdzeń CI'));
  const broken = fake();
  const failures = evaluate(58, (cmd, args) => (cmd === 'gh' && args[1] === 'view' ? (() => { throw new Error('HTTP 404'); })() : broken.run(cmd, args)), () => SCRIPT).failures;
  assert.deepEqual(failures, ['nie udało się odczytać PR #58 (HTTP 404)']);
});

test('odmowa: nieudany fetch, lokalny HEAD różny od HEAD PR, niezacommitowane zmiany', () => {
  assert.ok(has(fake({ fetchFails: true }).check(), 'git fetch się nie udał'));
  assert.ok(has(fake({ localHead: 'b'.repeat(40) }).check(), 'różni się od HEAD PR'));
  assert.ok(has(fake({ dirty: ' M scripts/dev/safe-merge.mjs\n' }).check(), 'niezacommitowane zmiany'));
});

test('odmowa: uruchomiony skrypt różny od wersji z origin/main (np. osłabiony w PR albo na dysku); różnica samych końców linii OK', () => {
  assert.ok(has(fake({ localScript: 'osłabiona wersja\n' }).check(), 'różni się od wersji z origin/main'));
  assert.deepEqual(fake({ localScript: SCRIPT.replace(/\n/g, '\r\n') }).check(), []);
});

test('odmowa: pliki chronione (CI, .github, agent, hooki, CLAUDE.md, safe-merge, docker, compose, Dockerfile, Caddyfile, env, sekrety)', () => {
  for (const path of [
    '.github/workflows/build-images.yml',
    '.github/scripts/select-versions-to-delete.js',
    '.github/pull_request_template.md',
    '.claude/settings.json',
    '.Claude/settings.local.json',
    '.claude/hooks/block-destructive-git.js',
    '.githooks/pre-push',
    'CLAUDE.md',
    'scripts/dev/safe-merge.mjs',
    'scripts/dev/safe-merge.test.mjs',
    'docker/postgres-init/01-create-app-role.sh',
    'docker-compose.prod.yml',
    'compose.yaml',
    'apps/api/Dockerfile',
    'apps/web/dockerfile',
    'apps/web/web.dockerfile',
    'Containerfile',
    '.dockerignore',
    'Caddyfile',
    '.env',
    '.env.prod',
    'scripts/content/.env.local',
    'config/prod.env',
    'config/secrets.json',
    'deploy/credentials.yml',
    'certs/server.pem',
    '.npmrc',
  ]) {
    assert.ok(protectedHit(path), path);
    assert.ok(has(fake({ changes: raw([['M', path]]) }).check(), 'plik chroniony'), path);
  }
});

test('podobne, ale nie chronione: wzory env, skrypt z "secrets" w nazwie, dokumentacja, kod', () => {
  for (const path of ['.env.prod.example', 'scripts/content/.env.local.example', 'scripts/check-no-secrets-in-bundle.mjs', 'docs/ops/DISK.md', 'apps/web/src/lib/key-utils.ts', 'docs/claude.md.bak']) {
    assert.equal(protectedHit(path), null, path);
  }
});

test('-z: ścieżki spoza ASCII parsowane dosłownie (bez cytowania), więc chronione ścieżki nie uciekają; cudzysłów = odmowa', () => {
  assert.deepEqual(parseRaw(raw([['A', '.github/workflows/deploy-ż.yml']])), [{ status: 'A', mode: '100644', path: '.github/workflows/deploy-ż.yml' }]);
  assert.ok(has(fake({ changes: raw([['A', '.github/workflows/deploy-ż.yml']]) }).check(), 'plik chroniony'));
  assert.ok(has(fake({ changes: raw([['A', '"apps/x.ts"']]) }).check(), 'ścieżka w cudzysłowie'));
});

test('odmowa: dowiązanie symboliczne, submoduł i zmiana typu pliku', () => {
  assert.ok(has(fake({ changes: raw([['A', 'apps/api/prisma/migrations/x/migration.sql', '120000']]) }).check(), 'dowiązanie symboliczne'));
  assert.ok(has(fake({ changes: raw([['A', 'vendor/lib', '160000']]) }).check(), 'submoduł'));
  assert.ok(has(fake({ changes: raw([['T', 'apps/web/a.ts']]) }).check(), 'zmienia typ pliku'));
});

const MIG = 'apps/api/prisma/migrations/20260928000000_x/migration.sql';
const withMigration = (sql, status = 'A') => fake({ changes: raw([[status, MIG]]), files: { [MIG]: sql } }).check();

test('migracje: nawet czysto addytywna migracja Prisma idzie do człowieka (bez analizy SQL, D-085)', () => {
  const sql = [
    '-- CreateTable',
    'CREATE TABLE "x" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));',
    'ALTER TABLE "courses" ADD COLUMN "thumbnail" VARCHAR(300);',
  ].join('\n');
  assert.ok(has(withMigration(sql), 'każda migracja idzie do człowieka'));
});

test('migracje: KAŻDY plik i status pod apps/api/prisma/migrations/ - odmowa (także migration_lock.toml, README, wielkość liter)', () => {
  for (const path of ['apps/api/prisma/migrations/migration_lock.toml', 'apps/api/prisma/migrations/20260928000000_x/README.md', 'Apps/API/prisma/Migrations/20260928000000_x/migration.sql']) {
    for (const status of ['A', 'M', 'D']) {
      assert.ok(has(fake({ changes: raw([[status, path]]) }).check(), 'każda migracja idzie do człowieka'), `${status} ${path}`);
    }
  }
  assert.equal(touchesMigrations('apps/api/prisma/migrationsX/a.sql'), false);
  // Plik poza katalogiem migracji (schema.prisma) nie jest tym warunkiem blokowany.
  assert.ok(!has(fake({ changes: raw([['M', 'apps/api/prisma/schema.prisma']]) }).check(), 'każda migracja idzie do człowieka'));
});

test('migracje: obejścia białej listy z security review (CTAS, E\'...\', TYPE ... USING, DISABLE TRIGGER) i inne - odrzucone', () => {
  for (const sql of [
    // Obejścia dawnej białej listy (security review, druga runda):
    'CREATE TABLE "kopia" AS SELECT * FROM "users";',
    "ALTER TABLE \"users\" ADD COLUMN \"a\" TEXT DEFAULT E'\\'', DROP COLUMN \"email\";",
    'ALTER TABLE "users" ALTER "email" TYPE INT USING 0;',
    'ALTER TABLE "users" ADD COLUMN "a" INT, DISABLE TRIGGER ALL;',
    'ALTER TABLE "users" DISABLE TRIGGER ALL;',
    'DROP TABLE "x";',
    'ALTER TABLE "courses" DROP COLUMN "x";',
    'ALTER TABLE "courses" ADD COLUMN "a" INT, DROP COLUMN "b";',
    'DELETE FROM "users";',
    'TRUNCATE "users";',
    'UPDATE "users" SET "email" = NULL;',
    'ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(1);',
    'ALTER TABLE "users" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;',
    'ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;',
    'CREATE POLICY "p" ON "users" USING (true);',
    'ALTER ROLE app BYPASSRLS;',
    'CREATE OR REPLACE FUNCTION f() RETURNS int AS \'select 1\' LANGUAGE sql;',
    'GRANT ALL ON "users" TO app;',
    // Obejścia skanu słów kluczowych (security review): komentarz w literale, E'\'', dolar-cytowanie, dynamiczny SQL, komentarz blokowy.
    "SELECT '--'; DROP TABLE users;",
    "SELECT E'\\''; DROP TABLE users; SELECT '';",
    "DO $$BEGIN EXECUTE chr(68)||'ROP TABLE users'; END$$;",
    "SELECT '/*'; DROP TABLE users; SELECT '*/';",
  ]) {
    assert.ok(has(withMigration(sql), 'każda migracja idzie do człowieka'), sql);
  }
  assert.ok(has(withMigration('ALTER TABLE "a" ADD COLUMN "b" INT;', 'M'), 'każda migracja idzie do człowieka'));
  assert.ok(has(withMigration('x', 'D'), 'każda migracja idzie do człowieka'));
});

test('prawdziwa migracja z repo (addytywna kolumna miniatury) też idzie do człowieka', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'api', 'prisma', 'migrations');
  assert.ok(has(withMigration(readFileSync(join(root, '20260927140000_course_thumbnail', 'migration.sql'), 'utf8')), 'każda migracja idzie do człowieka'));
});

test('opis PR: wymagane niepuste sekcje "Decyzje autopilota" i "Jak to sprawdzono"', () => {
  assert.ok(has(fake(pr({ body: '## Jak to sprawdzono\nx' })).check(), '"Decyzje autopilota"'));
  assert.ok(has(fake(pr({ body: '## Decyzje autopilota\nx' })).check(), '"Jak to sprawdzono"'));
  assert.equal(hasSection('Zobacz Decyzje autopilota niżej', 'Decyzje autopilota'), false);
  assert.equal(hasSection('## Decyzje autopilota\n\n## Jak to sprawdzono\nx', 'Decyzje autopilota'), false);
  assert.equal(hasSection('### Decyzje autopilota  \n- a', 'Decyzje autopilota'), true);
});

test('kilka niespełnionych warunków naraz: wypisane konkretne powody, bez merge (kod 1)', () => {
  const { run, state } = fake({ ...pr({ mergeable: 'CONFLICTING', body: '' }), changes: raw([['M', '.claude/settings.json']]) });
  const logs = [];
  assert.equal(main(['58'], run, (l) => logs.push(l), () => state.localScript), 1);
  assert.deepEqual(state.merged, []);
  assert.equal(logs[0], 'ODMOWA merge PR #58 - niespełnione warunki:');
  for (const fragment of ['nie jest mergeable', 'plik chroniony (ustawienia agenta', '"Decyzje autopilota"', '"Jak to sprawdzono"']) {
    assert.ok(logs.some((l) => l.includes(fragment)), fragment);
  }
});
