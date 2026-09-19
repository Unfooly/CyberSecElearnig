// Testy hooka block-file-writes.js (node --test .claude/hooks/block-file-writes.test.js; w CI: job `test`).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkCommand } = require('./block-file-writes');

const BLOCKED = [
  // sed / perl w miejscu
  "sed -i 's/a/b/' apps/api/src/x.ts",
  "sed -i.bak 's/a/b/' file.txt",
  "sed -Ei 's/a+/b/' file.txt",
  "sed --in-place 's/a/b/' file.txt",
  "sed -n -i '1d' file.txt",
  "cd apps/web/src && sed -i 's#a#b#' app/page.tsx",
  "cat x | sed -i 's/a/b/' f",
  "perl -pi -e 's/a/b/' file.txt",
  "perl -i.bak -pe 's/a/b/' file.txt",
  // Python zapisujący pliki (heredoc, -c, stdin)
  "python - <<'EOF'\nopen('a.txt','w').write('x')\nEOF",
  "python3 - <<EOF\nfrom pathlib import Path\nPath('a').write_text('x')\nEOF",
  "python -c \"open('a.txt','w').write('x')\"",
  "python3 -c 'import shutil; shutil.copy(\"a\",\"b\")'",
  "cd apps/api && python - <<'EOF'\np='src/x.ts'\ns=open(p,encoding='utf-8').read()\nopen(p,'w',encoding='utf-8').write(s)\nEOF",
  // Node zapisujący pliki
  "node -e \"require('fs').writeFileSync('a.txt','x')\"",
  "node --eval \"const fs=require('fs'); fs.appendFileSync('a','b')\"",
  "node - <<'EOF'\nrequire('fs').writeFileSync('a','b')\nEOF",
  "node -p \"require('fs').rmSync('a')\"",
  // tee
  'echo x | tee file.txt',
  'echo x | tee -a apps/api/README.md',
  'cat a | tee out.txt | wc -l',
  // przekierowania do plików repo
  'echo hi > file.txt',
  'echo hi >> file.txt',
  'echo hi>file.txt',
  'printf "a\\n" > apps/web/src/x.ts',
  'cat <<EOF > file.txt\nzawartość\nEOF',
  "cat > file.txt <<'EOF'\nzawartość\nEOF",
  "cat <<'EOF' >> README.md\nnowy wpis\nEOF",
  'npm run build > build.log',
  'npm run build 2> errors.log',
  'grep -r x . &> out.txt',
  'ls > ../listing.txt',
];

const ALLOWED = [
  // zwykłe polecenia
  'git status',
  'git log --oneline -5',
  'npm run test --workspace=apps/api',
  'cd apps/api && npx jest 2>&1 | grep -E "Tests:|✕"',
  'npx tsc --noEmit | head -5',
  'ls -la',
  // sed bez -i
  "sed -n '1,20p' file.txt",
  "sed -e 's/a/b/' file.txt | head",
  "sed --silent -n '1p' f",
  'cat file | sed s/a/b/',
  // python/node bez zapisu
  'python -c "print(1+1)"',
  "python3 -c 'import json; print(json.dumps({1:2}))'",
  "node -e \"console.log(process.version)\"",
  // sam odczyt przez fs w node -e jest dozwolony
  "node -e \"console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).name)\"",
  'node scripts/e2e-registration.mjs',
  'node --test .claude/hooks/block-file-writes.test.js',
  'npx dotenv -e .env -- node scripts/x.mjs',
  // przekierowania do plików tymczasowych i standardowe
  'echo x > /tmp/x.txt',
  'echo x >> /tmp/log.txt',
  'command > /dev/null 2>&1',
  'command 2>/dev/null',
  'npm run build 2>&1 | tail -3',
  'echo err >&2',
  'echo x > $TMPDIR/x',
  'echo x > /c/Users/jan/AppData/Local/Temp/claude/scratch/x.txt',
  'echo x > "C:\\Users\\jan\\AppData\\Local\\Temp\\x.txt"',
  // tee bez pliku albo do tymczasowego
  'npm test | tee',
  'echo x | tee /tmp/x.txt',
  // > w cytatach, operatorach porównania i heredocach bez przekierowania
  'echo "a > b"',
  "grep -c '>' file.txt",
  "git log --format='%H > %s' -3",
  'docker exec db psql -U u -c "select 1 > 0"',
  "docker exec db psql -U u <<'SQL'\nselect * from t where a > 1;\nSQL",
  "git commit -q -F - <<'EOF'\nMoja zmiana => lepsza\n\n- punkt > inny\nEOF",
  "cat <<'EOF' | node -\nconsole.log('x => y')\nEOF",
  'cp /tmp/a.txt ./b.txt',
  'rm -f /tmp/x',
  'mkdir -p /tmp/x',
];

for (const command of BLOCKED) {
  test(`blokuje: ${command.split('\n')[0].slice(0, 90)}`, () => {
    const result = checkCommand(command, 'Bash');
    assert.equal(result.blocked, true, `powinno być zablokowane: ${command}`);
    assert.ok(result.reason);
  });
}

for (const command of ALLOWED) {
  test(`przepuszcza: ${command.split('\n')[0].slice(0, 90)}`, () => {
    const result = checkCommand(command, 'Bash');
    assert.equal(result.blocked, false, `powinno być dozwolone: ${command} (${result.reason})`);
  });
}

test('PowerShell: blokuje Set-Content / Out-File / przekierowanie do pliku, przepuszcza odczyt i pliki tymczasowe', () => {
  for (const command of [
    'Set-Content -Path apps/api/x.ts -Value "a"',
    '"tekst" | Out-File a.txt',
    'Add-Content README.md "linia"',
    '[System.IO.File]::WriteAllText("a.txt","x")',
    '"x" > file.txt',
  ]) {
    assert.equal(checkCommand(command, 'PowerShell').blocked, true, command);
  }
  for (const command of [
    'Get-Content README.md | Select-Object -First 5',
    'Get-ChildItem -Recurse | Out-Null',
    'docker ps 2>&1',
    'npm run build 2>$null',
    'Set-Content -Path $env:TEMP\\x.txt -Value "a"',
  ]) {
    assert.equal(checkCommand(command, 'PowerShell').blocked, false, command);
  }
});

test('puste i nie-tekstowe wejście jest przepuszczane', () => {
  assert.equal(checkCommand('', 'Bash').blocked, false);
  assert.equal(checkCommand(undefined, 'Bash').blocked, false);
});

// Test end-to-end: sam skrypt jako proces (tak jak wywołuje go Claude Code): JSON na stdin, kod wyjścia i stderr.
const script = path.join(__dirname, 'block-file-writes.js');
function runHook(payload) {
  return spawnSync(process.execPath, [script], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
}

test('proces: zablokowane polecenie => exit 2 i komunikat z odesłaniem do reguły 7 oraz Write/Edit', () => {
  const result = runHook({ tool_name: 'Bash', tool_input: { command: "sed -i 's/a/b/' file.txt" } });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /ODMOWA/);
  assert.match(result.stderr, /Reguła 7/);
  assert.match(result.stderr, /Write\/Edit/);
  assert.match(result.stderr, /sed -i/);
});

test('proces: dozwolone polecenie => exit 0 bez komunikatu; inne narzędzia nie są sprawdzane', () => {
  const allowed = runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stderr, '');

  const other = runHook({ tool_name: 'Read', tool_input: { command: "sed -i 's/a/b/' x" } });
  assert.equal(other.status, 0);
});

test('proces: uszkodzone wejście nie blokuje pracy (exit 0 z ostrzeżeniem)', () => {
  const result = runHook('to nie jest json');

  assert.equal(result.status, 0);
  assert.match(result.stderr, /przepuszczone/);
});
