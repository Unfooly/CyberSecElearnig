import RE2 from 're2';

// Wzorce odpowiedzi tekstowych (TEXT_INPUT_GUIDED) dopasowujemy silnikiem RE2 (czas liniowy względem długości wejścia, bez nawrotu),
// więc żaden wzorzec z treści nie zawiesi procesu API (ReDoS). TEN SAM silnik służy walidacji modułu i dopasowaniu odpowiedzi w API:
// "przeszło walidację" znaczy "da się dopasować". Składnia jest ograniczona do tego, co RE2 obsługuje (bez backreferencji i
// lookahead/lookbehind). Kod tylko dla Node (natywny moduł) - dlatego jest w `@cyberszkolo/content/dist/node`, nie w indeksie.

/** Rdzeń wzorca bez zewnętrznych ^ i $ (dopasowanie opakowujemy w ^(?:...)$, więc alternatywy najwyższego poziomu nie omijają kotwic). */
export function anchoredRegexCore(pattern: string): string {
  return pattern.slice(1, -1);
}

function endsWithUnescapedDollar(pattern: string): boolean {
  if (!pattern.endsWith('$')) return false;
  let backslashes = 0;
  for (let i = pattern.length - 2; i >= 0 && pattern[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

// Limit liczy wpisy, nie pamięć natywną (RE2 ma domyślny limit ok. 8 MB na wzorzec; zbyt duże wzorce, np. ^(\pL{1000}){1}$, kompilator
// odrzuca "pattern too large", więc walidacja = mieści się w limicie). Realnie wzorców jest tyle, ile regexów we wczytanej treści.
const CACHE_LIMIT = 500;
const cache = new Map<string, RE2>();

/** Kompiluje wzorzec odpowiedzi (całe dopasowanie, unicode, domyślnie bez rozróżniania wielkości liter). Rzuca, gdy RE2 go nie przyjmuje. */
export function compileAnswerRegex(pattern: string, caseSensitive = false): RE2 {
  const key = `${caseSensitive ? 's' : 'i'}:${pattern}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const compiled = new RE2(`^(?:${anchoredRegexCore(pattern)})$`, caseSensitive ? 'u' : 'iu');
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, compiled);
  return compiled;
}

/** Błędy wzorca odpowiedzi tekstowej (pusta lista = OK): kotwice ^...$ oraz kompilacja w RE2 z czytelnym komunikatem dla autora. */
export function validateRegex(pattern: string): string[] {
  if (!pattern.startsWith('^') || !endsWithUnescapedDollar(pattern) || pattern.length < 3) {
    return ['answer.regex: wzorzec musi być zapisany jako ^...$ (całe dopasowanie)'];
  }
  try {
    // Rdzeń kompilujemy OSOBNO, bez opakowania: wzorzec z niezbalansowanym nawiasem (np. ^a)|(b$) po sklejeniu z ^(?:...)$ daje
    // poprawne, ale INNE wyrażenie (^(?:a)|(b)$ - alternatywa najwyższego poziomu omija kotwice). Sam rdzeń takiego wzorca się nie kompiluje.
    new RE2(anchoredRegexCore(pattern), 'u');
    compileAnswerRegex(pattern, false);
    compileAnswerRegex(pattern, true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'nieznany błąd';
    return [
      `answer.regex: wzorzec nie jest obsługiwany przez silnik RE2 (czas liniowy; bez backreferencji i lookahead/lookbehind): ${reason}`,
    ];
  }
  return [];
}
