#!/usr/bin/env node
// Hook PreToolUse (Bash, PowerShell): mechanicznie egzekwuje regułę 7 z CLAUDE.md - pliki w repo edytuje się
// WYŁĄCZNIE narzędziami Write/Edit, nigdy poleceniem z powłoki (sed -i, perl -i, skrypty Python/Node zapisujące
// pliki, tee, przekierowania > i >> itd.). Odmowa = kod wyjścia 2 + komunikat na stderr (Claude Code pokazuje go
// modelowi i nie uruchamia polecenia).
//
// Dozwolone: zapis do plików tymczasowych (/tmp, $TMPDIR, katalogi Temp, /dev/null) - polecenia pomocnicze,
// które nie modyfikują repo. Wykrywanie jest statyczne (regexy po usunięciu cytatów i treści heredoców), więc
// to bariera przed odruchem, nie sandbox: nie zastępuje przeglądu kodu.
//
// Testy: .claude/hooks/block-file-writes.test.js (uruchamiane w CI, job `test`).
'use strict';

const REFERENCE =
  'Reguła 7 (CLAUDE.md): pliki edytujesz WYŁĄCZNIE narzędziami Write/Edit - także zamiast sed -i, perl -i, ' +
  'skryptów Python/Node, tee i przekierowań > / >>. Powłoka służy do uruchamiania poleceń, nie do zapisywania treści plików. ' +
  'Pliki tymczasowe zapisuj w katalogu tymczasowym (/tmp, $TMPDIR, scratchpad).';

// Cel zapisu uznawany za tymczasowy (nie modyfikuje repo).
const TEMP_TARGET =
  /^(\/dev\/(null|stderr|stdout|tty)|nul|\$null|\/tmp\/|\/var\/tmp\/|\$\{?TMPDIR\}?\/|\$env:(temp|tmp)\b|%temp%|%tmp%|.*[\\/](appdata[\\/]local[\\/]temp|temp|tmp)[\\/])/i;

function isTempTarget(target) {
  return TEMP_TARGET.test(target.replace(/^["']|["']$/g, ''));
}

// Wycina treść heredoców (zwraca też same treści) oraz zawartość cytatów - do skanowania operatorów.
function splitHeredocs(command) {
  const lines = command.split(/\r?\n/);
  const kept = [];
  const bodies = [];
  let terminator = null;
  let body = [];
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) {
        bodies.push(body.join('\n'));
        terminator = null;
        body = [];
        kept.push(line);
      } else {
        body.push(line);
      }
      continue;
    }
    kept.push(line);
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (match) {
      terminator = match[2];
    }
  }
  if (terminator !== null) {
    bodies.push(body.join('\n'));
  }
  return { withoutBodies: kept.join('\n'), bodies };
}

function stripQuotes(text) {
  return text.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const PY_WRITE =
  /open\s*\(|\.write\s*\(|write_text|write_bytes|shutil\.|os\.(remove|rename|replace|unlink|makedirs|mkdir|rmdir|truncate)|pathlib|\.unlink\s*\(|\.rename\s*\(|\.touch\s*\(|fileinput/;
// Tylko operacje ZAPISU/usuwania (sam odczyt przez fs - np. czytanie package.json w node -e - jest dozwolony).
const NODE_WRITE =
  /writeFile|appendFile|createWriteStream|\.(rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|truncateSync|rmdirSync|cpSync)\b|\bfs(\.promises)?\.(rm|unlink|rename|copyFile|mkdir|truncate|rmdir|cp)\b|\bfsp?\.(rm|unlink|rename|copyFile|mkdir|truncate|rmdir|cp)\(/;

/**
 * @param {string} command polecenie z narzędzia Bash albo PowerShell
 * @param {'Bash'|'PowerShell'} tool
 * @returns {{blocked: boolean, reason?: string}}
 */
function checkCommand(command, tool = 'Bash') {
  if (typeof command !== 'string' || command.trim() === '') {
    return { blocked: false };
  }
  const { withoutBodies, bodies } = splitHeredocs(command);
  // Cel przekierowania w cudzysłowie (> "C:\...\Temp\x.txt"): oceniamy go PRZED usunięciem cytatów.
  const withQuotedTargets = withoutBodies.replace(/(>>?)\s*(?:"([^"]*)"|'([^']*)')/g, (_m, op, dq, sq) => {
    const target = dq !== undefined ? dq : sq;
    return `${op}${isTempTarget(target) ? '/dev/null' : 'CYTOWANY_PLIK_W_REPO'}`;
  });
  const scan = stripQuotes(withQuotedTargets);

  if (tool === 'PowerShell') {
    const psWrite =
      /\b(Set-Content|Add-Content|Out-File|Tee-Object|Clear-Content)\b|\[(System\.)?IO\.File\]::(Write|Append|Create|Delete|Move|Copy|Replace)/i;
    if (psWrite.test(scan) && !isAllTempPs(scan)) {
      return { blocked: true, reason: 'Set-Content / Add-Content / Out-File / [IO.File]::Write modyfikują pliki.' };
    }
  } else {
    // sed -i / --in-place (także -Ei, -i.bak)
    if (/(^|[\s;&|(])sed\s+(?:[^|;&\n]*?\s)?(-[A-Za-z]*i[A-Za-z]*(\.\S*)?|--in-place(=\S*)?)(?=\s|$)/.test(scan)) {
      return { blocked: true, reason: 'sed -i / --in-place edytuje pliki w miejscu.' };
    }
    // perl -i / -pi -e
    if (/(^|[\s;&|(])perl\s+(?:[^|;&\n]*?\s)?-[A-Za-z]*i[A-Za-z]*(\.\S*)?(?=\s|$)/.test(scan)) {
      return { blocked: true, reason: 'perl -i edytuje pliki w miejscu.' };
    }
    // python/python3/py: kod inline (-c, heredoc, stdin) zapisujący pliki
    if (/(^|[\s;&|(])(python3?|py)(\.exe)?\s+(?:-[\w-]+\s+)*(-c\b|-(\s|$)|<<)/.test(scan) || /(^|[\s;&|(])(python3?|py)(\.exe)?\s*<<-?/.test(scan)) {
      if (PY_WRITE.test(command)) {
        return { blocked: true, reason: 'skrypt Python uruchomiony z powłoki (-c / heredoc) zapisuje pliki.' };
      }
    }
    // node -e / --eval / -p / stdin: kod inline używający fs
    if (/(^|[\s;&|(])node(\.exe)?\s+(?:--?[\w-]+(=\S+)?\s+)*(-e\b|--eval\b|-p\b|--print\b|-(\s|$)|<<)/.test(scan) || /(^|[\s;&|(])node(\.exe)?\s*<<-?/.test(scan)) {
      if (NODE_WRITE.test(command)) {
        return { blocked: true, reason: 'skrypt Node uruchomiony z powłoki (-e / heredoc) zapisuje pliki.' };
      }
    }
    // tee z plikiem docelowym
    for (const segment of scan.split(/[|;&\n]+/)) {
      const tee = /^\s*(?:sudo\s+)?tee\b(.*)$/.exec(segment);
      if (tee) {
        const targets = tee[1].split(/\s+/).filter((token) => token && !token.startsWith('-'));
        if (targets.some((target) => !isTempTarget(target))) {
          return { blocked: true, reason: 'tee zapisuje do pliku.' };
        }
      }
    }
  }

  // Przekierowania > i >> do plików (poza tymczasowymi). Pomija 2>&1, >&2, &>/dev/null i cytaty/heredocy.
  const redirect = /(?<![=\-<>])(?:\d*|&)(>>?)(?![>&(])\s*([^\s;&|<>()]+)/g;
  let match;
  while ((match = redirect.exec(scan)) !== null) {
    const target = match[2];
    if (!isTempTarget(target)) {
      return { blocked: true, reason: `przekierowanie ${match[1]} do pliku "${target}".` };
    }
  }

  void bodies;
  return { blocked: false };
}

// PowerShell: dozwolone tylko, gdy KAŻDY zapis idzie do celu tymczasowego ($env:TEMP, $null...).
function isAllTempPs(scan) {
  const matches = [...scan.matchAll(/(?:Set-Content|Add-Content|Out-File|Tee-Object)\b[^|;\n]*/gi)];
  if (matches.length === 0) {
    return false;
  }
  return matches.every((m) => /(\$env:(temp|tmp)|[\\/]temp[\\/]|[\\/]tmp[\\/]|\$null)/i.test(m[0]));
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
      process.stderr.write('block-file-writes: nie udało się odczytać wejścia hooka, polecenie przepuszczone.\n');
      process.exit(0);
    }
    const tool = payload.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    const result = checkCommand(payload.tool_input && payload.tool_input.command, tool);
    if (result.blocked) {
      process.stderr.write(`ODMOWA: polecenie modyfikuje pliki z powłoki (${result.reason}) ${REFERENCE}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { checkCommand, REFERENCE };
