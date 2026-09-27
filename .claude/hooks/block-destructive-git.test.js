// Testy hooka block-destructive-git.js (node --test .claude/hooks/block-destructive-git.test.js; w CI: job `test`).
// Wszystko na tekście poleceń, atrapie "aktualnej gałęzi" i TYMCZASOWYM repozytorium w katalogu tymczasowym (reguła 11: nigdy prawdziwy origin).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkCommand } = require('./block-destructive-git');

const onMain = { currentBranch: () => 'main' };
const onFeature = { currentBranch: () => 'chore/git-safety' };

const BLOCKED = [
  // git push: wymuszenia
  'git push --force',
  'git push -f',
  'git push origin main -f',
  'git push -fu origin feature/x',
  'git push --force-with-lease origin feature/x',
  'git push --force-with-lease=main:abc123 origin feature/x',
  'git push --force-if-includes origin feature/x',
  // git push: usuwanie refów (w tym --dry-run: hook odrzuca zanim polecenie dotrze do gita)
  'git push --delete origin feature/x',
  'git push -d origin feature/x',
  'git push origin :main',
  'git push origin :main --dry-run',
  'git push --dry-run origin :main',
  'git push origin ":main"',
  "git push origin ':feature/x'",
  'git push :main',
  'git push origin :refs/heads/main',
  'git push --mirror',
  'git push --mirror origin',
  'git push --all',
  'git push --prune origin',
  'git push origin +main:main',
  'git push origin +HEAD',
  // git push NA main (zmiany na main tylko przez PR)
  'git push origin main',
  'git push origin HEAD:main',
  'git push origin HEAD:refs/heads/main',
  'git push origin feature/x:main',
  'git push origin refs/heads/main:refs/heads/main',
  'git push origin main:main',
  'git push -u origin master',
  // opcje globalne, wrappery, łańcuchy poleceń
  'git -C /tmp/x push --force',
  'git -c core.editor=true push -f',
  'git -C "C:\\Users\\x y\\repo" push --force',
  'git.exe push -f',
  '/usr/bin/git push -f',
  'cd repo && git push --force',
  'echo hi; git push --force',
  'git status || git push -f',
  'git fetch\ngit push origin :main',
  'sudo git push -f',
  'env GIT_TRACE=1 git push -f',
  'GIT_SSH_COMMAND=ssh git push --force',
  'echo x | xargs git push -f',
  'bash -c "git push --force"',
  "sh -c 'git push origin :main'",
  'bash -lc "cd repo && git push -f"',
  'pwsh -Command "git push --force"',
  'powershell -Command "git push origin :main"',
  'cmd /c "git push -f"',
  'eval "git push -f"',
  // git branch
  'git branch -D feature/x',
  'git branch -D main',
  'git branch -d -f feature/x',
  'git branch -df feature/x',
  'git branch --delete --force feature/x',
  'git branch -d main',
  'git branch --delete master',
  'git branch -m main old-main',
  'git branch -M main',
  'git branch -f main HEAD~3',
  // git reset --hard (zawsze)
  'git reset --hard',
  'git reset --hard origin/main',
  'git reset --hard HEAD~1',
  'git reset HEAD~1 --hard',
  'git -C /tmp/x reset --hard',
  // git clean
  'git clean -f',
  'git clean -fd',
  'git clean -xdf',
  'git clean --force',
  'git clean -n -f',
  // odrzucanie zmian w całym drzewie
  'git checkout -- .',
  'git checkout .',
  'git checkout HEAD -- .',
  'git checkout main -- .',
  'git checkout -f',
  'git checkout --force main',
  'git restore .',
  'git restore -- .',
  'git restore --worktree .',
  'git restore --staged --worktree .',
  'git restore -s HEAD .',
  'git switch -f main',
  'git switch --discard-changes main',
  // rebase main (jawnie rebasowana gałąź = main)
  'git rebase origin/main main',
  'git rebase main main',
  // gh: niszczące na origin
  'gh repo delete Unfooly/CyberSecElearnig --yes',
  'gh release delete v1.0.0',
  'gh pr merge 2',
  'gh pr merge 2 --squash --delete-branch',
  'gh api -X DELETE repos/Unfooly/CyberSecElearnig/git/refs/heads/main',
  'gh api repos/Unfooly/CyberSecElearnig --method DELETE',
  'gh api --method=DELETE repos/Unfooly/CyberSecElearnig/git/refs/heads/x',
  'gh api -XDELETE repos/Unfooly/CyberSecElearnig/git/refs/heads/x',
  // obejścia z review: podstawienia, backticki, słowa kluczowe powłoki, wrappery z opcjami, xargs/find, skróty opcji, redirect bez spacji
  'echo $(git push -f)',
  '$(git push -f)',
  'echo "$(git push origin :main)"',
  'echo `git push --force`',
  'cat <(git push -f)',
  'if true; then git push -f; fi',
  'for b in a b; do git push origin :$b; done',
  'while git push -f; do :; done',
  '! git push -f',
  'env -i git push -f',
  'env -u FOO git push --force',
  'sudo -u root git push -f',
  'nice -n 10 git push -f',
  'timeout 10 git push -f',
  'time git push --force',
  'find . -maxdepth 1 -exec git push -f \\;',
  'echo x | xargs -I {} git push -f',
  'xargs -n 1 git push origin :main',
  'git reset --har',
  'git push --delet origin x',
  'git push --mirr',
  'git clean --forc',
  'git branch --delet --forc x',
  'git push --force>/dev/null',
  'git push origin :main 2>&1',
  'git push -f 2>/dev/null',
  // ścieżki Windows i PowerShell
  '& "C:\\Program Files\\Git\\cmd\\git.exe" push --force',
  '"C:\\Program Files\\Git\\cmd\\git.exe" push -f',
  'Start-Process git -ArgumentList "push","--force"',
  'Start-Process -FilePath git -ArgumentList "push origin :main"',
  'iex "git push -f"',
  'Invoke-Expression "git push origin :main"',
  'Invoke-Command -ScriptBlock { git push --force }',
  'pwsh -EncodedCommand ZwBpAHQAIABwAHUAcwBoACAALQBmAA==',
  // aliasy
  'git -c alias.p="push -f" p',
  'git -c alias.zap=clean\\ -fd zap',
  'git config alias.pf "push --force"',
  'git config --global alias.nuke "reset --hard"',
  // heredoc do powłoki i heredoc bez terminatora nie ukrywa reszty
  'bash <<EOF\ngit push -f\nEOF',
  'cat <<EOF | sh\ngit push origin :main\nEOF',
  'echo "<<X"\ngit push -f',
  'cat <<< foo\ngit push -f',
  // gh z opcją repo i mutacje refów
  'gh -R Unfooly/CyberSecElearnig pr merge 2',
  'gh --repo Unfooly/CyberSecElearnig pr merge 2',
  'gh pr --repo Unfooly/CyberSecElearnig merge 2',
  'gh -R x/y repo delete --yes',
  'gh api -X PATCH repos/Unfooly/CyberSecElearnig/git/refs/heads/main -f sha=abc -F force=true',
  'gh api -X PUT repos/Unfooly/CyberSecElearnig/branches/main/protection',
  // powłoki POSIX: klaster flag z -c (bash -ec), nie zakodowane base64
  'bash -ec "git push -f"',
  'sh -e -c "git reset --hard"',
  'bash -xc "git push origin :main"',
  // komentarz z apostrofem nie ukrywa kolejnej linii
  "echo ok # it's fine\ngit push -f",
  // heredoc z niecytowanym terminatorem: powłoka wykonuje $(...) z treści
  'cat <<EOF\n$(git push -f)\nEOF',
  'cat <<END-1\n`git reset --hard`\nEND-1',
];

const ALLOWED = [
  // komentarz z poleceniem w środku i heredoc z cytowanym terminatorem (treść literalna)
  'git status # git push -f',
  "cat <<'EOF'\n$(git push -f)\nEOF",
  'bash -c "git status"',
  'git status',
  'git log --oneline -5',
  'git diff HEAD~1',
  'git fetch',
  'git pull',
  'git add -A .',
  'git commit -m "docs: zakaz git push --force i git reset --hard"',
  "git commit -m 'Blokada: git push origin :main oraz git clean -fd'",
  "git commit -F - <<'EOF'\nOpis: hook odrzuca git push --force, git reset --hard i git push origin :main\nEOF",
  'echo "git push --force"',
  'grep -rn "reset --hard" docs/',
  // push nowych gałęzi i tagów
  'git push',
  'git push -u origin chore/git-safety',
  'git push --set-upstream origin ci/pull-request-checks',
  'git push origin feature/x-fix',
  'git push origin HEAD:feature/foo',
  'git push origin HEAD:refs/heads/feature/foo',
  'git push origin main:feature/z-maina',
  'git push --dry-run origin feature/x',
  'git push -o ci.skip origin feature/x',
  'git push origin v1.0.0',
  'git push --tags',
  // branch
  'git branch',
  'git branch -a',
  'git branch --show-current',
  'git branch --list main',
  'git branch -d feature/x',
  'git branch -m stara-nazwa nowa-nazwa',
  'git branch -u origin/feature/x',
  // reset, clean, checkout, restore, switch bezpieczne
  'git reset',
  'git reset HEAD plik.txt',
  'git reset --soft HEAD~1',
  'git reset --mixed HEAD~1',
  'git clean -n',
  'git clean -nd',
  'git clean -d --dry-run',
  'git checkout main',
  'git checkout -b feature/x',
  'git checkout -- apps/web/src/a.ts',
  'git checkout HEAD -- README.md',
  'git restore apps/web/src/a.ts',
  'git restore --staged .',
  'git restore -S .',
  'git switch main',
  'git switch -c feature/x',
  'git stash',
  'git merge origin/main',
  // gh bezpieczne
  'gh pr create --base main --head chore/x --title "x" --body "opis: nie używaj git push --force"',
  'gh pr view 2',
  'gh pr checks 2',
  'gh api repos/Unfooly/CyberSecElearnig/pulls',
  'gh api -X GET repos/Unfooly/CyberSecElearnig',
  'gh api -X POST repos/Unfooly/CyberSecElearnig/issues -f title=x',
  'gh release list',
  'gh repo view',
  'gh run list --branch chore/x',
  'gh issue create --title x --body y',
  // fałszywe blokady wykluczone: interaktywne tryby, doklejone wartości, kopie, podstawienia i słowa kluczowe bez niszczenia
  'git restore -p .',
  'git checkout -p -- .',
  'git push -o force origin feature/x',
  'git push -oforce origin feature/x',
  'git branch -c main kopia',
  'echo $(git status)',
  'echo `git rev-parse HEAD`',
  'if true; then git status; fi',
  'for b in a b; do git branch --list $b; done',
  'env -i git status',
  'sudo -u root git status',
  'timeout 10 git fetch',
  'find . -name x -exec git add {} \\;',
  'echo x | xargs -n 1 git add',
  'git push --follow-tags origin feature/x',
  'git status 2>&1',
  'git push origin feature/x 2>/dev/null',
  'git diff > /tmp/x.diff',
  'git config --get alias.co',
  'git config --list',
  'git config user.name "Test"',
  '& "C:\\Program Files\\Git\\cmd\\git.exe" status',
  'Start-Process git -ArgumentList "status"',
  'Invoke-Command -ScriptBlock { git status }',
  'gh -R Unfooly/CyberSecElearnig pr view 2',
  'gh -R Unfooly/CyberSecElearnig pr create --title x --body y',
  'gh api -X PATCH repos/Unfooly/CyberSecElearnig/issues/2 -f state=closed',
  // commit z opisem w heredocu wewnątrz podstawienia (jak w naszym workflow), także z apostrofami i nawiasami w treści
  'git commit -m "$(cat <<\'EOF\'\nOpis: hook odrzuca git push --force (nie git reset --hard) i git push origin :main\nEOF\n)"',
  'git commit -m "$(cat <<\'EOF\'\nNie ruszamy git push -f, bo don\'t (unbalanced\nEOF\n)"',
  'git commit -F - <<\'EOF\'\nOpis z git push --force\nEOF\ngit push -u origin chore/x',
  'echo "<<X"\ngit status',
  'bash script.sh',
  'git switch chore/x && git rebase origin/main',
  'git switch main && git switch -c chore/x && git rebase origin/main',
  'git checkout -b feature/x && git rebase origin/main',
  // Merge przez agenta wyłącznie skryptem sprawdzającym warunki (CLAUDE.md reguła 11); `gh pr merge` wprost zostaje zablokowane (BLOCKED).
  'node scripts/dev/safe-merge.mjs 58',
  'node scripts/dev/safe-merge.mjs 58 --dry-run',
];

for (const command of BLOCKED) {
  test(`blokuje: ${command.split('\n').join(' ⏎ ').slice(0, 110)}`, () => {
    // Na feature-branchu: reguły nie zależą od aktualnej gałęzi (poza rebase).
    const result = checkCommand(command, 'Bash', onFeature);
    assert.equal(result.blocked, true, `powinno być zablokowane: ${command}`);
    assert.ok(result.reason, 'blokada ma podawać powód');
  });
}

for (const command of ALLOWED) {
  test(`przepuszcza: ${command.split('\n').join(' ⏎ ').slice(0, 110)}`, () => {
    const result = checkCommand(command, 'Bash', onFeature);
    assert.equal(result.blocked, false, `nie powinno być zablokowane: ${command} (${result.reason})`);
  });
}

test('rebase: blokowany, gdy aktualna gałąź to main/master; dozwolony na własnym branchu roboczym (rebase origin/main to nasza droga aktualizacji)', () => {
  assert.equal(checkCommand('git rebase origin/feature', 'Bash', onMain).blocked, true);
  assert.equal(checkCommand('git rebase -i HEAD~3', 'Bash', onMain).blocked, true);
  assert.equal(checkCommand('git rebase', 'Bash', { currentBranch: () => 'master' }).blocked, true);
  assert.equal(checkCommand('git rebase origin/main', 'Bash', onFeature).blocked, false);
  assert.equal(checkCommand('git rebase main', 'Bash', onFeature).blocked, false);
  assert.equal(checkCommand('git rebase --abort', 'Bash', onMain).blocked, false);
  assert.equal(checkCommand('git rebase --continue', 'Bash', onMain).blocked, false);
  // nieznana gałąź (np. detached HEAD, brak repo): nie blokujemy z samego braku informacji
  assert.equal(checkCommand('git rebase origin/main', 'Bash', { currentBranch: () => null }).blocked, false);
});

test('rebase: śledzenie w obrębie polecenia (switch main && rebase), katalogu (-C, cd) i gałęzi roboczej', () => {
  assert.equal(checkCommand('git switch main && git rebase origin/x', 'Bash', onFeature).blocked, true);
  assert.equal(checkCommand('git checkout master; git rebase -i HEAD~2', 'Bash', onFeature).blocked, true);
  // -C / cd: aktualna gałąź pochodzi z KATALOGU, którego dotyczy polecenie
  const asked = [];
  const perDir = { currentBranch: (cwd) => (asked.push(cwd), cwd && cwd.endsWith('main-repo') ? 'main' : 'chore/x') };
  assert.equal(checkCommand('git -C ../main-repo rebase origin/x', 'Bash', perDir).blocked, true);
  assert.equal(checkCommand('git -C ../inne rebase origin/main', 'Bash', perDir).blocked, false);
  assert.equal(checkCommand('cd ../main-repo && git rebase origin/x', 'Bash', perDir).blocked, true);
  assert.ok(asked.length >= 3);
});

// Dokumentacja stanu: rzeczy, których hook STATYCZNIE nie wykryje (świadomie; patrz nagłówek block-destructive-git.js). Test pilnuje, żeby
// zmiana tego stanu (np. dodanie wykrywania) była decyzją, a nie przypadkiem.
const KNOWN_BYPASSES = [
  ['zmienna jako polecenie', 'g=git; $g push -f'],
  ['skrypt z pliku', 'bash ./skrypt-z-push.sh'],
  ['python -c', "python -c \"import subprocess; subprocess.run(['git','push','-f'])\""],
  ['node -e', "node -e \"require('child_process').execSync('git push -f')\""],
  ['alias zdefiniowany wcześniej w ~/.gitconfig', 'git pf'],
];
for (const [label, command] of KNOWN_BYPASSES) {
  test(`znane obejście (nie wykrywamy): ${label}`, () => {
    assert.equal(checkCommand(command, 'Bash', onFeature).blocked, false);
  });
}

test('PowerShell: te same reguły dla git i gh', () => {
  assert.equal(checkCommand('git push --force', 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand('git push origin :main; git status', 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand('git.exe reset --hard', 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand('gh repo delete x --yes', 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand('git status', 'PowerShell', onFeature).blocked, false);
});

test('PowerShell: backtick to ucieczka, nie podstawienie; -EncodedCommand dekodowany tylko dla PowerShella', () => {
  assert.equal(checkCommand('git push `\n --force', 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand('Write-Output "a `"git push -f`" b"', 'PowerShell', onFeature).blocked, false);
  const encoded = Buffer.from('git push -f', 'utf16le').toString('base64');
  assert.equal(checkCommand(`pwsh -EncodedCommand ${encoded}`, 'PowerShell', onFeature).blocked, true);
  assert.equal(checkCommand(`bash -e ${encoded}`, 'Bash', onFeature).blocked, false);
});

test('puste i nie-tekstowe wejście jest przepuszczane', () => {
  assert.equal(checkCommand('', 'Bash').blocked, false);
  assert.equal(checkCommand(undefined, 'Bash').blocked, false);
  assert.equal(checkCommand('   ', 'Bash').blocked, false);
});

const SCRIPT = path.join(__dirname, 'block-destructive-git.js');

function runHook(payload, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  return result;
}

test('proces: `git push origin :main --dry-run` => exit 2 i komunikat z regułą 11 (odrzucone ZANIM dotrze do gita)', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: 'git push origin :main --dry-run' } });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ODMOWA/);
  assert.match(result.stderr, /Reguła 11/);
  assert.match(result.stderr, /CLAUDE\.md/);
  assert.match(result.stderr, /--dry-run/);
  assert.equal(result.stdout, '');
});

test('proces: dozwolone polecenie => exit 0 bez komunikatu; inne narzędzia nie są sprawdzane', () => {
  const allowed = runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stderr, '');

  const other = runHook({ tool_name: 'Read', tool_input: { command: 'git push --force' } });
  assert.equal(other.status, 0);
});

test('proces: PowerShell tak samo jak Bash', () => {
  assert.equal(runHook({ tool_name: 'PowerShell', tool_input: { command: 'git push --force' } }).status, 2);
});

test('proces: uszkodzone wejście nie blokuje pracy (exit 0 z ostrzeżeniem)', () => {
  const result = runHook('to nie jest json');

  assert.equal(result.status, 0);
  assert.match(result.stderr, /przepuszczone/);
});

// Tymczasowe repozytorium z LOKALNYM "origin" (reguła 11: testy nigdy nie dotykają prawdziwego origin): aktualna gałąź z prawdziwego gita.
test('proces + tymczasowe repo: rebase blokowany na main, dozwolony na gałęzi roboczej (aktualna gałąź z `git rev-parse`)', (t) => {
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' });
  if (spawnSync('git', ['--version']).status !== 0) {
    t.skip('brak git w PATH');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-safety-'));
  try {
    const origin = path.join(tmp, 'origin.git');
    const work = path.join(tmp, 'work');
    assert.equal(git(tmp, 'init', '--bare', '-b', 'main', origin).status, 0);
    assert.equal(git(tmp, 'init', '-b', 'main', work).status, 0);
    fs.writeFileSync(path.join(work, 'a.txt'), 'a');
    assert.equal(git(work, 'add', 'a.txt').status, 0);
    assert.equal(git(work, 'commit', '-m', 'init').status, 0);
    assert.equal(git(work, 'remote', 'add', 'origin', origin).status, 0);

    const onMainResult = runHook({ tool_name: 'Bash', tool_input: { command: 'git rebase origin/main' } }, { CLAUDE_PROJECT_DIR: work });
    assert.equal(onMainResult.status, 2, onMainResult.stderr);
    assert.match(onMainResult.stderr, /rebase/);

    assert.equal(git(work, 'switch', '-c', 'chore/robocza').status, 0);
    const onFeatureResult = runHook({ tool_name: 'Bash', tool_input: { command: 'git rebase origin/main' } }, { CLAUDE_PROJECT_DIR: work });
    assert.equal(onFeatureResult.status, 0, onFeatureResult.stderr);

    // `git -C <katalog>` i `cd`: aktualna gałąź pochodzi z prawdziwego gita w TYM katalogu (work jest teraz na gałęzi roboczej).
    const inOtherMain = path.join(tmp, 'main-repo');
    assert.equal(git(tmp, 'init', '-b', 'main', inOtherMain).status, 0);
    const viaC = runHook({ tool_name: 'Bash', tool_input: { command: `git -C "${inOtherMain}" rebase origin/x` } }, { CLAUDE_PROJECT_DIR: work });
    assert.equal(viaC.status, 2, viaC.stderr);
    const viaCd = runHook({ tool_name: 'Bash', tool_input: { command: `cd "${inOtherMain}" && git rebase origin/x` } }, { CLAUDE_PROJECT_DIR: work });
    assert.equal(viaCd.status, 2, viaCd.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
