// Kopia zapasowa bazy (B-117, D-136, docs/ops/BACKUP.md) - uruchamiany w CI (build-images.yml, "lint + testy"):
//   node --test scripts/ops/db-backup.test.mjs
// Statyczne gwarancje skryptów (odtworzenie na prawdziwych danych sprawdza ręcznie db-restore-check.sh - runbook):
// 1. Kopia tylko czyta: rola cyberszkolo_backup bez superusera, bez hasła, tylko pg_read_all_data; pg_dump tą rolą.
// 2. Kopia nie opuszcza VPS niezaszyfrowana: age kluczem publicznym przed wysyłką, zrzut kasowany, klucz prywatny nigdy na VPS.
// 3. Sekrety nie trafiają do logów, argumentów ani środowiska procesów (bez set -x/set -a, dane bucketu i adres alarmu przez curl -K).
// 4. Próba odtworzenia nigdy nie dotyka produkcji i nie zostawia jawnych danych: kontener z danymi w RAM (--tmpfs - obraz postgres ma
//    VOLUME), bez sieci i portów, usuwany z wolumenami; kopia odszyfrowywana strumieniem do pg_restore.
// 5. Alarm (obowiązkowy): ping po sukcesie, /fail po błędzie - także konfiguracji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
/** Kod bez komentarzy (komentarze mogą wymieniać zakazane konstrukcje), z połączonymi kontynuacjami `\`. */
const code = (text) =>
  text
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');

const backup = code(read('scripts/ops/db-backup.sh'));
const restore = code(read('scripts/ops/db-restore-check.sh'));
const role = read('docker/postgres-init/02-create-backup-role.sh');
const roleSql = code(role);

test('rola kopii: tylko odczyt, BYPASSRLS, bez superusera i bez hasła (logowanie tylko gniazdem w kontenerze)', () => {
  const attributes = 'LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;';
  assert.match(roleSql, new RegExp(`CREATE ROLE cyberszkolo_backup ${attributes}`));
  assert.match(roleSql, new RegExp(`ALTER ROLE cyberszkolo_backup WITH ${attributes}`));
  assert.match(roleSql, /GRANT pg_read_all_data TO cyberszkolo_backup;/);
  // Każdy atrybut uprzywilejowany tylko w wersji NO...; żadnych innych GRANT-ów ani zapisów.
  for (const attribute of ['SUPERUSER', 'CREATEDB', 'CREATEROLE', 'REPLICATION']) {
    assert.doesNotMatch(roleSql, new RegExp(`(?<!NO)\\b${attribute}\\b`), attribute);
  }
  assert.equal((roleSql.match(/\bGRANT\b/g) ?? []).length, 1, 'jedyny GRANT to pg_read_all_data');
  assert.doesNotMatch(roleSql, /pg_write_all_data|\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b|PASSWORD '/i);
});

test('db-backup.sh: pg_dump rolą kopii, kontrola zrzutu, szyfrowanie age kluczem publicznym przed wysyłką', () => {
  assert.match(backup, /^set -Eeuo pipefail/m);
  assert.match(backup, /pg_dump --username=cyberszkolo_backup --dbname=cyberszkolo --format=custom/);
  assert.match(backup, /--lock-wait-timeout=/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /TABLE DATA public organizations/);
  assert.match(backup, /age --recipient "\$BACKUP_AGE_RECIPIENT"/);
  assert.match(backup, /age1\*/, 'kontrola, że to klucz publiczny');
  assert.doesNotMatch(backup, /--identity|age --decrypt|age -d\b/, 'klucz prywatny nigdy na VPS');
  // Kolejność: zrzut -> szyfrowanie -> usunięcie zrzutu -> wysyłka (wysyłany jest WYŁĄCZNIE plik .age).
  const order = ['pg_dump', 'age --recipient', 'rm -f "$dump"', '--upload-file "$encrypted"'].map((needle) => backup.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `brak kroku: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'kroki w złej kolejności');
  assert.doesNotMatch(backup, /--upload-file "\$dump"|-T "\$dump"/);
  // Jawny zrzut po przerwanym biegu sprzątany na starcie następnego.
  assert.match(backup, /find \/var\/tmp -maxdepth 1 -type d -name 'unfooly-backup\.\*' -mmin \+120/);
});

test('db-backup.sh: sekrety poza logami, argumentami i środowiskiem procesów; plik konfiguracji 600; tylko odczyt bazy', () => {
  assert.doesNotMatch(backup, /set -x|set -o xtrace|bash -x|set -a\b|set -o allexport/);
  assert.doesNotMatch(backup, /(--user|-u)\s+"?\$/, 'dane bucketu nie w argumentach curl (widoczne w ps)');
  assert.doesNotMatch(backup, /curl[^\n|]*"\$\{?BACKUP_HEALTHCHECK_URL/, 'adres alarmu nie w argumentach curl');
  assert.match(backup, /\| curl [^\n]*-K -/);
  assert.match(backup, /umask 077/);
  assert.match(backup, /--config "\$curl_config"/);
  assert.match(backup, /600 \| 400\)/);
  assert.doesNotMatch(backup, /(echo|log)[^\n]*\$\{?BACKUP_(S3_SECRET|S3_ACCESS|HEALTHCHECK)/);
  // Jedyne zapytanie psql to rozmiar bazy (kontrola miejsca); poza tym tylko pg_dump i odczyt listy zrzutu.
  const queries = backup.match(/psql[^\n]*/g) ?? [];
  assert.equal(queries.length, 1);
  for (const psql of queries) assert.match(psql, /-c 'SELECT pg_database_size\(current_database\(\)\)'\)"$/);
  assert.doesNotMatch(backup, /DROP|--clean|pg_restore (?!--list)/);
  assert.match(backup, /trap cleanup EXIT/);
  assert.match(backup, /mktemp -d/);
});

test('db-backup.sh: alarm obowiązkowy - ping po sukcesie, /fail po błędzie wykonania (ERR) i konfiguracji', () => {
  assert.match(backup, /trap 'on_error \$LINENO' ERR/);
  assert.match(backup, /on_error\(\) \{[^}]*ping_healthcheck \/fail/);
  assert.match(backup, /config_error\(\) \{[^}]*ping_healthcheck \/fail[^}]*exit 2/);
  assert.match(backup, /\[ -n "\$\{BACKUP_HEALTHCHECK_URL:-\}" \] \|\| config_error/);
  assert.match(backup, /ping_healthcheck ""\nlog "OK/);
  // Rozmiar pliku w osobnym przypisaniu - podstawienie w argumencie log, które zawiedzie, wysłałoby /fail z podpowłoki przy sukcesie.
  assert.doesNotMatch(backup, /log "[^"\n]*\$\(/);
});

test('db-restore-check.sh: dane tylko w RAM, bez sieci i portów, usuwany z wolumenami; nigdy baza produkcyjna', () => {
  const run = restore.match(/docker run [^\n]*/)?.[0] ?? '';
  assert.match(run, /--tmpfs \/var\/lib\/postgresql\/data/, 'obraz postgres ma VOLUME - bez tmpfs zostaje anonimowy wolumen z jawną bazą');
  assert.match(run, /--network none/);
  assert.match(run, /"\$PG_IMAGE"/);
  assert.doesNotMatch(run, /\s-v\s|--volume|--mount|\s-p\s|--publish/);
  assert.match(restore, /docker rm -f -v "\$container"/);
  assert.match(restore, /pg_isready -h 127\.0\.0\.1/, 'gotowość przez TCP - przez gniazdo odpowiada już serwer tymczasowy initdb');
  // Odszyfrowanie strumieniem do pg_restore - jawny zrzut nie trafia na dysk.
  assert.match(restore, /age --decrypt --identity "\$BACKUP_AGE_IDENTITY" "\$encrypted"\s+\| docker exec -i "\$container" pg_restore/);
  assert.doesNotMatch(restore, /age --decrypt[^|\n]*--output/);
  assert.doesNotMatch(restore, /docker compose|docker-compose|\.env\.prod|cyberszkolo_app|--dbname=cyberszkolo\b/, 'nic ze stacku produkcyjnego');
  assert.match(restore, /pg_restore --username=postgres --dbname=restore_check --no-owner --no-privileges --exit-on-error/);
  assert.doesNotMatch(restore, /set -x|set -a\b|(--user|-u)\s+"?\$/);
  assert.match(restore, /trap cleanup EXIT/);
});

test('próba odtworzenia używa tego samego obrazu postgres co produkcja (pg_restore starszej wersji nie czyta nowszego zrzutu)', () => {
  const compose = read('docker-compose.prod.yml');
  const production = compose.match(/^ {2}postgres:\n {4}image: (\S+)/m)?.[1];
  assert.ok(production, 'usługa postgres w docker-compose.prod.yml');
  assert.equal(restore.match(/^PG_IMAGE="([^"]+)"/m)?.[1], production);
});
