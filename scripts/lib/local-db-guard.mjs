// Blokada uruchomienia skryptów i testów na nielokalnej bazie albo nielokalnym Redisie (B-140, B-141). Skrypty e2e (scripts/e2e-*.mjs,
// screenshot-module.mjs) i testy e2e API (`npm run test:e2e --workspace=apps/api`) tworzą i usuwają organizacje, użytkowników i kursy
// przez Prisma (DATABASE_URL), API łączy się rolą aplikacyjną (DATABASE_URL_APP) i pisze do Redisa klucze limitów, cache i kolejek
// (REDIS_URL) - adres inny niż lokalny albo kontener testowy CI oznaczałby zapis i kasowanie w cudzych danych. Celowo BEZ flagi
// „wymuś”: jedyna droga to lokalne adresy.
// Test: scripts/content/src/local-db-guard.test.ts (krok CI „Testy scripts/content”).

// Hosty uznawane za lokalne: pętla zwrotna albo kontenery repliki CI (`ci-pg`, `ci-redis` - CLAUDE.md reguła 9). Job e2e w GitHub
// Actions łączy się przez localhost. Nazwy usług docker compose (np. `postgres`, `redis`) NIE są tu dopuszczone - w sieci compose na
// serwerze to usługi produkcyjne. Tunelu do zdalnej usługi wystawionego na localhost nie da się rozpoznać po hoście (ryzyko resztkowe).
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];
export const LOCAL_DATABASE_HOSTS = [...LOOPBACK_HOSTS, 'ci-pg'];
export const LOCAL_REDIS_HOSTS = [...LOOPBACK_HOSTS, 'ci-redis'];

// Sprawdzane zmienne: skrypty (Prisma), uruchamiane z nich API (rola aplikacyjna) i Redis API. Skrypt, który pisze do bazy, wymaga
// WSZYSTKICH w środowisku procesu: API (ConfigModule) dociąga brakujące zmienne z pliku .env w katalogu uruchomienia, więc nieustawiona
// zmienna mogłaby przyjść stamtąd z nielokalnym adresem, poza tą kontrolą.
const CHECKED_VARIABLES = [
  { name: 'DATABASE_URL', protocol: /^postgres(ql)?:$/, hosts: LOCAL_DATABASE_HOSTS, what: 'bazy' },
  { name: 'DATABASE_URL_APP', protocol: /^postgres(ql)?:$/, hosts: LOCAL_DATABASE_HOSTS, what: 'bazy' },
  { name: 'REDIS_URL', protocol: /^rediss?:$/, hosts: LOCAL_REDIS_HOSTS, what: 'Redisa' },
];
/** Nazwy zmiennych objętych blokadą (adresy bazy i Redisa). */
export const GUARDED_VARIABLES = CHECKED_VARIABLES.map((variable) => variable.name);

/**
 * Host z adresu albo null, gdy adresu nie da się jednoznacznie odczytać (wtedy traktujemy go jak nielokalny, a komunikat nie podaje
 * hosta). Niejednoznaczne są m.in.: więcej niż jedno `@` albo `/`, `?`, `#` w loginie/haśle (niezakodowane hasło - parser wziąłby jego
 * fragment za hosta), parametr zapytania zaczynający się od `host` (`host`, `hostaddr` - nadpisanie hosta, gniazdo uniksowe), lista
 * hostów, inny protokół niż oczekiwany.
 */
function urlHost(url, protocol) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  const raw = url.trim();
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd === -1) return null;
  const rest = raw.slice(schemeEnd + 3);
  const ats = raw.split('@').length - 1;
  if (ats > 1) return null;
  if (ats === 1 && /[/?#]/.test(rest.slice(0, rest.indexOf('@')))) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!protocol.test(parsed.protocol)) return null;
  for (const key of parsed.searchParams.keys()) if (/^host/i.test(key)) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === '' || host.includes(',') ? null : host;
}

/** Host bazy z adresu Postgresa (null = niejednoznaczny). */
export const databaseHost = (url) => urlHost(url, /^postgres(ql)?:$/);
/** Host Redisa z adresu redis:// albo rediss:// (null = niejednoznaczny). */
export const redisHost = (url) => urlHost(url, /^rediss?:$/);

/**
 * Lista powodów odmowy (pusta = wolno). `required: true` - wszystkie zmienne muszą być ustawione (skrypty i testy, które piszą do bazy
 * i startują API); `required: false` - skrypt bazy nie używa (layout-check), ale ustawiony adres nielokalny i tak blokuje start.
 * Komunikaty nie zawierają adresów (login i hasło są ich częścią) - tylko nazwę zmiennej i jednoznacznie odczytanego hosta.
 */
export function databaseProblems(env, { required = true } = {}) {
  const problems = [];
  for (const { name, protocol, hosts, what } of CHECKED_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === '') {
      if (required) problems.push(`${name} nie jest ustawiony`);
      continue;
    }
    const host = urlHost(value, protocol);
    if (host === null) problems.push(`${name}: nie da się jednoznacznie odczytać hosta ${what} z adresu`);
    else if (!hosts.includes(host)) problems.push(`${name} wskazuje na host "${host}"`);
  }
  return problems;
}

/** Treść komunikatu odmowy (bez adresów). */
export function refusalMessage(subject, problems) {
  return [
    `ODMOWA: ${subject} nie uruchomi się w tym środowisku - ${problems.join('; ')}.`,
    `Skrypty i testy e2e tworzą i usuwają dane, więc działają wyłącznie na lokalnej bazie i lokalnym Redisie albo w kontenerach`,
    `testowych CI (baza: ${LOCAL_DATABASE_HOSTS.join(', ')}; Redis: ${LOCAL_REDIS_HOSTS.join(', ')}).`,
    `Ustaw DATABASE_URL, DATABASE_URL_APP i REDIS_URL na lokalne usługi (np. \`npx dotenv -e .env -- node <skrypt>\` z plikiem .env`,
    `do pracy lokalnej) i uruchom ponownie. Tej blokady nie da się wyłączyć flagą.`,
  ].join('\n');
}

/** Kończy proces kodem 1 z czytelnym komunikatem, gdy baza albo Redis nie są lokalne. Wołać na samym początku skryptu. */
export function assertLocalDatabase(subject, { env = process.env, required = true, exit = (code) => process.exit(code), log = console.error } = {}) {
  const problems = databaseProblems(env, { required });
  if (problems.length === 0) return;
  log(refusalMessage(subject, problems));
  exit(1);
}
