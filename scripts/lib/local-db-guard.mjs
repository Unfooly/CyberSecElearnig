// Blokada uruchomienia skryptów testowych na nielokalnej bazie (B-140). Skrypty e2e (scripts/e2e-*.mjs, screenshot-module.mjs) tworzą i
// usuwają organizacje, użytkowników i kursy przez Prisma, a API, które startują, dziedziczy te same zmienne - baza inna niż lokalna albo
// kontener testowy CI oznaczałaby zapis i kasowanie w cudzych danych. Celowo BEZ flagi „wymuś”: jedyna droga to lokalny adres bazy.
// Test: scripts/content/src/local-db-guard.test.ts (krok CI „Testy scripts/content”).

// Host bazy uznawany za lokalny: pętla zwrotna albo kontener Postgresa repliki CI (`ci-pg`, CLAUDE.md reguła 9). Job e2e w GitHub Actions
// łączy się przez localhost. Nazwy usług docker compose (np. `postgres`) NIE są tu dopuszczone - w sieci compose na serwerze to baza
// produkcyjna.
export const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1', 'ci-pg'];

// Zmienne z adresem bazy używane przez skrypty (Prisma) i przez uruchamiane z nich API (rola aplikacyjna).
export const DATABASE_URL_VARIABLES = ['DATABASE_URL', 'DATABASE_URL_APP'];

/**
 * Host z adresu bazy albo null, gdy adresu nie da się jednoznacznie odczytać (wtedy traktujemy go jak nielokalny).
 * Parametr `host` w zapytaniu (np. gniazdo uniksowe albo nadpisanie hosta) też jest nierozpoznany - odmowa.
 */
export function databaseHost(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;
  if (parsed.searchParams.has('host')) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === '' ? null : host;
}

/**
 * Lista powodów odmowy (pusta = wolno). `required: true` - DATABASE_URL musi być ustawiony (skrypty, które same piszą do bazy);
 * `required: false` - skrypt bazy nie używa (layout-check), ale ustawiony adres nielokalny i tak blokuje start.
 * Komunikaty nie zawierają adresu bazy (login i hasło są jego częścią) - tylko nazwę zmiennej i hosta.
 */
export function databaseProblems(env, { required = true } = {}) {
  const problems = [];
  for (const name of DATABASE_URL_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === '') {
      if (required && name === 'DATABASE_URL') problems.push(`${name} nie jest ustawiony`);
      continue;
    }
    const host = databaseHost(value);
    if (host === null) problems.push(`${name}: nie da się odczytać hosta bazy z adresu`);
    else if (!LOCAL_DATABASE_HOSTS.includes(host)) problems.push(`${name} wskazuje na host "${host}"`);
  }
  return problems;
}

/** Kończy proces kodem 1 z czytelnym komunikatem, gdy baza nie jest lokalna. Wołać na samym początku skryptu. */
export function assertLocalDatabase(scriptName, { env = process.env, required = true, exit = (code) => process.exit(code), log = console.error } = {}) {
  const problems = databaseProblems(env, { required });
  if (problems.length === 0) return;
  log(
    [
      `ODMOWA: ${scriptName} nie uruchomi się na tej bazie - ${problems.join('; ')}.`,
      `Skrypty testowe (e2e tworzą i usuwają dane) działają wyłącznie na bazie lokalnej albo w kontenerze testowym CI`,
      `(dozwolone hosty: ${LOCAL_DATABASE_HOSTS.join(', ')}). Ustaw DATABASE_URL i DATABASE_URL_APP na lokalnego Postgresa`,
      `(np. plik .env do pracy lokalnej) i uruchom ponownie. Tej blokady nie da się wyłączyć flagą.`,
    ].join('\n'),
  );
  exit(1);
}
