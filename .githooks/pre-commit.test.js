// Testy hooka pre-commit (node --test .githooks/pre-commit.test.js; w CI: job `test`). Hook przekazuje gitleaksowi (`gitleaks stdin`)
// wyłącznie linie dodawane w commicie i odrzuca commit, gdy gitleaks coś znajdzie albo nie da się go uruchomić (fail-closed).
// Prawdziwy gitleaks i Docker są zastąpione atrapami na początku PATH; repozytorium to katalog tymczasowy.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'pre-commit');
const MARKER = 'PODEJRZANY_SEKRET_TESTOWY';

// Atrapa gitleaks: zapisuje argumenty i wejście do STUB_LOG, "znajduje" sekret, gdy wejście zawiera MARKER.
const GITLEAKS_STUB = `#!/bin/sh
input=$(cat)
{ printf 'ARGS %s\\n' "$*"; printf '%s\\n' "$input"; } > "$STUB_LOG"
case "$input" in *${MARKER}*) echo 'Finding: REDACTED' >&2; exit 1;; esac
exit 0
`;

// Atrapa docker: \`docker info\` kończy się kodem DOCKER_INFO_STATUS, \`docker run\` zachowuje się jak atrapa gitleaks.
const DOCKER_STUB = `#!/bin/sh
case "$1" in
  info) exit "\${DOCKER_INFO_STATUS:-0}";;
  run)
    input=$(cat)
    { printf 'ARGS %s\\n' "$*"; printf '%s\\n' "$input"; } > "$STUB_LOG"
    case "$input" in *${MARKER}*) exit 1;; esac
    exit 0;;
esac
exit 2
`;

// Uruchamia hook z katalogiem atrap na początku PATH. Przy RESTRICT PATH = atrapy + katalogi git i grep (bez prawdziwego gitleaks/dockera);
// kod 98 = prawdziwy gitleaks/docker leży w tych katalogach, więc scenariusza "brak narzędzi" nie da się tu odtworzyć.
const RUNNER = [
  'sh_bin=$(command -v sh)',
  'stubs=$(cd "$1" && pwd) || exit 97',
  'if [ -n "$RESTRICT" ]; then',
  '  PATH="$stubs:$(dirname "$(command -v git)"):$(dirname "$(command -v grep)")"',
  '  for tool in gitleaks docker; do p=$(command -v "$tool"); case "$p" in ""|"$stubs"/*) ;; *) exit 98;; esac; done',
  'else',
  '  PATH="$stubs:$PATH"',
  'fi',
  'export PATH',
  'exec "$sh_bin" "$2"',
].join('\n');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

// Repozytorium z zacommitowanym plikiem `app.env` (linia kontekstu i linia do usunięcia) i ze zmianą w indeksie.
function repoWithStaged(t, newContent) {
  const repo = tmpDir(t, 'pre-commit-repo-');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'app.env'), 'KONTEKST=bez-zmian\nUSUWANA=stara-wartosc\n');
  git(repo, 'add', 'app.env');
  git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'app.env'), newContent);
  git(repo, 'add', 'app.env');
  return repo;
}

function stubsDir(t, { gitleaks = false, docker = false } = {}) {
  const dir = tmpDir(t, 'pre-commit-stubs-');
  if (gitleaks) fs.writeFileSync(path.join(dir, 'gitleaks'), GITLEAKS_STUB, { mode: 0o755 });
  if (docker) fs.writeFileSync(path.join(dir, 'docker'), DOCKER_STUB, { mode: 0o755 });
  return dir;
}

function runHook(t, repo, stubs, env = {}) {
  const log = path.join(tmpDir(t, 'pre-commit-log-'), 'stub.log').replace(/\\/g, '/');
  const result = spawnSync('sh', ['-c', RUNNER, 'runner', stubs, HOOK.replace(/\\/g, '/')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, STUB_LOG: log, ...env },
  });
  assert.ifError(result.error); // brak `sh` w PATH to błąd środowiska, nie wynik hooka
  assert.notEqual(result.status, 97, 'runner nie znalazł katalogu atrap');
  const stubLog = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null;
  return { ...result, stubLog };
}

test('czyste zmiany przechodzą; gitleaks dostaje tylko linie dodawane (bez kontekstu i usuniętych), z --redact i konfiguracją repo', (t) => {
  const repo = repoWithStaged(t, 'KONTEKST=bez-zmian\nNOWA=wartosc-jawna\n');
  const result = runHook(t, repo, stubsDir(t, { gitleaks: true }));

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stubLog, 'hook nie wywołał gitleaks');
  assert.match(result.stubLog, /^ARGS stdin --redact /);
  assert.match(result.stubLog, /NOWA=wartosc-jawna/);
  assert.doesNotMatch(result.stubLog, /KONTEKST=bez-zmian/);
  assert.doesNotMatch(result.stubLog, /USUWANA=stara-wartosc/);
  assert.doesNotMatch(result.stubLog, /^\+\+\+ /m);
});

test('sekret w dodawanej linii: commit odrzucony (kod 1) z komunikatem o zasadzie i o gitleaks:allow', (t) => {
  const repo = repoWithStaged(t, `KONTEKST=bez-zmian\nTOKEN=${MARKER}\n`);
  const result = runHook(t, repo, stubsDir(t, { gitleaks: true }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ODRZUCONO COMMIT/);
  assert.match(result.stderr, /gitleaks:allow/);
  assert.match(result.stderr, /do-rotacji\.md/);
});

test('sekret tylko w linii USUWANEJ nie blokuje commitu (usuwanie sekretu ma przejść)', (t) => {
  const repo = tmpDir(t, 'pre-commit-repo-');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'app.env'), `A=1\nTOKEN=${MARKER}\n`);
  git(repo, 'add', 'app.env');
  git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'app.env'), 'A=1\n');
  git(repo, 'add', 'app.env');

  const result = runHook(t, repo, stubsDir(t, { gitleaks: true }));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stubLog, null, 'bez dodanych linii gitleaks nie jest potrzebny');
});

test('bez gitleaks w PATH hook używa obrazu Docker (przypiętego) i też odrzuca sekret', (t) => {
  const repo = repoWithStaged(t, `TOKEN=${MARKER}\n`);
  const result = runHook(t, repo, stubsDir(t, { docker: true }), { RESTRICT: '1' });
  if (result.status === 98) return t.skip('prawdziwy gitleaks/docker w katalogu git/grep');

  assert.equal(result.status, 1);
  assert.match(result.stubLog, /^ARGS run --rm -i .*zricethezav\/gitleaks:v\d+\.\d+\.\d+ stdin --redact /);
  assert.match(result.stderr, /ODRZUCONO COMMIT: gitleaks \(Docker\)/);
});

test('bez gitleaks, z działającym Dockerem: czyste zmiany przechodzą', (t) => {
  const repo = repoWithStaged(t, 'NOWA=wartosc-jawna\n');
  const result = runHook(t, repo, stubsDir(t, { docker: true }), { RESTRICT: '1' });
  if (result.status === 98) return t.skip('prawdziwy gitleaks/docker w katalogu git/grep');

  assert.equal(result.status, 0, result.stderr);
});

test('brak gitleaks i niedziałający Docker: commit odrzucony (fail-closed) z instrukcją instalacji', (t) => {
  const repo = repoWithStaged(t, 'NOWA=wartosc-jawna\n');
  const result = runHook(t, repo, stubsDir(t, { docker: true }), { RESTRICT: '1', DOCKER_INFO_STATUS: '1' });
  if (result.status === 98) return t.skip('prawdziwy gitleaks/docker w katalogu git/grep');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /brak gitleaks i Dockera/);
  assert.match(result.stderr, /winget install gitleaks/);
});

test('brak gitleaks i brak Dockera w PATH: commit odrzucony (fail-closed)', (t) => {
  const repo = repoWithStaged(t, 'NOWA=wartosc-jawna\n');
  const result = runHook(t, repo, stubsDir(t), { RESTRICT: '1' });
  if (result.status === 98) return t.skip('prawdziwy gitleaks/docker w katalogu git/grep');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /brak gitleaks i Dockera/);
});

test('hook ma tryb 100755 w INDEKSIE Gita (bez bitu wykonywalnego Linux/macOS po cichu ignoruje hook; Windows tego nie sprawdza)', (t) => {
  const result = spawnSync('git', ['ls-files', '-s', '--', HOOK], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || result.stdout.trim() === '') {
    t.skip('brak repozytorium git albo git w PATH (np. testy na rozpakowanych źródłach)');
    return;
  }

  assert.match(result.stdout, /^100755 /, 'ustaw: git update-index --chmod=+x .githooks/pre-commit');
});

test('hook ma końce linii LF i shebang sh (działa w Git Bash i na Linuksie)', () => {
  const content = fs.readFileSync(HOOK, 'utf8');

  assert.ok(content.startsWith('#!/bin/sh\n'));
  assert.ok(!content.includes('\r'), 'plik hooka nie może mieć CR (sh odrzuciłby go błędem składni); .gitattributes wymusza eol=lf');
});

test('konfiguracja .gitleaks.toml rozszerza reguły domyślne (nie zastępuje ich pustym zestawem)', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', '.gitleaks.toml'), 'utf8');

  assert.match(config, /\[extend\]\s*\nuseDefault = true/);
});
