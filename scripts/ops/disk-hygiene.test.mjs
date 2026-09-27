// Higiena dysku VPS (chore/disk-hygiene, docs/ops/DISK.md) - uruchamiany w CI (build-images.yml, "lint + testy"):
//   node --test scripts/ops/disk-hygiene.test.mjs
// 1. Żaden skrypt w scripts/ops nie czyści wolumenów Dockera (baza produkcyjna bez backupu w postgres_data).
// 2. Sprzątanie robi dokładnie to, co w runbooku (obrazy i cache buildera > 7 dni, journald do 200 MB).
// 3. Raport jest tylko do odczytu (bez prune/rm/vacuum).
// 4. Każda usługa w docker-compose.prod.yml ma rotację logów (json-file, 10m x 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
// CRLF -> LF: na Windows (core.autocrlf) pliki w drzewie roboczym mają \r\n.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
/**
 * Linie skryptu bez komentarzy (komentarze mogą - i powinny - wymieniać zakazane polecenia), z połączonymi kontynuacjami `\`.
 * Uproszczenie: `#` po spacji tnie też wewnątrz napisu - w najgorszym razie fałszywie negatywny wynik w napisie.
 */
const code = (text) =>
  text
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');

// Wzorce czyszczenia wolumenów: --volumes (także w docker system prune), docker volume prune/rm, docker system prune, `down -v`
// (także przez zmienną z poleceniem - dlatego bez wymogu "docker compose" przed `down`), ręczne kasowanie /var/lib/docker.
// To bariera przed pomyłką, nie sandbox: polecenie złożone ze zmiennych w inny sposób może przejść niezauważone.
export const VOLUME_WIPE = [
  /--volumes\b/,
  /\bdocker\s+volume\s+(prune|rm)\b/,
  /\bdocker\s+system\s+prune\b/,
  /\bdown\b[^\n]*\s-(v\b|[a-z]*v[a-z]*\b)/,
  /\brm\b[^\n]*\/var\/lib\/docker\b/,
];
export function wipesVolumes(script) {
  const body = code(script);
  return VOLUME_WIPE.some((pattern) => pattern.test(body));
}

const opsScripts = readdirSync(here).filter((name) => name.endsWith('.sh'));

test('wzorce łapią czyszczenie wolumenów (i nie łapią dozwolonych poleceń)', () => {
  for (const bad of [
    'docker system prune -af --volumes',
    'docker volume prune -f',
    'docker volume rm unfooly_postgres_data',
    'docker system prune -af',
    'docker compose -f docker-compose.prod.yml down -v',
    'docker-compose down --volumes',
    'docker system \\\n  prune -af',
    'DC="docker compose"; $DC down -v',
    'sudo rm -rf /var/lib/docker/volumes/unfooly_postgres_data',
    'docker compose down -tv 5',
  ]) {
    assert.equal(wipesVolumes(bad), true, bad);
  }
  for (const ok of ['docker image prune -af --filter "until=168h"', 'docker builder prune -af --filter "until=168h"', '# docker volume prune - ZAKAZ']) {
    assert.equal(wipesVolumes(ok), false, ok);
  }
});

test('żaden skrypt w scripts/ops nie czyści wolumenów Dockera', () => {
  assert.ok(opsScripts.length >= 2, 'brak skryptów w scripts/ops');
  for (const name of opsScripts) {
    assert.equal(wipesVolumes(read(join(here, name))), false, `${name} czyści wolumeny - zakazane (baza bez backupu)`);
  }
});

test('disk-cleanup.sh: obrazy i cache buildera starsze niż 7 dni, journald do 200 MB', () => {
  const body = code(read(join(here, 'disk-cleanup.sh')));
  assert.match(body, /docker image prune -af --filter "until=168h"/);
  assert.match(body, /docker builder prune -af --filter "until=168h"/);
  assert.match(body, /journalctl --vacuum-size=200M/);
  assert.match(body, /set -euo pipefail/);
});

test('disk-report.sh jest tylko do odczytu', () => {
  // Przekierowanie do /dev/null (wyciszenie błędów) to nie zapis - poza tym żadnych przekierowań do plików.
  const body = code(read(join(here, 'disk-report.sh'))).replace(/2>\/dev\/null/g, '');
  assert.doesNotMatch(body, /\bprune\b|\brm\s|--vacuum|\btruncate\b|>>?\s*[/\w]|\bkill\b/);
  for (const expected of [/df -h \//, /docker system df/, /sudo journalctl --disk-usage/, /LogPath/]) assert.match(body, expected);
});

test('docker-compose.prod.yml: każda usługa ma rotację logów json-file 10m x 3', () => {
  const compose = read(join(root, 'docker-compose.prod.yml'));
  assert.match(compose, /x-logging: &default-logging\n\s+driver: json-file\n\s+options:\n\s+max-size: "10m"\n\s+max-file: "3"/);
  // Od `services:` do sekcji `volumes:` (w środku są komentarze w kolumnie 0, więc nie tniemy po pierwszej niewciętej linii).
  const services = compose.split(/^services:\n/m)[1].split(/^volumes:\s*$/m)[0];
  // Każda linia z nazwą usługi (wcięcie 2, dowolna nazwa) to osobny blok - liczba bloków = liczba usług.
  const names = [...services.matchAll(/^ {2}([^\s#][^:\s]*):\s*$/gm)].map((match) => match[1]);
  const blocks = services.split(/^ {2}(?=[^\s#][^:\s]*:\s*$)/m).slice(1);
  assert.ok(names.length >= 6, `za mało usług (${names.length})`);
  assert.equal(blocks.length, names.length);
  blocks.forEach((block, index) => {
    assert.match(block, /\n {4}logging: \*default-logging\n/, `usługa ${names[index]} bez rotacji logów`);
  });
  assert.equal((services.match(/^ {4}logging: \*default-logging$/gm) ?? []).length, names.length, 'liczba usług != liczba rotacji logów');
});
