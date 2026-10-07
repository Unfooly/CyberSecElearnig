// Kopia zapasowa bazy (B-117, D-136, docs/ops/BACKUP.md) - uruchamiany w CI (build-images.yml, "lint + testy"):
//   node --test scripts/ops/db-backup.test.mjs
// Statyczne gwarancje skryptów (odtworzenie na prawdziwych danych sprawdza ręcznie db-restore-check.sh - runbook):
// 1. Kopia tylko czyta: rola cyberszkolo_backup bez superusera, bez hasła, tylko pg_read_all_data; pg_dump tą rolą.
// 2. Kopia nie opuszcza VPS niezaszyfrowana: age kluczem publicznym przed wysyłką, zrzut kasowany, klucz prywatny nigdy na VPS.
// 3. Sekrety nie trafiają do logów ani argumentów procesów (bez set -x, dane bucketu przez plik konfiguracyjny curl).
// 4. Próba odtworzenia nigdy nie dotyka produkcji: jednorazowy kontener bez wolumenu i portów, usuwany na końcu.
// 5. Alarm: ping po sukcesie i /fail po błędzie.
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

test('rola kopii: tylko odczyt, BYPASSRLS, bez superusera i bez hasła (logowanie tylko gniazdem w kontenerze)', () => {
  assert.match(role, /CREATE ROLE cyberszkolo_backup LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;/);
  assert.match(role, /ALTER ROLE cyberszkolo_backup WITH LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;/);
  assert.match(role, /GRANT pg_read_all_data TO cyberszkolo_backup;/);
  assert.doesNotMatch(role, /pg_write_all_data|GRANT ALL|SUPERUSER(?<!NOSUPERUSER)\b/);
  assert.doesNotMatch(code(role), /(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

test('db-backup.sh: pg_dump rolą kopii, kontrola zrzutu, szyfrowanie age kluczem publicznym przed wysyłką', () => {
  assert.match(backup, /^set -Eeuo pipefail/m);
  assert.match(backup, /pg_dump --username=cyberszkolo_backup --dbname=cyberszkolo --format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /TABLE DATA public organizations/);
  assert.match(backup, /age --recipient "\$BACKUP_AGE_RECIPIENT"/);
  assert.match(backup, /age1\*/, 'kontrola, że to klucz publiczny');
  assert.doesNotMatch(backup, /--identity|-i\s+\S*key|age --decrypt|age -d/, 'klucz prywatny nigdy na VPS');
  // Kolejność: zrzut -> szyfrowanie -> usunięcie zrzutu -> wysyłka (wysyłany jest WYŁĄCZNIE plik .age).
  const order = ['pg_dump', 'age --recipient', 'rm -f "$dump"', '--upload-file "$encrypted"'].map((needle) => backup.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `brak kroku: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'kroki w złej kolejności');
  assert.doesNotMatch(backup, /--upload-file "\$dump"|-T "\$dump"/);
});

test('db-backup.sh: sekrety poza logami i argumentami procesów; plik konfiguracji 600; tylko odczyt bazy', () => {
  assert.doesNotMatch(backup, /set -x|set -o xtrace|bash -x/);
  assert.doesNotMatch(backup, /--user\s+"\$/, 'dane bucketu nie w argumentach curl (widoczne w ps)');
  assert.match(backup, /umask 077/);
  assert.match(backup, /--config "\$curl_config"/);
  assert.match(backup, /600 \| 400\)/);
  assert.doesNotMatch(backup, /echo[^\n]*\$BACKUP_S3_(SECRET|ACCESS)|log[^\n]*\$BACKUP_S3_(SECRET|ACCESS)/);
  assert.doesNotMatch(backup, /psql|DROP|--clean|pg_restore (?!--list)/, 'kopia nie wykonuje niczego na bazie poza pg_dump i odczytem listy');
  assert.match(backup, /trap cleanup EXIT/);
  assert.match(backup, /mktemp -d/);
});

test('db-backup.sh: alarm - ping po sukcesie, /fail po błędzie (pułapka ERR)', () => {
  assert.match(backup, /trap 'on_error \$LINENO' ERR/);
  assert.match(backup, /ping_healthcheck \/fail/);
  assert.match(backup, /ping_healthcheck ""\nlog "OK/);
});

test('db-restore-check.sh: jednorazowy kontener bez wolumenu i portów, nigdy baza produkcyjna', () => {
  const run = restore.match(/docker run [^\n]*/)?.[0] ?? '';
  assert.match(run, /postgres:16-alpine/);
  assert.doesNotMatch(run, /\s-v\s|--volume|--mount|\s-p\s|--publish|--network/);
  assert.match(restore, /docker rm -f "\$container"/);
  assert.doesNotMatch(restore, /docker compose|docker-compose|\.env\.prod|cyberszkolo_app|--dbname=cyberszkolo\b/, 'nic ze stacku produkcyjnego');
  assert.match(restore, /pg_restore --username=postgres --dbname=restore_check --no-owner --no-privileges --exit-on-error/);
  assert.doesNotMatch(restore, /set -x|--user\s+"\$/);
  assert.match(restore, /trap cleanup EXIT/);
});
