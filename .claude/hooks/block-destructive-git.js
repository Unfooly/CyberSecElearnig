#!/usr/bin/env node
// Hook PreToolUse (Bash, PowerShell): mechanicznie egzekwuje regułę 11 z CLAUDE.md - żadnych poleceń niszczących na origin ani na main.
// Odrzuca (kod wyjścia 2 + komunikat na stderr; Claude Code pokazuje go modelowi i NIE uruchamia polecenia) m.in.:
//   git push: --force/-f/--force-with-lease/--force-if-includes, --delete/-d, --mirror, --all, --prune (także skróty opcji, np. --delet),
//             refspec usuwający (":ref") lub wymuszający ("+ref"), push NA main/master (`origin main`, `HEAD:main`) - także z --dry-run;
//   git branch: -D, -d z -f, usuwanie/przenoszenie main/master, -f (przesunięcie gałęzi);
//   git reset --hard (zawsze: nie da się rozróżnić "własnego brancha roboczego", więc blokujemy całkiem);
//   git clean z -f/--force; git rebase będąc NA main/master (także po `git switch main &&`, `git -C`, `cd`) albo z rebasowaną gałęzią main;
//   git checkout/restore/switch niszczące zmiany w drzewie roboczym: `checkout -- .`, `checkout .`, `restore .` (bez ścieżki), -f/--force;
//   aliasy gita (`git -c alias.x=...`, `git config alias.x ...`) - bo pozwalają ukryć polecenie z tej listy;
//   gh: repo delete, release delete, pr merge, api z metodą DELETE albo mutacją refów (git/refs).
// Rozpoznaje polecenia w łańcuchach (; && || |), pod `$(...)`, backtickami, `sh -c`, `eval`, `xargs`, `find -exec`, wrapperami (sudo, env,
// timeout, nice...), słowami kluczowymi powłoki (then, do), PowerShellem (Start-Process, iex, Invoke-Command, -EncodedCommand) i w
// heredocach przekazywanych do powłoki. Dozwolone: bezpieczne wersje (push nowej gałęzi, `branch -d` scalonej, `reset --soft/--mixed`,
// `clean -n`, `restore --staged .`, `restore -p`, `checkout -- <konkretny plik>`, `rebase origin/main` na własnym branchu roboczym).
//
// GRANICE (świadomie): wykrywanie jest STATYCZNE, więc to bariera przed odruchem, nie sandbox. NIE wykryje: poleceń budowanych ze zmiennych
// (`g=git; $g push -f`), skryptów (`bash skrypt.sh`, `python -c`, `node -e`), aliasów zdefiniowanych wcześniej w ~/.gitconfig, ani
// wywołań spoza narzędzi Bash/PowerShell, potoku do powłoki (`echo 'git push -f' | sh`), here-stringów PowerShella, rozwijania klamer/
// backslashy w nazwie polecenia, `git push` bez refspeca z gałęzi main, ani innych poleceń niszczących spoza listy reguły 11
// (`update-ref -d`, `tag -d`, `remote remove`, `worktree remove -f`, `reflog expire`, `fetch origin main:main`). Fail-open: uszkodzone wejście hooka albo brak informacji o aktualnej gałęzi przepuszcza polecenie
// (z ostrzeżeniem w pierwszym przypadku). Nie zastępuje ochrony gałęzi w GitHub ani hooka pre-push.
//
// Do SPRAWDZANIA hooków i uprawnień służy wyłącznie --dry-run (poza formami z listy), tymczasowe repozytorium (`git init` w katalogu
// tymczasowym z lokalnym "origin") albo test jednostkowy - NIGDY prawdziwy origin (reguła 11).
//
// Testy: .claude/hooks/block-destructive-git.test.js (w CI, job `test`).
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REFERENCE =
  'Reguła 11 (CLAUDE.md): żadnych poleceń niszczących na origin ani na main (force-push, usuwanie gałęzi/refów, reset --hard, clean -f, ' +
  'odrzucanie zmian z całego drzewa, rebase main). Zmiany na main idą wyłącznie przez pull request. Do sprawdzania hooków i uprawnień służy ' +
  'wyłącznie --dry-run (poza formami z tej listy), tymczasowe repozytorium z lokalnym "origin" (git init w katalogu tymczasowym) albo test ' +
  'jednostkowy - nigdy prawdziwy origin.';

const PROTECTED = new Set(['main', 'master']);
const isProtectedName = (name) => PROTECTED.has(String(name).replace(/^refs\/heads\//, '').replace(/^origin\//, ''));
const blocked = (reason) => ({ blocked: true, reason });
const OK = { blocked: false };
const MAX_DEPTH = 4;

// ---- tokenizacja --------------------------------------------------------------------------------------------------------------

// Wewnętrzna treść $(...) albo `...` zaczynającej się w text[start] ($ / ` / < / >); zwraca { inner, end } (end = indeks za zamknięciem).
function readSubstitution(text, start) {
  if (text[start] === '`') {
    let i = start + 1;
    while (i < text.length && text[i] !== '`') i += text[i] === '\\' ? 2 : 1;
    return { inner: text.slice(start + 1, i), end: i + 1 };
  }
  const open = text.indexOf('(', start);
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return { inner: text.slice(open + 1), end: text.length };
}

// Dzieli polecenie na segmenty (po niecytowanych ; && || | & i nowych liniach) z tokenami bez cudzysłowów. Zwraca też treści podstawień
// ($(...), `...`, <(...)) do osobnej analizy. Przekierowania (> >> < 2>&1 <<) i ich cele są pomijane. Backslash w "..." jest escapem
// tylko przed " \ $ ` (jak w POSIX), więc ścieżki Windows w cudzysłowie ("C:\Program Files\Git\cmd\git.exe") zostają nienaruszone.
function tokenize(text, powershell = false) {
  const segmentsOut = [];
  const subs = [];
  let tokens = [];
  let current = '';
  let hasToken = false;
  let quote = null;
  let dropNext = false;
  const pushToken = () => {
    if (hasToken) {
      if (dropNext) dropNext = false;
      else tokens.push(current);
    }
    current = '';
    hasToken = false;
  };
  const pushSegment = () => {
    pushToken();
    if (tokens.length > 0) segmentsOut.push(tokens);
    tokens = [];
    dropNext = false;
  };
  const src = text.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (powershell && ch === '`') {
      // W PowerShellu backtick to znak ucieczki (`\n = ciągłość linii, `" = cudzysłów), nie podstawienie polecenia.
      if (src[i + 1] === '\n' || src[i + 1] === '\r') {
        pushToken();
        i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 2 : 1;
      } else if (i + 1 < src.length) {
        current += src[i + 1];
        hasToken = true;
        i += 1;
      }
      continue;
    }
    if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
      const { inner, end } = readSubstitution(src, i);
      subs.push(inner);
      current += '$()';
      hasToken = true;
      i = end - 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (powershell && ch === '`' && i + 1 < src.length) {
        current += src[i + 1]; // `" w cudzysłowie PowerShella
        i += 1;
      } else if (ch === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) {
        current += src[i + 1];
        i += 1;
      } else current += ch;
      continue;
    }
    if (ch === '#' && !hasToken) {
      // Komentarz (niecytowane # na początku słowa): reszta linii nie jest poleceniem (i jej apostrofy nie otwierają cudzysłowu).
      while (i + 1 < src.length && src[i + 1] !== '\n') i += 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if ((ch === '<' || ch === '>') && src[i + 1] === '(') {
      const { inner, end } = readSubstitution(src, i);
      subs.push(inner);
      i = end - 1;
    } else if (ch === '<' || ch === '>') {
      if (/^\d+$/.test(current)) {
        current = '';
        hasToken = false;
      } else {
        pushToken();
      }
      let op = ch;
      while (i + 1 < src.length && '<>&'.includes(src[i + 1])) {
        op += src[i + 1];
        i += 1;
      }
      if (op.includes('&')) {
        while (i + 1 < src.length && /[\d-]/.test(src[i + 1])) i += 1; // 2>&1, >&-
      } else {
        dropNext = true; // cel przekierowania (plik / słowo heredocu) nie jest argumentem polecenia
      }
    } else if (/\s/.test(ch) && ch !== '\n') {
      pushToken();
    } else if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      pushSegment();
    } else if (ch === '{' && src[i + 1] === '}') {
      current += '{}'; // znacznik miejsca xargs -I {} / find -exec {}
      hasToken = true;
      i += 1;
    } else if (ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      pushToken();
    } else {
      current += ch;
      hasToken = true;
    }
  }
  pushSegment();
  return { segments: segmentsOut, subs };
}

// Heredoc otwierany w linii (poza cudzysłowami, nie `<<<`): zwraca { terminator, quoted } albo null. quoted = terminator w cudzysłowie
// (treść literalna); niecytowany terminator = powłoka WYKONUJE podstawienia $(...) w treści.
function heredocTerminator(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      const match = /^<<-?\s*(['"]?)([^\s'"<>|;&()]+)\1/.exec(line.slice(i));
      if (match) return { terminator: match[2], quoted: match[1] !== '' };
    } else if (ch === '<' && line[i + 1] === '<') {
      i += 2; // <<<
    }
  }
  return null;
}

// Wycina treści heredoców (np. opis commita w `git commit -F - <<'EOF'`): tekst w środku nie jest poleceniem. Heredoc bez terminatora
// NIE ukrywa reszty polecenia (fail-closed). Zwraca też treści heredocow wraz z linią otwierającą (do analizy, gdy trafiają do powłoki).
function splitHeredocs(command) {
  const lines = command.split(/\r?\n/);
  const kept = [];
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const heredoc = heredocTerminator(lines[i]);
    if (heredoc === null) continue;
    const end = lines.findIndex((line, index) => index > i && line.trim() === heredoc.terminator);
    if (end === -1) continue; // brak terminatora: nic nie wycinamy
    bodies.push({ intro: lines[i], body: lines.slice(i + 1, end).join('\n'), quoted: heredoc.quoted });
    kept.push(lines[end]);
    i = end;
  }
  return { text: kept.join('\n'), bodies };
}

// ---- pierwsze słowo polecenia -------------------------------------------------------------------------------------------------

const baseName = (token) => String(token).replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', 'time', 'coproc']);
// Wrappery i ich opcje pobierające wartość.
const WRAPPERS = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '--user', '--group'],
  env: ['-u', '-C', '-S', '--unset', '--chdir'],
  nice: ['-n', '--adjustment'],
  ionice: ['-c', '-n', '-p'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  command: [],
  nohup: [],
  exec: ['-a'],
  builtin: [],
  stdbuf: ['-i', '-o', '-e'],
  call: [],
};

function commandWord(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const name = baseName(token);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || /^\$?env:/i.test(token) || KEYWORDS.has(token)) {
      i += 1;
    } else if (Object.prototype.hasOwnProperty.call(WRAPPERS, name)) {
      i += 1;
      while (i < tokens.length && tokens[i].startsWith('-')) {
        i += WRAPPERS[name].includes(tokens[i]) && !tokens[i].includes('=') ? 2 : 1;
      }
      if (name === 'timeout' && /^\d+(\.\d+)?[smhd]?$/.test(tokens[i] || '')) i += 1;
    } else {
      break;
    }
  }
  return { word: tokens[i] !== undefined ? baseName(tokens[i]) : '', rest: tokens.slice(i + 1), index: i };
}

// ---- rozbiór argumentów -------------------------------------------------------------------------------------------------------

// Flagi (długie, skrócone, klastry -fd) i operandy. `valueOpts` = flagi pobierające wartość. hasLong dopasowuje też jednoznaczne skróty
// opcji długich (Git je przyjmuje: --delet = --delete); minimum to `--` + 3 litery.
function parseArgs(args, valueOpts = []) {
  const flags = [];
  const operands = [];
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (afterDoubleDash) {
      operands.push(arg);
    } else if (arg === '--') {
      afterDoubleDash = true;
      operands.push('--');
    } else if (arg.startsWith('--')) {
      const name = arg.split('=')[0];
      flags.push(name);
      if (valueOpts.includes(name) && !arg.includes('=')) i += 1;
    } else if (arg.startsWith('-') && arg.length > 1) {
      const body = arg.slice(1);
      for (let j = 0; j < body.length; j += 1) {
        const flag = `-${body[j]}`;
        flags.push(flag);
        if (valueOpts.includes(flag)) {
          if (j === body.length - 1) i += 1; // wartość w następnym argumencie; inaczej doklejona (-oforce)
          break;
        }
      }
    } else {
      operands.push(arg);
    }
  }
  return {
    flags,
    operands,
    has: (...names) => names.some((name) => flags.includes(name)),
    hasLong: (...names) => flags.some((flag) => flag.startsWith('--') && flag.length >= 5 && names.some((name) => name === flag || name.startsWith(flag))),
  };
}

// Globalne opcje gita przed podpoleceniem: zwraca sub, args, katalog z -C oraz aliasy podane przez -c alias.x=...
function splitGit(rest) {
  let i = 0;
  let cwd;
  const aliases = [];
  while (i < rest.length && rest[i].startsWith('-')) {
    const opt = rest[i];
    if (opt === '-C') {
      cwd = rest[i + 1];
      i += 2;
    } else if (opt === '-c' || opt === '--config-env') {
      if (/^alias\./i.test(rest[i + 1] || '')) aliases.push(rest[i + 1]);
      i += 2;
    } else if (opt.startsWith('--config-env=') && /alias\./i.test(opt)) {
      aliases.push(opt);
      i += 1;
    } else if (['--git-dir', '--work-tree', '--namespace', '--super-prefix', '--exec-path'].includes(opt)) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return { sub: rest[i], args: rest.slice(i + 1), cwd, aliases };
}

// ---- reguły git ---------------------------------------------------------------------------------------------------------------

function checkPush(args) {
  const parsed = parseArgs(args, ['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
  if (parsed.has('-f') || parsed.hasLong('--force', '--force-with-lease', '--force-if-includes')) return blocked('git push z wymuszeniem (--force / -f / --force-with-lease).');
  if (parsed.has('-d') || parsed.hasLong('--delete')) return blocked('git push --delete usuwa ref na origin.');
  if (parsed.hasLong('--mirror')) return blocked('git push --mirror nadpisuje/usuwa refy na origin.');
  if (parsed.hasLong('--all')) return blocked('git push --all wypycha wszystkie gałęzie (w tym main).');
  if (parsed.hasLong('--prune')) return blocked('git push --prune usuwa zdalne refy.');
  const operands = parsed.operands.filter((operand) => operand !== '--');
  for (const [index, operand] of operands.entries()) {
    if (operand.startsWith(':')) return blocked(`refspec "${operand}" usuwa ref na origin (git push origin :ref).`);
    if (operand.startsWith('+')) return blocked(`refspec "${operand}" wymusza aktualizację refu (+).`);
    // Operand 0 to repozytorium (nie refspec), chyba że zawiera ":" (git push HEAD:main bez remote).
    if (index > 0 || operand.includes(':')) {
      const destination = operand.includes(':') ? operand.slice(operand.lastIndexOf(':') + 1) : operand;
      if (isProtectedName(destination)) return blocked(`push NA ${destination.replace(/^refs\/heads\//, '')}: zmiany na main idą wyłącznie przez pull request.`);
    }
  }
  return OK;
}

function checkBranch(args) {
  const parsed = parseArgs(args, ['-u', '--set-upstream-to', '--contains', '--no-contains', '--merged', '--no-merged', '--sort', '--format']);
  const deleting = parsed.has('-d', '-D') || parsed.hasLong('--delete');
  const force = parsed.has('-f') || parsed.hasLong('--force');
  if (parsed.has('-D')) return blocked('git branch -D usuwa gałąź bez sprawdzania scalenia.');
  if (deleting && force) return blocked('git branch -d z --force usuwa gałąź bez sprawdzania scalenia.');
  if ((deleting || parsed.has('-m', '-M') || parsed.hasLong('--move')) && parsed.operands.some(isProtectedName)) {
    return blocked('git branch usuwa/przenosi main.');
  }
  if (force && parsed.operands.length > 0) return blocked('git branch -f przesuwa istniejącą gałąź (nadpisuje historię).');
  return OK;
}

function checkReset(args) {
  const parsed = parseArgs(args);
  if (parsed.hasLong('--hard')) {
    return blocked('git reset --hard kasuje zmiany w drzewie roboczym i przesuwa gałąź (nie da się rozróżnić własnego brancha roboczego, więc blokujemy zawsze).');
  }
  return OK;
}

function checkClean(args) {
  const parsed = parseArgs(args);
  if (parsed.has('-f') || parsed.hasLong('--force')) return blocked('git clean -f usuwa nieśledzone pliki bez odwrotu (bez -f Git tego nie zrobi; podgląd: git clean -n).');
  return OK;
}

const BROAD_PATHS = new Set(['.', './', '*', ':/', ':/.', ':(top)', '../']);
const isBroadPath = (operand) => BROAD_PATHS.has(operand) || /^\.\/?\.?$/.test(operand);

function checkCheckout(args, sub) {
  const parsed = parseArgs(args, ['-b', '-B', '-c', '-C', '--orphan', '-s', '--source']);
  if (parsed.has('-f') || parsed.hasLong('--force', '--discard-changes')) return blocked(`git ${sub} z wymuszeniem odrzuca zmiany w drzewie roboczym.`);
  if (parsed.has('-p') || parsed.hasLong('--patch')) return OK; // tryb interaktywny: użytkownik wybiera fragmenty
  if (sub === 'restore') {
    const worktreeTouched = !(parsed.has('-S') || parsed.hasLong('--staged')) || parsed.has('-W') || parsed.hasLong('--worktree');
    if (worktreeTouched && parsed.operands.some(isBroadPath)) return blocked('git restore z "." odrzuca zmiany w całym drzewie roboczym (podaj konkretne pliki).');
  }
  if (sub === 'checkout' && parsed.operands.some(isBroadPath)) {
    return blocked('git checkout -- . / checkout . odrzuca zmiany w całym drzewie roboczym (podaj konkretne pliki).');
  }
  return OK;
}

function checkRebase(args, currentBranch) {
  const parsed = parseArgs(args, ['--onto', '-x', '--exec', '-s', '--strategy', '-X', '--strategy-option']);
  if (parsed.hasLong('--abort', '--continue', '--quit', '--skip', '--edit-todo')) return OK;
  // Rebasowana gałąź podana jawnie jako drugi operand (git rebase <upstream> main) albo aktualna gałąź to main.
  if (parsed.operands.length >= 2 && isProtectedName(parsed.operands[1])) return blocked('git rebase przepisuje historię gałęzi main.');
  const current = currentBranch();
  if (current && PROTECTED.has(current)) return blocked(`git rebase na aktualnej gałęzi ${current} przepisuje jej historię (rebase robimy na własnym branchu roboczym, np. git rebase origin/main).`);
  return OK;
}

function checkConfig(args) {
  const parsed = parseArgs(args);
  const readOnly = parsed.hasLong('--get', '--get-all', '--get-regexp', '--list', '--unset', '--unset-all', '--remove-section') || parsed.has('-l');
  if (!readOnly && parsed.operands.some((operand) => /^alias\./i.test(operand))) {
    return blocked('git config alias.* pozwala ukryć polecenie z listy zakazanych pod skrótem.');
  }
  return OK;
}

function checkGit(rest, ctx) {
  const { sub, args, cwd, aliases } = splitGit(rest);
  if (aliases.length > 0) return blocked(`git -c ${aliases[0]}: aliasy pozwalają ukryć polecenie z listy zakazanych.`);
  const branchHere = () => ctx.currentBranch(cwd);
  switch (sub) {
    case 'push':
      return checkPush(args);
    case 'branch':
      return checkBranch(args);
    case 'reset':
      return checkReset(args);
    case 'clean':
      return checkClean(args);
    case 'checkout':
    case 'restore':
    case 'switch': {
      const result = checkCheckout(args, sub);
      if (!result.blocked && (sub === 'checkout' || sub === 'switch')) {
        // Śledzenie w obrębie jednego polecenia: `git switch main && git rebase ...`.
        const parsed = parseArgs(args, ['-b', '-B', '-c', '-C', '--orphan']);
        if (parsed.has('-b', '-B', '-c', '-C', '--orphan')) ctx.state.assumedBranch = 'work';
        else if (parsed.operands[0] && !parsed.operands.includes('--')) ctx.state.assumedBranch = parsed.operands[0].replace(/^origin\//, '');
      }
      return result;
    }
    case 'rebase':
      return checkRebase(args, branchHere);
    case 'config':
      return checkConfig(args);
    default:
      return OK;
  }
}

// ---- gh -----------------------------------------------------------------------------------------------------------------------

function checkGh(rest) {
  const words = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (['-R', '--repo', '--hostname', '-H'].includes(rest[i])) i += 1;
    else if (!rest[i].startsWith('-')) words.push(rest[i]);
  }
  const [group, action] = words;
  if (group === 'repo' && action === 'delete') return blocked('gh repo delete usuwa repozytorium.');
  if (group === 'release' && action === 'delete') return blocked('gh release delete usuwa wydanie.');
  if (group === 'pr' && action === 'merge') return blocked('gh pr merge: merge do main robi wyłącznie właściciel w GitHub.');
  if (group === 'api') {
    const joined = rest.join(' ');
    const method = /(?:^|\s)(?:-X|--method)(?:\s+|=)([A-Za-z]+)/i.exec(joined) || /(?:^|\s)-X([A-Za-z]+)/i.exec(joined);
    const verb = method ? method[1].toUpperCase() : 'GET';
    if (verb === 'DELETE') return blocked('gh api z metodą DELETE usuwa zasoby na origin.');
    if (verb !== 'GET' && /git\/refs|\/refs\/heads|\/branches\/[^\s/]+\/protection/i.test(joined)) return blocked('gh api modyfikuje refy/ochronę gałęzi na origin.');
  }
  return OK;
}

// ---- analiza ------------------------------------------------------------------------------------------------------------------

function resolveCwd(base, cwd) {
  return cwd ? path.resolve(base || process.cwd(), cwd) : base || process.cwd();
}

function inspectSegment(tokens, ctx, depth) {
  const { word, rest, index } = commandWord(tokens);
  const ps = (name) => ['start-process', 'saps', 'invoke-expression', 'iex', 'invoke-command', 'icm', 'start-job', 'foreach-object', '%', 'set-location', 'sl'].includes(name);
  if (word === 'git') return checkGit(rest, ctx);
  if (word === 'gh') return checkGh(rest);
  if (word === 'cd' || word === 'pushd' || (ps(word) && (word === 'set-location' || word === 'sl'))) {
    ctx.state.cwd = resolveCwd(ctx.state.cwd || ctx.base, rest.find((token) => !token.startsWith('-')));
    ctx.state.assumedBranch = undefined;
    return OK;
  }
  if (word === 'xargs') {
    // xargs [opcje] git ...
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) i += ['-I', '-n', '-P', '-L', '-d', '-E', '-a', '-s'].includes(rest[i]) ? 2 : 1;
    if (i < rest.length) return inspectSegment(rest.slice(i), ctx, depth);
  }
  if (word === 'find') {
    const exec = rest.findIndex((token) => ['-exec', '-execdir', '-ok', '-okdir'].includes(token));
    if (exec >= 0) return inspectSegment(rest.slice(exec + 1), ctx, depth);
  }
  if (depth < MAX_DEPTH) {
    if (word === 'eval' || word === 'iex' || word === 'invoke-expression') {
      return analyze(rest.join(' '), ctx, depth + 1);
    }
    if (SHELLS.has(word)) {
      const powershell = word === 'pwsh' || word === 'powershell';
      // Base64 (-EncodedCommand) tylko dla PowerShella: w powłokach POSIX -e/-ec to opcje (bash -ec "cmd"), nie zakodowane polecenie.
      const encoded = powershell ? rest.findIndex((token) => /^-(e|ec|enc|encodedcommand)$/i.test(token)) : -1;
      if (encoded >= 0 && rest[encoded + 1]) {
        const decoded = Buffer.from(rest[encoded + 1], 'base64').toString('utf16le');
        const result = analyze(decoded, ctx, depth + 1);
        if (result.blocked) return result;
      }
      // Flaga polecenia: -c, także w klastrach POSIX (-ec, -lc, -xc, -euc), -Command (PowerShell), /c /k (cmd).
      const isCommandFlag = (token) => (powershell ? /^-(c|command)$/i.test(token) : /^(-[a-z]*c|\/c|\/k)$/i.test(token));
      const inner = rest.filter((token, i) => (i > 0 && isCommandFlag(rest[i - 1])) || (!token.startsWith('-') && /\s/.test(token))).join('\n');
      if (inner) return analyze(inner, ctx, depth + 1);
    }
    if (word === 'start-process' || word === 'saps') {
      // Start-Process [-FilePath] git -ArgumentList "push","--force"
      const fileFlag = rest.findIndex((token) => /^-(filepath|f)$/i.test(token));
      const program = fileFlag >= 0 ? rest[fileFlag + 1] : rest.find((token) => !token.startsWith('-'));
      const argFlag = rest.findIndex((token) => /^-(argumentlist|args|al)$/i.test(token));
      if (program && ['git', 'gh'].includes(baseName(program)) && argFlag >= 0 && rest[argFlag + 1]) {
        return inspectSegment([program, ...rest[argFlag + 1].split(/[,\s]+/).filter(Boolean)], ctx, depth + 1);
      }
    }
    if (['invoke-command', 'icm', 'start-job', 'foreach-object', '%'].includes(word)) {
      const at = rest.findIndex((token) => ['git', 'gh'].includes(baseName(token)));
      if (at >= 0) return inspectSegment(rest.slice(at), ctx, depth + 1);
    }
  }
  void index;
  return OK;
}

function analyze(command, ctx, depth = 0) {
  const { text, bodies } = splitHeredocs(command);
  const { segments, subs } = tokenize(text, ctx.powershell);
  for (const tokens of segments) {
    const result = inspectSegment(tokens, ctx, depth);
    if (result.blocked) return result;
  }
  if (depth < MAX_DEPTH) {
    for (const sub of subs) {
      const result = analyze(sub, ctx, depth + 1);
      if (result.blocked) return result;
    }
    // Treść heredocu jest poleceniem tylko wtedy, gdy trafia do powłoki (`bash <<EOF`, `cat <<EOF | sh`); w heredocu z niecytowanym
    // terminatorem powłoka wykonuje też podstawienia $(...) z treści.
    for (const { intro, body, quoted } of bodies) {
      const toShell = tokenize(intro, ctx.powershell).segments.some((tokens) => SHELLS.has(commandWord(tokens).word));
      const parts = toShell ? [body] : quoted ? [] : tokenize(body).subs;
      for (const part of parts) {
        const result = analyze(part, ctx, depth + 1);
        if (result.blocked) return result;
      }
    }
  }
  return OK;
}

function currentBranchFromGit(cwd) {
  // symbolic-ref działa też na gałęzi bez commitów (rev-parse HEAD by tu zawiódł) i zawodzi przy detached HEAD (wtedy: brak informacji).
  const result = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * @param {string} command polecenie z narzędzia Bash albo PowerShell
 * @param {'Bash'|'PowerShell'} _tool
 * @param {{currentBranch?: (cwd?: string) => (string|null)}} options currentBranch: dostawca nazwy aktualnej gałęzi (testy; domyślnie `git rev-parse`)
 * @returns {{blocked: boolean, reason?: string}}
 */
function checkCommand(command, tool = 'Bash', options = {}) {
  if (typeof command !== 'string' || command.trim() === '') return OK;
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const provider = options.currentBranch || ((cwd) => currentBranchFromGit(resolveCwd(base, cwd)));
  const state = { cwd: undefined, assumedBranch: undefined };
  const ctx = {
    base,
    state,
    powershell: tool === 'PowerShell',
    // Aktualna gałąź: założona w obrębie polecenia (`git switch main && ...`) albo z gita w bieżącym katalogu (po `cd` i z `-C`).
    currentBranch: (cwd) => {
      if (state.assumedBranch !== undefined && cwd === undefined) return state.assumedBranch;
      return provider(cwd ? resolveCwd(state.cwd || base, cwd) : state.cwd);
    },
  };
  return analyze(command, ctx);
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
      // Uszkodzone wejście hooka nie może zablokować całej pracy - przepuszczamy z ostrzeżeniem.
      process.stderr.write('block-destructive-git: nie udało się odczytać wejścia hooka, polecenie przepuszczone.\n');
      process.exit(0);
    }
    const tool = payload.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
    const result = checkCommand(payload.tool_input && payload.tool_input.command, tool);
    if (result.blocked) {
      process.stderr.write(`ODMOWA: polecenie niszczące (${result.reason}) ${REFERENCE}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { checkCommand, REFERENCE };
