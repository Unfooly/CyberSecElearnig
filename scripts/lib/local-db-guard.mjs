// Blokada uruchomienia skryptów testowych na nielokalnej bazie (B-140). Skrypty e2e (scripts/e2e-*.mjs, screenshot-module.mjs) tworzą i
// usuwają organizacje, użytkowników i kursy przez Prisma (DATABASE_URL), a API, które startują, łączy się rolą aplikacyjną
// (DATABASE_URL_APP) - baza inna niż lokalna albo kontener testowy CI oznaczałaby zapis i kasowanie w cudzych danych. Celowo BEZ flagi
// „wymuś”: jedyna droga to lokalny adres bazy.
// Test: scripts/content/src/local-db-guard.test.ts (krok CI „Testy scripts/content”).

// Host bazy uznawany za lokalny: pętla zwrotna albo kontener Postgresa repliki CI (`ci-pg`, CLAUDE.md reguła 9). Job e2e w GitHub Actions
// łączy się przez localhost. Nazwy usług docker compose (np. `postgres`) NIE są tu dopuszczone - w sieci compose na serwerze to baza
// produkcyjna. Tunelu do zdalnej bazy wystawionego na localhost nie da się rozpoznać po hoście (ryzyko resztkowe).
export const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1', 'ci-pg'];

// Zmienne z adresem bazy: skrypty (Prisma) i uruchamiane z nich API (rola aplikacyjna). Skrypt, który pisze do bazy, wymaga OBU w
// środowisku procesu: API (ConfigModule) dociąga brakujące zmienne z pliku .env w katalogu uruchomienia, więc nieustawiony
// DATABASE_URL_APP mógłby przyjść stamtąd z nielokalnym adresem, poza tą kontrolą.
export const DATABASE_URL_VARIABLES = ['DATABASE_URL', 'DATABASE_URL_APP'];

/**
 * Host z adresu bazy albo null, gdy adresu nie da się jednoznacznie odczytać (wtedy traktujemy go jak nielokalny, a komunikat nie
 * podaje hosta). Niejednoznaczne są m.in.: więcej niż jedno `@` albo `/`, `?`, `#` w loginie/haśle (niezakodowane hasło - parser
 * wziąłby jego fragment za hosta), parametr zapytania zaczynający się od `host` (`host`, `hostaddr` - nadpisanie hosta, gniazdo
 * uniksowe), inny protokół niż postgres.
 */
export function databaseHost(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  const raw = url.trim();
  const rest = raw.slice(raw.indexOf('://') + 3);
  const ats = raw.split('@').length - 1;
  if (ats > 1) return null;
  if (ats === 1 && /[/?#]/.test(rest.slice(0, rest.indexOf('@')))) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;
  for (const key of parsed.searchParams.keys()) if (/^host/i.test(key)) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // Lista hostów (`host1,host2` w stylu libpq) też jest niejednoznaczna.
  return host === '' || host.includes(',') ? null : host;
}

/**
 * Lista powodów odmowy (pusta = wolno). `required: true` - obie zmienne muszą być ustawione (skrypty, które piszą do bazy i startują
 * API); `required: false` - skrypt bazy nie używa (layout-check), ale ustawiony adres nielokalny i tak blokuje start.
 * Komunikaty nie zawierają adresu bazy (login i hasło są jego częścią) - tylko nazwę zmiennej i jednoznacznie odczytanego hosta.
 */
export function databaseProblems(env, { required = true } = {}) {
  const problems = [];
  for (const name of DATABASE_URL_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === '') {
      if (required) problems.push(`${name} nie jest ustawiony`);
      continue;
    }
    const host = databaseHost(value);
    if (host === null) problems.push(`${name}: nie da się jednoznacznie odczytać hosta bazy z adresu`);
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
      `(np. \`npx dotenv -e .env -- node ${scriptName}\` z plikiem .env do pracy lokalnej) i uruchom ponownie.`,
      `Tej blokady nie da się wyłączyć flagą.`,
    ].join('\n'),
  );
  exit(1);
}
