#!/usr/bin/env node
// Hook PreToolUse (Bash, PowerShell, Read, Grep): sekrety z plików .env* nie trafiają do wyjścia poleceń ani do kontekstu modelu.
// Zasada właściciela (2026-10-13, CLAUDE.md reguła 5, D-139): nigdy nie wyświetlaj zawartości plików .env* ani wartości zmiennych
// środowiskowych - sprawdzaj tylko NAZWY kluczy albo to, czy zmienna jest ustawiona. Odmowa = kod wyjścia 2 + komunikat na stderr.
//
// Blokowane (Bash/PowerShell): przeglądarki, filtry i interpretery na ścieżce .env* (także glob `.env*`), przekierowanie wejścia
// `< .env`, grep/rg/findstr/Select-String z treścią wiersza (również `grep -r` w katalogu z plikiem .env bez `--exclude`), kod inline
// (`node -e/-p`, `python -c`, `bash -c`, `powershell -c`, `[IO.File]::Read…`) czytający .env albo środowisko, printenv, samo `env`/`set`,
// `Get-ChildItem env:`, /proc/*/environ, echo zmiennej o nazwie sekretu, `docker compose … config` (środowisko po interpolacji),
// `git diff --no-index` / `git add -f` z plikiem .env, wyniesienie pliku (cp i inne polecenia z .env jako argumentem).
// Read/Grep: plik .env* (poza *.example) jako `file_path`, `path` albo `glob`.
// Dozwolone: `grep -oE '^[A-Z0-9_]+=' .env` (same nazwy kluczy), grep -c/-q/-l, `dotenv -e .env -- <polecenie>` i
// `docker compose --env-file .env.prod <polecenie>` (polecenie po nich też jest sprawdzane), git, ls/test, pliki wzorcowe `*.example`.
//
// To bariera przed odruchem, nie sandbox (np. skrypt z pliku, który czyta .env i wypisuje wartości, nie zostanie wykryty). Testy:
// .claude/hooks/block-env-read.test.js (CI, job `lint + testy`).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REFERENCE =
  'Zasada sekretów (CLAUDE.md, reguła 5): nie wyświetlaj zawartości plików .env* ani wartości zmiennych środowiskowych. Nazwy kluczy: ' +
  "grep -oE '^[A-Z0-9_]+=' .env; czy ustawiona: [ -n \"$VAR\" ] && echo set; uruchamianie: npx dotenv -e .env -- <polecenie>.";

const isExample = (name) => /\.example$/i.test(name);
// Nazwa pliku env (ostatni człon ścieżki): .env, .env.prod, .env.local - bez wzorców *.example.
const isEnvName = (base) => /^\.env(\.[A-Za-z0-9_-]+)*$/.test(base) && !isExample(base);
// Glob, który może trafić w plik env: `.env*`, `.e*`, `.en?`, `.env.[a-z]*`, `*` w katalogu (cat *) - człon przed wildcardem
// jest prefiksem ".env" albo zaczyna się od ".env".
function globHitsEnv(base) {
  const star = base.search(/[*?[]/);
  if (star < 0) return false;
  const prefix = base.slice(0, star);
  if (isExample(base)) return false;
  // `.*` / `.?*` (wszystkie pliki ukryte) też trafia w .env; `.[0]` (filtr jq) - nie.
  if (prefix === '.') return /^\.[*?]/.test(base);
  // `*.env*`, `**/.env` - glob z wiodącym wildcardem i nazwą env.
  if (prefix === '') return /^\*+\.?env(\*|\.|$)/.test(base);
  return '.env'.startsWith(prefix) ? prefix.length >= 2 : prefix.startsWith('.env');
}
// Token-ścieżka pliku env (także w cudzysłowie, ze ścieżką Windows / względną, z doklejonym `&`, `)`).
function isEnvToken(token) {
  const clean = unquote(token).replace(/^[<(]+|[)&;,]+$/g, '');
  const base = clean.split(/[\\/]/).pop() ?? '';
  return isEnvName(base) || globHitsEnv(base);
}
// Ścieżka env w dowolnym miejscu tekstu (kod inline, [IO.File]::ReadAllText(".env")).
const ENV_IN_TEXT_RE = /(^|[\s"'`=(,\\/])(\.env(?:\.[A-Za-z0-9_-]+)*)(?=$|[\s"'`),;\\/])/g;
const ENV_IN_TEXT = { test: (text) => [...String(text).matchAll(ENV_IN_TEXT_RE)].some((m) => !isExample(m[2])) };
const ENV_ACCESS_IN_CODE = /process\.env\b|os\.environ|getenv\s*\(|\$env:|\bENV\[|System\.Environment|GetEnvironmentVariable/i;

const VIEWERS = new Set([
  'cat', 'type', 'get-content', 'gc', 'less', 'more', 'head', 'tail', 'sed', 'awk', 'gawk', 'cut', 'sort', 'uniq', 'nl', 'od', 'xxd',
  'hexdump', 'strings', 'bat', 'batcat', 'tac', 'rev', 'paste', 'column', 'jq', 'yq', 'base64', 'iconv', 'dos2unix', 'unix2dos',
  'code', 'notepad', 'vim', 'vi', 'nano', 'emacs', 'diff', 'cmp', 'comm', 'import-csv', 'get-item', 'convertfrom-stringdata', 'tr', 'fold',
]);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'perl', 'ruby', 'php', 'deno', 'bun', 'tsx', 'ts-node']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const GREPS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls']);
const SECRET_NAME = '[A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASS|PASSWORD|PASSWD|URL|DSN|CREDENTIAL|PRIVATE|AUTH)[A-Za-z0-9_]*';
// $X, ${X}, $env:X, ${env:X} (PowerShell).
const SECRET_VAR = new RegExp(`\\$\\{?(?:env:)?${SECRET_NAME}\\}?`, 'i');
const SECRET_GETENV = new RegExp(`GetEnvironmentVariable\\s*\\(\\s*['"]${SECRET_NAME}['"]`, 'i');

function unquote(token) {
  if (token.length >= 2 && (token[0] === '"' || token[0] === "'") && token[token.length - 1] === token[0]) return token.slice(1, -1);
  return token;
}

// Wycina treść heredoców ze skanu poleceń i zwraca je osobno z linią otwierającą: treść podana powłoce albo interpreterowi
// (`bash <<EOF`, `node <<'EOF'`, `python - <<EOF`) jest kodem i jest sprawdzana; reszta (opis commita/PR w `$(cat <<'EOF' … EOF)`,
// `git commit -F -`) to tekst.
function splitHeredocs(command) {
  const out = [];
  const bodies = [];
  let terminator = null;
  let opener = '';
  let body = [];
  for (const line of command.split(/\r?\n/)) {
    if (terminator !== null) {
      if (line.trim() === terminator) {
        bodies.push({ opener, body: body.join('\n') });
        terminator = null;
        body = [];
        out.push(line);
      } else {
        body.push(line);
      }
      continue;
    }
    out.push(line);
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (match) {
      terminator = match[2];
      opener = line.slice(0, match.index);
    }
  }
  if (terminator !== null) bodies.push({ opener, body: body.join('\n') });
  return { text: out.join('\n'), bodies };
}
const HEREDOC_SHELL = /(^|[\s;&|(])(bash|sh|zsh|dash|ksh|pwsh|powershell)(\.exe)?(\s[^<]*)?\s*$/;
const HEREDOC_INTERPRETER = /(^|[\s;&|(])(node|python3?|py|perl|ruby|php|deno|bun|tsx|ts-node)(\.exe)?(\s[^<]*)?\s*$/;

// Segmenty polecenia (|, ;, &&, ||, &, nowa linia, $( ), backtick) - separatory tylko POZA cudzysłowami; segment to lista tokenów
// z zachowanymi cudzysłowami. Zawartość `$( … )` / backticków w cudzysłowie podwójnym też jest poleceniem - dokładamy ją osobno.
function segments(command) {
  const result = [];
  const nested = [];
  let tokens = [];
  let current = '';
  let quote = null;
  const pushToken = () => {
    if (current !== '') tokens.push(current);
    current = '';
  };
  const pushSegment = () => {
    pushToken();
    if (tokens.length > 0) result.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '$' && command[i + 1] === '(') {
        const end = command.indexOf(')', i + 2);
        if (end > i) nested.push(command.slice(i + 2, end));
      } else if (quote === '"' && ch === '`') {
        const end = command.indexOf('`', i + 1);
        if (end > i) nested.push(command.slice(i + 1, end));
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '{' && current.endsWith('$')) {
      // `${VAR}`, `${env:VAR}` - część tokenu, nie blok poleceń.
      const end = command.indexOf('}', i);
      current += end > i ? command.slice(i, end + 1) : ch;
      i = end > i ? end : i;
    } else if (/\s/.test(ch) && ch !== '\n') {
      pushToken();
    } else if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '`' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      // `$(` - początek podpolecenia; `2>&1` - przekierowanie, nie separator.
      if (ch === '&' && current.endsWith('>')) {
        current += ch;
        continue;
      }
      if (ch === '(' && current.endsWith('$')) {
        // `x=$(polecenie …)` - podpolecenie zaczyna nowy segment.
        current = current.slice(0, -1);
        pushSegment();
        continue;
      }
      if (ch === '(' && current !== '') {
        current += ch;
        continue;
      }
      pushSegment();
    } else {
      current += ch;
    }
  }
  pushSegment();
  return { result, nested };
}

// grep pokazujący tylko nazwy kluczy albo bez treści.
function grepIsSafe(args) {
  const letters = args.filter((a) => /^-[A-Za-z]+$/.test(a)).map((a) => a.slice(1)).join('');
  const long = args.filter((a) => a.startsWith('--'));
  if (long.some((a) => /^--(count|quiet|silent|files-with-matches|files-without-match)$/.test(a))) return true;
  if (/[cqlL]/.test(letters)) return true;
  if (!letters.includes('o') || /[f]/.test(letters) || long.some((a) => a.startsWith('--file'))) return false;
  const keyOnly = /^\^\[[A-Za-z0-9_-]+\]\+=$|^\^\[[A-Za-z0-9_-]+\]\*=$|^\^\[A-Z_\]\[A-Z0-9_\]\*=$/;
  // Każdy wzorzec (pierwszy argument bez flagi albo każdy po -e) musi być „tylko nazwa klucza”.
  const patterns = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-e' || /^-[A-Za-z]*e$/.test(args[i]) || args[i] === '--regexp') patterns.push(args[i + 1]);
    if (args[i].startsWith('--regexp=')) patterns.push(args[i].slice('--regexp='.length));
  }
  if (patterns.length === 0) patterns.push(args.find((a) => !a.startsWith('-')));
  return patterns.every((p) => p !== undefined && keyOnly.test(unquote(p)));
}

// Katalog z plikiem env na najwyższym poziomie (dla grep -r / rg --hidden).
function dirHasEnvFile(dir) {
  try {
    return fs.readdirSync(dir).some((name) => isEnvName(name));
  } catch {
    return false;
  }
}

/**
 * @param {string} command polecenie z narzędzia Bash albo PowerShell
 * @param {string} [cwd] katalog roboczy (do sprawdzenia `grep -r`)
 * @returns {{blocked: boolean, reason?: string}}
 */
function checkCommand(command, cwd = process.cwd(), depth = 0) {
  if (typeof command !== 'string' || command.trim() === '' || depth > 4) return { blocked: false };
  const { text, bodies } = splitHeredocs(command);
  for (const { opener, body } of bodies) {
    if (HEREDOC_SHELL.test(opener)) {
      const verdict = checkCommand(body, cwd, depth + 1);
      if (verdict.blocked) return verdict;
    } else if (HEREDOC_INTERPRETER.test(opener) && (ENV_IN_TEXT.test(body) || ENV_ACCESS_IN_CODE.test(body))) {
      return { blocked: true, reason: 'kod w heredocu interpretera czyta .env albo środowisko.' };
    }
  }
  const { result: segs, nested } = segments(text);
  for (const inner of nested) {
    const verdict = checkCommand(inner, cwd, depth + 1);
    if (verdict.blocked) return verdict;
  }

  for (const words of segs) {
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['sudo', 'command', 'exec', 'nohup', 'time', 'xargs'].includes(words[i]))) i += 1;
    // `npx tsx …`, `npx node …` - nazwą polecenia jest uruchamiany pakiet.
    if (words[i] === 'npx' && /^(tsx|ts-node|node)$/.test(words[i + 1] ?? '')) i += 1;
    const raw = words[i] ?? '';
    const name = unquote(raw).replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    const args = words.slice(i + 1);
    const plain = args.filter((a) => !a.startsWith('-'));
    const segment = words.join(' ');

    // Środowisko procesu.
    if (name === 'printenv') return { blocked: true, reason: 'printenv wypisuje wartości zmiennych środowiskowych.' };
    if ((name === 'env' || name === 'export' || name === 'declare') && plain.length === 0) {
      return { blocked: true, reason: `${name} bez argumentów wypisuje wartości zmiennych środowiskowych.` };
    }
    if (name === 'set' && args.length === 0) return { blocked: true, reason: 'set bez argumentów wypisuje wartości zmiennych.' };
    if (/^(get-childitem|gci|dir|ls|get-item)$/.test(name) && args.some((a) => /^env:/i.test(unquote(a)))) {
      return { blocked: true, reason: 'Get-ChildItem env: wypisuje wartości zmiennych środowiskowych.' };
    }
    if (/\/proc\/[^\s/]+\/environ/.test(segment)) return { blocked: true, reason: '/proc/*/environ to środowisko procesu.' };
    if ((['echo', 'printf', 'write-host', 'write-output', 'print'].includes(name) || /^\$\{?env:/i.test(raw)) && SECRET_VAR.test(segment)) {
      return { blocked: true, reason: 'wypisanie zmiennej z sekretem pokazuje jej wartość.' };
    }
    if (SECRET_GETENV.test(segment)) return { blocked: true, reason: 'GetEnvironmentVariable z nazwą sekretu zwraca jego wartość.' };
    if (/GetEnvironmentVariables\s*\(/i.test(segment)) return { blocked: true, reason: 'GetEnvironmentVariables() zwraca całe środowisko.' };
    if (/\[(system\.)?io\.file\]::(read|open|copy)/i.test(segment) && ENV_IN_TEXT.test(segment)) {
      return { blocked: true, reason: '[IO.File]::Read… na pliku .env.' };
    }

    // Przekierowanie wejścia z pliku env (cel przekierowania, nie cały segment).
    for (let k = 0; k < words.length; k += 1) {
      const w = words[k];
      const target = w === '<' ? words[k + 1] : /^\d*<[^<]/.test(w) ? w.replace(/^\d*</, '') : null;
      if (target && isEnvToken(target)) return { blocked: true, reason: 'przekierowanie wejścia z pliku .env.' };
    }

    // Powłoki i interpretery z kodem inline: rekurencja (powłoki) albo szukanie .env / dostępu do środowiska (interpretery).
    // Także sklejone flagi: `node -pe`, `bash -lc`, `python3 -Ic`.
    const inlineIdx = args.findIndex((a) => /^-[A-Za-z]*[cep]$/.test(a) || /^-(command|encodedcommand)$/i.test(a) || /^--(eval|print)$/.test(a) || /^\/c$/i.test(a));
    if (SHELLS.has(name) && inlineIdx >= 0) {
      const verdict = checkCommand(unquote(args.slice(inlineIdx + 1).join(' ')), cwd, depth + 1);
      if (verdict.blocked) return verdict;
    }
    if (INTERPRETERS.has(name) && inlineIdx >= 0) {
      const code = args.slice(inlineIdx + 1).map(unquote).join(' ');
      if (ENV_IN_TEXT.test(code) || ENV_ACCESS_IN_CODE.test(code)) return { blocked: true, reason: `${name} z kodem inline czytającym .env albo środowisko.` };
    }

    // Uruchamianie ze zmiennymi z pliku: dotenv -e <plik> [--] <polecenie> - samo polecenie też sprawdzamy.
    if (name === 'dotenv' || (name === 'npx' && /^dotenv(-cli)?$/.test(args[0] ?? ''))) {
      const sep = args.indexOf('--');
      if (sep >= 0) {
        const verdict = checkCommand(args.slice(sep + 1).join(' '), cwd, depth + 1);
        if (verdict.blocked) return verdict;
      }
      continue;
    }
    // docker compose --env-file X <podpolecenie>: config wypisuje środowisko po interpolacji; exec/run <usługa> <polecenie> - sprawdzamy.
    if (name === 'docker' || name === 'docker-compose') {
      const sub = args.filter((a, k) => !a.startsWith('-') && !['--env-file', '-f', '--file', '-p', '--project-name', '--profile', '--project-directory', '--context', '-c', '--host', '-H'].includes(args[k - 1]) && a !== 'compose' && a !== 'container');
      if (sub[0] === 'config' && !args.some((a) => /^--(services|volumes|profiles|images|hash)$/.test(a))) {
        return { blocked: true, reason: 'docker compose config wypisuje zmienne po interpolacji z .env.' };
      }
      if (sub[0] === 'inspect') {
        const format = args.find((a, k) => args[k - 1] === '--format' || args[k - 1] === '-f' || a.startsWith('--format='));
        if (!format || /env/i.test(format)) return { blocked: true, reason: 'docker inspect wypisuje Config.Env (sekrety) - użyj --format bez Env.' };
      }
      const execAt = args.findIndex((a) => a === 'exec' || a === 'run');
      if (execAt >= 0) {
        const rest = args.slice(execAt + 1);
        let s = 0;
        while (s < rest.length && rest[s].startsWith('-')) s += /^-(u|w|e)$|^--(user|workdir|env)$/.test(rest[s]) ? 2 : 1;
        const verdict = checkCommand(rest.slice(s + 1).join(' '), cwd, depth + 1);
        if (verdict.blocked) return verdict;
      }
      continue;
    }
    if (name === 'git') {
      const envArg = args.some(isEnvToken);
      if (envArg && args.includes('--no-index')) return { blocked: true, reason: 'git diff --no-index wypisuje cały plik .env.' };
      if (envArg && args[0] === 'add' && args.some((a) => a === '-f' || a === '--force')) return { blocked: true, reason: 'git add -f dodaje plik .env do repo.' };
      continue;
    }
    if (name === 'gh') {
      // gh gist create / release upload / attachment z plikiem .env wynosi sekrety na GitHub.
      if (args.some(isEnvToken) && /^(gist|release|issue|pr)$/.test(args[0] ?? '') && !args.includes('--body-file')) {
        return { blocked: true, reason: 'gh z plikiem .env jako argumentem wynosi sekrety na GitHub.' };
      }
      continue;
    }

    // grep: pliki env wprost albo rekurencja po katalogu, w którym leży plik env.
    if (GREPS.has(name)) {
      const files = name === 'select-string' || name === 'sls' ? args : plain.slice(1);
      if (args.some((a) => /^--include=/.test(a) && isEnvToken(a.slice('--include='.length)))) {
        return { blocked: true, reason: `${name} --include=.env* wypisuje wiersze pliku .env.` };
      }
      const recursive = args.some((a) => /^-[A-Za-z]*[rR]/.test(a) || a === '--recursive') || ((name === 'rg' || name === 'ag') && args.some((a) => /^(--hidden|-uu+|--no-ignore|-u|-\.)$/.test(a)));
      // --exclude musi obejmować wszystkie pliki env (`.env*`), nie tylko `.env`.
      if (recursive && !grepIsSafe(args) && !args.some((a) => /^--exclude=['"]?\.env\*/.test(a) || /^-g['"]?!\.env\*/.test(a))) {
        const dirs = (files.length > 0 ? files : ['.']).map((d) => path.resolve(cwd, unquote(d)));
        if (dirs.some(dirHasEnvFile)) return { blocked: true, reason: `${name} rekurencyjnie w katalogu z plikiem .env (dodaj --exclude='.env*').` };
      }
      if (!files.some(isEnvToken) || grepIsSafe(args)) continue;
      return { blocked: true, reason: `${name} na pliku .env bez trybu „tylko nazwy kluczy” wypisuje wartości.` };
    }

    const envArgs = args.filter(isEnvToken);
    if (envArgs.length === 0) continue;
    if (name === 'source' || name === '.') continue; // wczytanie nic nie wypisuje; wypisanie łapie SECRET_VAR
    if (['cp', 'copy', 'copy-item'].includes(name) && isExample(unquote(plain[0] ?? ''))) continue; // cp .env.example .env
    if (['ls', 'dir', 'test', '[', 'stat', 'wc', 'chmod', 'icacls', 'rm', 'del', 'remove-item'].includes(name)) continue;
    if (VIEWERS.has(name) || INTERPRETERS.has(name)) return { blocked: true, reason: `${name} wyświetla albo przetwarza zawartość pliku .env.` };
    // Nieznane polecenie z plikiem env jako argumentem - ostrożnie: blokada (cp/mv/scp też wynoszą sekrety poza plik).
    return { blocked: true, reason: `${name || 'polecenie'} z plikiem .env jako argumentem.` };
  }
  return { blocked: false };
}

/** Read/Grep: plik .env* (poza *.example) jako file_path, path albo glob. */
function checkFileTool(input) {
  if (!input || typeof input !== 'object') return { blocked: false };
  for (const field of ['file_path', 'path', 'glob']) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') continue;
    const base = value.split(/[\\/]/).pop() ?? '';
    if (isEnvName(base) || globHitsEnv(base)) {
      return { blocked: true, reason: `${field} wskazuje plik .env.` };
    }
  }
  return { blocked: false };
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== 'object') {
      process.stderr.write('block-env-read: nie udało się odczytać wejścia hooka, polecenie przepuszczone.\n');
      process.exit(0);
    }
    const tool = payload.tool_name;
    const input = payload.tool_input ?? {};
    let result = { blocked: false };
    if (tool === 'Bash' || tool === 'PowerShell') result = checkCommand(input.command, typeof payload.cwd === 'string' ? payload.cwd : process.cwd());
    else if (tool === 'Read' || tool === 'Grep') result = checkFileTool(input);
    if (result.blocked) {
      process.stderr.write(`ODMOWA: polecenie odsłoniłoby sekrety (${result.reason}) ${REFERENCE}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { checkCommand, checkFileTool, REFERENCE };
