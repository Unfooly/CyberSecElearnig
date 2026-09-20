// Testy hooka pre-push (node --test .githooks/pre-push.test.js; w CI: job `test`). Hook czyta z stdin linie
// "<local ref> <local sha> <remote ref> <remote sha>" tak jak Git i musi odrzucać push na refs/heads/main.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HOOK = path.join(__dirname, 'pre-push');
const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);

const line = (localRef, remoteRef, localSha = SHA, remoteSha = ZERO) => `${localRef} ${localSha} ${remoteRef} ${remoteSha}\n`;

function runHook(stdin) {
  // Git wywołuje hook z argumentami: <nazwa remote> <url>.
  const result = spawnSync('sh', [HOOK, 'origin', 'https://github.com/Unfooly/CyberSecElearnig.git'], { input: stdin, encoding: 'utf8' });
  assert.ifError(result.error); // brak `sh` w PATH to błąd środowiska, nie wynik hooka
  return result;
}

test('push na refs/heads/main jest odrzucony (kod 1) z komunikatem odsyłającym do zasad w CLAUDE.md', () => {
  const result = runHook(line('refs/heads/main', 'refs/heads/main'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ODRZUCONO PUSH NA main/);
  assert.match(result.stderr, /CLAUDE\.md/);
  assert.match(result.stderr, /Praca zespołowa: branże i pull requesty/);
  assert.equal(result.stdout, '');
});

test('push z innej gałęzi lokalnej NA zdalne main też jest odrzucony (liczy się docelowy ref)', () => {
  assert.equal(runHook(line('refs/heads/feat/x', 'refs/heads/main')).status, 1);
  assert.equal(runHook(line('HEAD', 'refs/heads/main')).status, 1);
});

test('usunięcie zdalnej gałęzi main (git push origin :main) jest odrzucone', () => {
  assert.equal(runHook(line('(delete)', 'refs/heads/main', ZERO, SHA)).status, 1);
});

test('force-push na main jest odrzucony (hook nie zna trybu, blokuje docelowy ref)', () => {
  assert.equal(runHook(line('refs/heads/main', 'refs/heads/main', SHA, 'b'.repeat(40))).status, 1);
});

test('kilka refów w jednym pushu, z których jeden to main: odrzucone w całości', () => {
  const input = line('refs/heads/feat/x', 'refs/heads/feat/x') + line('refs/heads/main', 'refs/heads/main') + line('refs/heads/y', 'refs/heads/y');

  assert.equal(runHook(input).status, 1);
});

test('push na inne gałęzie przechodzi (kod 0, cisza)', () => {
  for (const ref of ['refs/heads/chore/pre-push-hook', 'refs/heads/feat/142-import-csv', 'refs/heads/main-old', 'refs/heads/mainline', 'refs/heads/feature/main', 'refs/heads/Main']) {
    const result = runHook(line(ref, ref));

    assert.equal(result.status, 0, ref);
    assert.equal(result.stderr, '', ref);
  }
});

test('tagi i inne refy przechodzą (tag o nazwie main nie jest gałęzią main)', () => {
  assert.equal(runHook(line('refs/tags/v1.0.0', 'refs/tags/v1.0.0')).status, 0);
  assert.equal(runHook(line('refs/tags/main', 'refs/tags/main')).status, 0);
});

test('pusty push (brak refów na stdin) przechodzi', () => {
  assert.equal(runHook('').status, 0);
});

test('końce linii CRLF w stdin (Windows) nie omijają blokady: CR trafia do ostatniego pola (remote sha), remote ref zostaje czysty', () => {
  const result = runHook(`refs/heads/main ${SHA} refs/heads/main ${ZERO}\r\n`);

  assert.equal(result.status, 1);
});

test('hook ma tryb 100755 w INDEKSIE Gita (bez bitu wykonywalnego Linux/macOS po cichu ignoruje hook; Windows tego nie sprawdza)', (t) => {
  const result = spawnSync('git', ['ls-files', '-s', '--', HOOK], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || result.stdout.trim() === '') {
    t.skip('brak repozytorium git albo git w PATH (np. testy na rozpakowanych źródłach)');
    return;
  }

  assert.match(result.stdout, /^100755 /, 'ustaw: git update-index --chmod=+x .githooks/pre-push (core.fileMode=false na Windows nie zapisze bitu przy git add)');
});

test('hook ma końce linii LF i shebang sh (działa w Git Bash i na Linuksie)', () => {
  const content = fs.readFileSync(HOOK, 'utf8');

  assert.ok(content.startsWith('#!/bin/sh\n'));
  assert.ok(!content.includes('\r'), 'plik hooka nie może mieć CR (sh odrzuciłby go błędem składni); .gitattributes wymusza eol=lf');
});
