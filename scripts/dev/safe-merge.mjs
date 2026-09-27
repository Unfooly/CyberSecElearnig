#!/usr/bin/env node
// Bezpieczny merge PR przez agenta (CLAUDE.md, reguła 11; D-085): JEDYNA dozwolona dla agenta droga do `gh pr merge` (samo `gh pr merge`
// zostaje w permissions.deny i w hooku block-destructive-git.js). Sprawdza warunki i ODMAWIA, wypisując każdy niespełniony; dopiero gdy
// wszystkie są spełnione, woła `gh pr merge <nr> --rebase --delete-branch --match-head-commit <sha> -R <repo>`. Recenzje (code-reviewer /
// security-reviewer), layout-check i `--check` NIE są tu sprawdzane - agent wykonuje je przed wywołaniem. To bariera przed odruchem, nie
// sandbox (jak hook block-destructive-git.js): chroni przed pomyłką agenta, nie przed kimś, kto celowo zmienia repo. Wszystko, czego nie
// umie ocenić, odrzuca (fail-closed) - fałszywy alarm oznacza tylko merge przez człowieka.
//
// Użycie: node scripts/dev/safe-merge.mjs <nr PR> [--dry-run]
//   --dry-run: tylko sprawdzenie, bez merge (kod wyjścia 0 = wszystkie warunki spełnione).
//
// Warunki:
//   1. PR otwarty, do `main`, bez konfliktów (mergeable = MERGEABLE) i aktualny względem `main` (origin/main jest przodkiem HEAD PR) - przy
//      "Rebase and merge" CI puszczone na starej bazie nie testowało połączenia z nowymi commitami z main.
//   2. Wymagane sprawdzenia (REQUIRED_CHECKS, z workflow REQUIRED_WORKFLOW) zielone na HEAD PR - WSZYSTKIE wpisy o danej nazwie; żadne
//      inne sprawdzenie nie jest czerwone ani w toku.
//   3. HEAD PR = lokalny HEAD po `git fetch`, brak niezacommitowanych zmian w śledzonych plikach, a merge dostaje `--match-head-commit`
//      (commit dopchnięty po sprawdzeniu nie wejdzie). Uruchomiony skrypt musi być identyczny z wersją z origin/main (inaczej sprawdzałby
//      sam siebie w wersji z PR albo z dysku).
//   4. PR nie zmienia plików chronionych (PROTECTED_PATHS) ani nie dodaje/zmienia dowiązań symbolicznych i typów plików.
//   5. PR nie zmienia NICZEGO pod apps/api/prisma/migrations/ (dodanie, edycja, usunięcie) - każda migracja czeka na człowieka. Bez
//      analizy SQL (decyzja właściciela po security review D-085: biała lista instrukcji dawała się obejść - CREATE TABLE ... AS SELECT,
//      literał E'...' w wieloczynnościowym ALTER, ALTER ... TYPE ... USING, DISABLE TRIGGER).
//   6. Opis PR ma niepuste sekcje REQUIRED_SECTIONS.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = ['lint + testy', 'testy e2e (api)'];
export const REQUIRED_WORKFLOW = 'build-images';
export const REQUIRED_SECTIONS = ['Decyzje autopilota', 'Jak to sprawdzono'];
export const SCRIPT_PATH = 'scripts/dev/safe-merge.mjs';

/** Ścieżki, których zmiana wymaga merge przez człowieka (zapis POSIX, względem korzenia repo; bez rozróżniania wielkości liter - NTFS). */
export const PROTECTED_PATHS = [
  { pattern: /^\.github\//i, label: 'CI i konfiguracja GitHub (.github/)' },
  { pattern: /^\.claude\//i, label: 'ustawienia agenta (.claude/)' },
  { pattern: /^\.githooks\//i, label: 'hooki gita (.githooks/)' },
  { pattern: /^CLAUDE\.md$/i, label: 'zasady pracy agenta (CLAUDE.md)' },
  { pattern: /^scripts\/dev\/safe-merge[^/]*$/i, label: 'skrypt safe-merge' },
  { pattern: /^docker\//i, label: 'inicjalizacja kontenerów (docker/ - m.in. rola bazy dla RLS)' },
  { pattern: /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i, label: 'docker compose' },
  { pattern: /(^|\/)(Dockerfile[^/]*|[^/]*\.dockerfile|Containerfile[^/]*|\.dockerignore)$/i, label: 'Dockerfile / .dockerignore' },
  { pattern: /(^|\/)Caddyfile[^/]*$/i, label: 'Caddyfile (reverse proxy)' },
  // Pliki env (poza wzorami *.example): .env*, *.env, prod.env.
  { pattern: /(^|\/)(\.env[^/]*|[^/]*\.env)$/i, exclude: /\.example$/i, label: 'plik env' },
  // Po NAZWIE pliku (secrets.json, credentials.yml, x.secret) - scripts/check-no-secrets-in-bundle.mjs to nie sekret.
  { pattern: /(^|\/)(secrets?|credentials?)(\.[^/]*)?$|\.secrets?$/i, label: 'plik z sekretami' },
  { pattern: /\.(pem|key|p12|pfx|jks)$/i, label: 'klucz/certyfikat' },
  { pattern: /(^|\/)(\.npmrc|id_rsa[^/]*|id_ed25519[^/]*)$/i, label: 'plik z danymi dostępowymi' },
];

export function protectedHit(path) {
  return PROTECTED_PATHS.find(({ pattern, exclude }) => pattern.test(path) && !(exclude && exclude.test(path))) ?? null;
}

/** Katalog migracji Prisma - każda zmiana pod nim (dowolny plik, dowolny status) idzie do człowieka (warunek 5). */
export const MIGRATIONS_DIR = /^apps\/api\/prisma\/migrations\//i;

export function touchesMigrations(path) {
  return MIGRATIONS_DIR.test(path);
}

/** Sekcja opisu PR: nagłówek markdown z tym tytułem i niepusta treść przed kolejnym nagłówkiem. */
export function hasSection(body, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^#{1,6}\\s*${escaped}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|$(?![\\s\\S]))`, 'mi').exec(body ?? '');
  return Boolean(match && match[1].trim());
}

/** Jak `run`, ale przy niezerowym kodzie wyjścia oddaje stdout z błędu (jeśli jest), zamiast rzucać. */
function runAllowingExit(run, cmd, args) {
  try {
    return run(cmd, args);
  } catch (error) {
    const stdout = error && typeof error.stdout === 'string' ? error.stdout : '';
    if (stdout.trim()) return stdout;
    throw error;
  }
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

/**
 * `git diff -z --raw`: wpisy `:<stary tryb> <nowy tryb> <sha> <sha> <status>` + NUL + ścieżka (rename/copy: dwie ścieżki). Bez cytowania
 * ścieżek spoza ASCII (-z). Zwraca { status, mode, path }.
 */
export function parseRaw(output) {
  const parts = output.split('\0').filter((part) => part !== '');
  const changes = [];
  for (let i = 0; i < parts.length; i += 1) {
    const meta = parts[i].replace(/^:/, '').split(' ');
    const status = (meta[4] ?? '?')[0];
    const mode = meta[1] ?? '';
    const paths = /^[RC]$/.test(status) ? [parts[i + 1], parts[i + 2]] : [parts[i + 1]];
    for (const path of paths) if (path !== undefined) changes.push({ status, mode, path });
    i += paths.length;
  }
  return changes;
}

/**
 * Sprawdza wszystkie warunki i zwraca { failures, pr } (failures puste = można mergować). `run(cmd, args)` zwraca stdout (string) albo
 * rzuca; `readLocalScript()` zwraca treść uruchomionego skryptu - w testach atrapy.
 */
export function evaluate(prNumber, run, readLocalScript = () => readFileSync(fileURLToPath(import.meta.url), 'utf8')) {
  const failures = [];
  let pr;
  try {
    pr = JSON.parse(run('gh', ['pr', 'view', String(prNumber), '--json', 'number,state,mergeable,baseRefName,headRefName,headRefOid,body']));
  } catch (error) {
    return { failures: [`nie udało się odczytać PR #${prNumber} (${firstLine(error)})`], pr: null };
  }
  if (!/^[0-9a-f]{40}$/.test(String(pr.headRefOid))) return { failures: [`niepoprawny HEAD PR (${pr.headRefOid})`], pr: null };
  if (!/^[A-Za-z0-9._/-]+$/.test(String(pr.headRefName)) || String(pr.headRefName).startsWith('-')) {
    return { failures: [`niedozwolona nazwa gałęzi PR (${pr.headRefName})`], pr: null };
  }

  // 1. Stan PR.
  if (pr.state !== 'OPEN') failures.push(`PR nie jest otwarty (state=${pr.state})`);
  if (pr.baseRefName !== 'main') failures.push(`PR nie celuje w main (base=${pr.baseRefName})`);
  if (pr.mergeable !== 'MERGEABLE') {
    failures.push(`PR nie jest mergeable (mergeable=${pr.mergeable}${pr.mergeable === 'UNKNOWN' ? ' - GitHub jeszcze liczy, spróbuj ponownie za kilka sekund' : ''})`);
  }

  // 2. Sprawdzenia CI na HEAD PR. `gh pr checks` kończy się kodem != 0, gdy coś jest czerwone albo w toku - JSON jest wtedy w stdout błędu.
  let checks = [];
  try {
    checks = JSON.parse(runAllowingExit(run, 'gh', ['pr', 'checks', String(prNumber), '--json', 'name,state,bucket,workflow']));
  } catch (error) {
    failures.push(`nie udało się odczytać sprawdzeń CI (${firstLine(error)})`);
  }
  for (const name of REQUIRED_CHECKS) {
    const entries = checks.filter((c) => c.name === name);
    if (entries.length === 0) failures.push(`brak wymaganego sprawdzenia "${name}" na HEAD PR`);
    for (const entry of entries) {
      if (entry.workflow !== REQUIRED_WORKFLOW) failures.push(`sprawdzenie "${name}" spoza workflow ${REQUIRED_WORKFLOW} (${entry.workflow || 'status commita'})`);
      else if (entry.bucket !== 'pass') failures.push(`sprawdzenie "${name}" nie jest zielone (${entry.bucket}/${entry.state})`);
    }
  }
  for (const check of checks) {
    if (!REQUIRED_CHECKS.includes(check.name) && ['fail', 'pending', 'cancel'].includes(check.bucket)) {
      failures.push(`sprawdzenie "${check.name}" jest ${check.bucket}`);
    }
  }

  // 3. HEAD PR = lokalny HEAD po fetch, czyste drzewo, PR aktualny względem main, skrypt = wersja z origin/main.
  let fetched = false;
  try {
    run('git', ['fetch', 'origin', '--', 'main', pr.headRefName]);
    fetched = true;
  } catch (error) {
    failures.push(`git fetch się nie udał (${firstLine(error)})`);
  }
  if (fetched) {
    try {
      const localHead = run('git', ['rev-parse', 'HEAD']).trim();
      if (localHead !== pr.headRefOid) failures.push(`lokalny HEAD (${localHead.slice(0, 7)}) różni się od HEAD PR (${pr.headRefOid.slice(0, 7)})`);
      if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim()) failures.push('niezacommitowane zmiany w śledzonych plikach');
    } catch (error) {
      failures.push(`nie udało się odczytać stanu lokalnego repo (${firstLine(error)})`);
    }
    try {
      run('git', ['merge-base', '--is-ancestor', 'origin/main', pr.headRefOid]);
    } catch {
      failures.push('PR nie jest aktualny względem main (origin/main nie jest przodkiem HEAD PR) - zrób rebase na origin/main i poczekaj na CI');
    }
    try {
      const onMain = run('git', ['show', `origin/main:${SCRIPT_PATH}`]).replace(/\r\n/g, '\n');
      if (readLocalScript().replace(/\r\n/g, '\n') !== onMain) failures.push(`uruchomiony ${SCRIPT_PATH} różni się od wersji z origin/main`);
    } catch (error) {
      failures.push(`nie udało się porównać ${SCRIPT_PATH} z origin/main (${firstLine(error)})`);
    }
  }

  // 4-5. Zmienione pliki (względem wspólnego przodka z main), dowiązania i migracje.
  let changes = [];
  try {
    changes = parseRaw(run('git', ['-c', 'core.quotepath=off', 'diff', '-z', '--raw', '--no-renames', `origin/main...${pr.headRefOid}`]));
  } catch (error) {
    failures.push(`nie udało się odczytać zmienionych plików (${firstLine(error)})`);
  }
  for (const { status, mode, path } of changes) {
    const hit = protectedHit(path);
    if (hit) failures.push(`PR zmienia plik chroniony (${hit.label}): ${path}`);
    if (path.startsWith('"')) failures.push(`ścieżka w cudzysłowie (nieoceniana automatycznie): ${path}`);
    if (mode === '120000' || mode === '160000') failures.push(`PR dodaje/zmienia dowiązanie symboliczne albo submoduł: ${path}`);
    if (status === 'T') failures.push(`PR zmienia typ pliku: ${path}`);
  }
  for (const { status, path } of changes.filter((c) => touchesMigrations(c.path))) {
    failures.push(`PR zmienia migracje bazy (status ${status}) - każda migracja idzie do człowieka: ${path}`);
  }

  // 6. Opis PR.
  for (const section of REQUIRED_SECTIONS) {
    if (!hasSection(pr.body, section)) failures.push(`opis PR nie ma (niepustej) sekcji "${section}"`);
  }
  return { failures, pr };
}

function defaultRun(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const USAGE = 'Użycie: node scripts/dev/safe-merge.mjs <nr PR> [--dry-run]';

export function main(argv = process.argv.slice(2), run = defaultRun, log = console.log, readLocalScript = undefined) {
  // Ściśle: jeden numer PR i opcjonalnie --dry-run. Literówka w fladze (np. --dryrun) nie może oznaczać prawdziwego merge.
  const numbers = argv.filter((arg) => /^\d+$/.test(arg));
  const unknown = argv.filter((arg) => !/^\d+$/.test(arg) && arg !== '--dry-run');
  if (numbers.length !== 1 || unknown.length > 0) {
    log(unknown.length > 0 ? `Nieznane argumenty: ${unknown.join(' ')}` : 'Podaj dokładnie jeden numer PR.');
    log(USAGE);
    return 2;
  }
  const [prNumber] = numbers;
  const dryRun = argv.includes('--dry-run');
  const { failures, pr } = evaluate(prNumber, run, readLocalScript);
  if (failures.length > 0) {
    log(`ODMOWA merge PR #${prNumber} - niespełnione warunki:`);
    for (const failure of failures) log(`  - ${failure}`);
    return 1;
  }
  if (dryRun) {
    log(`OK: PR #${prNumber} spełnia wszystkie warunki (--dry-run: bez merge).`);
    return 0;
  }
  try {
    // -R: gh nie rusza lokalnego repo (bez przełączania na main i siłowego usuwania lokalnej gałęzi - reguły 11 i 13); gałąź zdalna jest
    // usuwana przez API. --match-head-commit: merge wyłącznie sprawdzonego commita.
    const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    log(`OK: PR #${prNumber} spełnia wszystkie warunki - merge (rebase) commita ${pr.headRefOid.slice(0, 7)}.`);
    log(run('gh', ['pr', 'merge', String(prNumber), '--rebase', '--delete-branch', '--match-head-commit', pr.headRefOid, '-R', repo]));
    return 0;
  } catch (error) {
    log(`Warunki spełnione, ale merge PR #${prNumber} się nie udał: ${firstLine(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main();
}
