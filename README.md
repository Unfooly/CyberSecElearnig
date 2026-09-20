# Unfooly (dawniej CyberSzkoło)

Wielodostępowa (multi-tenant) platforma SaaS do szkoleń z cyberbezpieczeństwa i symulacji
phishingowych, sprzedawana firmom (B2B). Pełny kontekst projektu: [`CLAUDE.md`](./CLAUDE.md).
Nowa osoba w zespole: zacznij od [`docs/onboarding.md`](./docs/onboarding.md); decyzje i ich uzasadnienia:
[`docs/decisions.md`](./docs/decisions.md); backlog jako zgłoszenia: [`docs/backlog-issues.md`](./docs/backlog-issues.md).

## Struktura repo

```
/apps
  /api        -> NestJS backend (auth, API danych klienckich)
  /web        -> Next.js frontend (admin + panel pracownika)
/packages
  /shared     -> typy współdzielone (DTO, enumy ról)
/apps/api/prisma
  schema.prisma, migrations/
```

## Wymagania

- Node.js 20+ i npm 10+
- Docker (Postgres + Redis lokalnie przez `docker compose`)

## Uruchomienie lokalne

1. **Zmienne środowiskowe** — skopiuj przykładowe pliki i uzupełnij sekrety:

   ```bash
   cp .env.example .env
   cp .env.test.example .env.test
   ```

   `.env` jest używany przez backend w trybie dev (`start:dev`, `prisma migrate`).
   `.env.test` wskazuje na osobną bazę `cyberszkolo_test`, żeby testy nigdy nie dotykały
   danych deweloperskich. **Przed pierwszym `docker compose up`** wygeneruj losową wartość
   `APP_DB_PASSWORD` (np. `openssl rand -hex 24`) i wpisz ją zarówno do `.env`, jak i do
   `.env.test` — dev i test dzielą jeden kontener Postgresa, a rola jest obiektem na
   poziomie klastra, więc musi być to samo hasło w obu plikach. Podstaw je też w
   `DATABASE_URL_APP` w obu plikach (ten sam sekret w dwóch zmiennych, patrz komentarze
   w `.env.example`).

2. **Postgres + Redis:**

   ```bash
   docker compose up -d
   ```

   Przy pierwszym starcie (pusty wolumen) `docker/postgres-init/01-create-app-role.sh`
   automatycznie tworzy rolę `cyberszkolo_app` z hasłem z `APP_DB_PASSWORD`. Jeśli
   wolumen już istniał wcześniej (skrypty init odpalają się tylko raz, przy inicjalizacji
   klastra), stwórz rolę ręcznie tym samym poleceniem co skrypt:

   ```bash
   docker exec -e APP_DB_PASSWORD="<wartość z .env>" cyberszkolo-postgres sh -c '
     psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "
       CREATE ROLE cyberszkolo_app LOGIN PASSWORD '"'"'${APP_DB_PASSWORD}'"'"'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;"
   '
   ```

3. **Baza testowa** (jednorazowo, jeśli jeszcze nie istnieje):

   ```bash
   docker exec cyberszkolo-postgres createdb -U cyberszkolo cyberszkolo_test
   ```

4. **Zależności** (instaluje wszystkie workspace'y i buduje `packages/shared`):

   ```bash
   npm install
   ```

5. **Migracje bazy danych** (dev + test):

   ```bash
   npm run prisma:migrate --workspace=apps/api
   npx dotenv -e .env.test -- npm run prisma:deploy --workspace=apps/api
   ```

5a. **Seed odznak** (moduł grywalizacji — `badges` to katalog danych administracyjnych, nie
    schemat, więc nie jest częścią migracji; idempotentny, bezpieczny do wielokrotnego
    uruchomienia po dodaniu nowej odznaki):

   ```bash
   npm run seed:badges --workspace=apps/api
   ```

6. **Backend:**

   ```bash
   npm run dev:api
   # albo: npm run start:dev --workspace=apps/api
   ```

   API startuje na `http://localhost:3001`.

7. **Frontend:**

   ```bash
   npm run dev:web
   # albo: npm run dev --workspace=apps/web
   ```

### Konto demo w bazie dev (`cyberszkolo`, localhost:5432)

Baza dev zawiera dane demo używane do zrzutów ekranu rebrandingu (działy IT/Finanse/HR/Sprzedaż,
kilku pracowników, przypisania kursów). Logowanie administratora demo: `admin@demo.test` /
`Demo12345!x` (tylko lokalny dev - to NIE jest hasło do żadnego środowiska współdzielonego).
Hasło tego konta zostało nadpisane bez zachowania poprzedniego hashu, więc nie da się go przywrócić - obowiązuje powyższe.
Konta demo dla każdej roli (to samo hasło `Demo12345!x`, ta sama organizacja co `admin@demo.test`):
`super-admin@demo.test`, `manager@demo.test`, `employee@demo.test`. Tworzy je (idempotentnie, tylko dev)
`cd apps/api && npx dotenv -e ../../.env -- npx ts-node prisma/seed-dev-roles.ts`. Weryfikacja stron
startowych na działającej aplikacji (prawdziwy formularz logowania, Playwright):
`BASE=http://localhost:3010 node scripts/verify-role-redirects.mjs`.
Zrzuty ekranu: `node docs/brand/screens/shoot.mjs <etap>` i `shoot-auth.mjs <etap>` (Playwright,
`BASE` = adres web, domyślnie http://localhost:3010).

## Strona główna (`/`) i formularz "Umów demo"

- Landing: `apps/web/src/app/_landing/` (sekcje wg `docs/brand/landing/index.html`). Zalogowani (obecny
  refresh token) są przekierowani: ORG_ADMIN → `/dashboard`, pozostali → `/courses`.
- **Do uzupełnienia:** ceny w `apps/web/src/lib/landing-config.ts` (`[CENA]`, `[KWOTA]`) oraz
  zmienna `SALES_EMAIL` w `.env` API - adres, na który trafiają zgłoszenia. Bez niej
  `POST /demo-requests` zwraca 503, a formularz pokazuje komunikat o niedostępności.
- `POST /demo-requests` jest publiczny (bez JWT, bez bazy): limit 3 żądania/min na IP (in-memory,
  jak reszta throttlera), pułapka na boty (`website`), wysyłka szablonem `demo-request`.
- `SITE_URL` (web, opcjonalne) - publiczny adres do metadanych OG/canonical; domyślnie `FRONTEND_URL`.
- Strony "Bezpieczeństwo" i "Polityka prywatności" z mockupu nie istnieją - w stopce ich nie linkujemy
  (do zrobienia przed publicznym startem, wymóg RODO).

## Komendy

```bash
# backend
npm run test --workspace=apps/api        # testy jednostkowe
npm run test:e2e --workspace=apps/api    # testy e2e (auth, izolacja tenantów) — wymaga .env.test
npm run lint --workspace=apps/api

# frontend
npm run test --workspace=apps/web
npm run lint --workspace=apps/web

# baza danych (z apps/api, żeby Prisma znalazła schema.prisma)
npm run prisma:migrate --workspace=apps/api
npm run prisma:generate --workspace=apps/api
```

## Wdrożenie produkcyjne

Docker Compose (`docker-compose.prod.yml`). Punkt wejścia z zewnątrz: **Cloudflare Tunnel** (usługa
`cloudflared`, profil `tunnel`, żadnych otwartych portów na VPS - krok po kroku w
`docs/deploy-test.md`, wzór zmiennych w `.env.prod.example`) albo alternatywnie Caddy (profil `caddy`,
Let's Encrypt). Zakłada VPS Ubuntu 24.04 z zainstalowanym Dockerem —
minimalny sensowny rozmiar to 1GB RAM (zmierzone lokalnie: wszystkie cztery kontenery
`postgres`+`redis`+`api`+`web` w spoczynku, tuż po starcie, zużywają razem ok. 125MB —
zostaje spory margines na Caddy i realny ruch, ale warto to monitorować po pierwszym
wdrożeniu, nie tylko ufać temu pomiarowi).

### 1. Sekrety — `.env.prod` obok `docker-compose.prod.yml`

`apps/api/Dockerfile` i `apps/web/Dockerfile` **nie zawierają żadnych sekretów** — trafiają do
kontenerów wyłącznie w runtime przez `env_file: ${ENV_FILE:-.env.prod}` w `docker-compose.prod.yml`
(patrz `.dockerignore` — `.env*` nigdy nie wchodzi do kontekstu builda). **`.env.prod` jest jedynym
plikiem konfiguracji na VPS** (dev-owy `.env` nie jest tam czytany) i podajesz go compose także flagą
`--env-file .env.prod` (interpolacja `${...}`), więc każde polecenie ma postać
`docker compose --env-file .env.prod -f docker-compose.prod.yml ...` (szczegóły i skrót przez
`COMPOSE_ENV_FILES`: `docs/deploy-test.md`). Punktem startowym jest `.env.prod.example`
(zawiera wszystkie poniższe zmienne); **na produkcji trzeba zmienić więcej niż tylko wartości
względem dev-owego `.env.example`**:

| Zmienna | Względem `.env.example` | Wartość na produkcji |
|---|---|---|
| `POSTGRES_PASSWORD` | **Nowa** — nie istnieje w `.env.example` (dev ma ją zahardkodowaną w `docker-compose.yml`) | Losowy sekret (`openssl rand -hex 24`) |
| `API_URL` | **Nowa** — nie istnieje wcale w `.env.example` (dev korzysta z domyślnego fallbacku `localhost:3001` w kodzie) | `http://api:3001` — nazwa usługi Dockera, NIE `localhost` (`apps/web` woła `apps/api` przez wewnętrzną sieć compose) |
| `DATABASE_URL` | Istnieje, zmień host | `postgresql://cyberszkolo:<POSTGRES_PASSWORD>@postgres:5432/cyberszkolo?schema=public` |
| `DATABASE_URL_APP` | Istnieje, zmień host | `postgresql://cyberszkolo_app:<APP_DB_PASSWORD>@postgres:5432/cyberszkolo?schema=public&connection_limit=10` (jawny `connection_limit`: domyślnie Prisma bierze 2 x liczba rdzeni + 1, więc pula zależy od maszyny; transakcje czekające na blokadę doradczą trzymają połączenie) |
| `REDIS_URL` | Istnieje, zmień host | `redis://redis:6379` |
| `APP_DB_PASSWORD` | Istnieje | Losowy sekret — **ten sam** ciąg musi pojawić się dosłownie w `DATABASE_URL_APP` (patrz niżej) |
| `FRONTEND_URL` | Istnieje | Prawdziwa publiczna domena z `Caddyfile` (np. `https://twoja-domena.pl`) — trafia do linków w mailach klikanych przez userów w przeglądarce, więc **nie** nazwa usługi Dockera |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Istnieje | Losowe sekrety, różne od dev |
| `MAILERSEND_API_TOKEN` | Istnieje | **Ustaw naprawdę na produkcji.** Pusty token = `EmailService` loguje treść maila (w tym surowy token resetu hasła) do konsoli kontenera zamiast wysyłać — akceptowalne w dev, ale w logach produkcyjnych to wyciek sekretu równoważnego jednorazowemu hasłu (patrz "Backlog bezpieczeństwa modułu auth" niżej) |
| `EMAIL_FROM`, `PHISHING_EMAIL_DOMAIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Istnieje | Jak w `.env.example`, uzupełnij gdy te funkcje będą używane |

`env_file` w Docker Compose **nie podstawia** `${...}` wewnątrz samego pliku — hasła trzeba
wpisać dosłownie w dwóch miejscach (raz jako osobna zmienna, raz wklejone do `DATABASE_URL*`),
dokładnie jak już działa to w `.env.example` dla dev.

### 2. Domena

Podmień `twoja-domena.pl` w `Caddyfile` na prawdziwą domenę (dwa wystąpienia — główna domena
dla `web` i `api.twoja-domena.pl` dla `api`), z DNS wskazującym na IP VPS-a, zanim uruchomisz
Caddy — inaczej Let's Encrypt nie zweryfikuje domeny.

### 3. Obrazy z GHCR i start

Obrazy `api` i `web` **nie są budowane na VPS** (1 GB RAM: `next build` kończy się OOM) - buduje je
GitHub Actions (`.github/workflows/build-images.yml`, po zielonych lint + testach) i wypycha do
`ghcr.io/unfooly/cybersecelearnig-api` oraz `-web` (nazwa z `github.repository_owner`, tagi `latest` i `sha-<short>`). VPS loguje się do GHCR
tokenem **tylko `read:packages`** (nigdy PAT z szerszymi uprawnieniami) i robi `pull`:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Migracje Prisma (`prisma migrate deploy`) to **osobny, jednorazowy krok**: usługa `migrate` (ten sam obraz
co `api`, rola migracyjna z `DATABASE_URL`) kończy się kodem 0, a `api` startuje dopiero po jej sukcesie
(`service_completed_successfully`). Błąd migracji zatrzymuje wdrożenie, a restart samego `api` nie dotyka
schematu. `migrate deploy` bierze advisory lock w Postgresie, więc jest bezpieczny także przy równoległym
starcie. **Uwaga:** `up -d --no-deps api` pomija ten krok. Pełna procedura (logowanie do GHCR, tworzenie
tokenu, wycofanie przez `IMAGE_TAG`): `docs/deploy-test.md`. Lokalny test obrazów budowanych na miejscu:
`docker-compose.prodlocal.yml`.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs migrate   # czy migracje przeszły
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

### 4. Obrazy — multi-stage, dlaczego są małe

- **`apps/api/Dockerfile`**: etap builda instaluje `python3`/`make`/`g++` (kompilacja `bcrypt`,
  natywny moduł) i buduje `nest build` + `prisma generate`, potem `npm prune --omit=dev` usuwa
  devDependencies z tego samego drzewa `node_modules` (bez ponownej instalacji — natywnie
  skompilowany `bcrypt` przetrwa). Etap produkcyjny kopiuje wyłącznie spakowany `node_modules`,
  `dist/` i `prisma/` (migracje potrzebne usłudze `migrate`) — zmierzony rozmiar obrazu:
  ~405MB. `prisma` (CLI) jest celowo w `dependencies`, nie `devDependencies` — potrzebny w
  runtime do `migrate deploy`.
- **`apps/web/Dockerfile`**: `next.config.mjs` ma `output: 'standalone'` — Next.js sam śledzi
  i kopiuje tylko realnie potrzebne zależności do `.next/standalone`, zamiast pełnego
  `node_modules`. W monorepo (npm workspaces) wymaga `experimental.outputFileTracingRoot`
  wskazującego na root repo, inaczej gubi pakiety hoistowane poza `apps/web` (np.
  `@cyberszkolo/shared`) — zmierzony rozmiar obrazu: ~224MB.
- Oba Dockerfile'e budują **tylko** manifesty (`package.json`) potrzebnych sobie workspace'ów
  (`apps/api` NIE kopiuje `apps/web/package.json` i odwrotnie) — inaczej `npm ci` hoistowałby do
  wspólnego `node_modules` zależności drugiej aplikacji (np. cały Next.js do obrazu backendu).

## Backlog rejestracji firmy (samoobsługa)

Zebrane z przeglądów bezpieczeństwa i kodu całej serii „Organizacja (1-6/7)”. Do rozstrzygnięcia/zrobienia
**przed publicznym startem** (lub później, jeśli tak zaznaczono):

- ~~Pre-hijacking konta~~ - **rozwiązane w etapie 3**: rejestracja nie przyjmuje hasła; admin powstaje
  jako `INVITED` z losowym hashem zastępczym, a mail „ustaw hasło” (link 24 h do `/reset-password`)
  jednocześnie potwierdza skrzynkę. Atakujący nie zna żadnego hasła do konta ofiary.
- **Unieważnianie linku aktywacyjnego przez osoby trzecie (uciążliwość, nie przejęcie).** Nowy link
  (`register`, `resend-verification`, `forgot-password`) kasuje poprzedni nieużyty token, więc ktoś
  obcy może powtarzalnie prosić o link dla adresu ofiary i unieważniać jej ważny link 24 h. Limit:
  1 mail/skrzynka/10 min (w pamięci) + 10/min/IP. Docelowo: limiter w Redis, ewentualnie nie kasować
  tokenu, który ma jeszcze >1 h ważności.
- **Limiter maili rejestracji jest w Redisie** (`SET NX PX`, wspólny dla instancji, klucz = SHA-256 adresu bez `+tag`,
  prefiks `REDIS_KEY_PREFIX`). Awaria Redisa = fail-open z rezerwą w pamięci procesu (limit per instancja): log `error`
  raz na incydent i `info` po powrocie. Throttler żądań (`@nestjs/throttler`) nadal liczy w pamięci procesu - przy więcej
  niż jednej instancji api limity są per instancja; docelowo Redis storage (backlog).
- **Ochrona przed masowym zakładaniem organizacji.** Throttle to 10/min/IP; brak limitu globalnego,
  CAPTCHA (Turnstile/hCaptcha) i limitu niezweryfikowanych organizacji na domenę. Do tego job sprzątania
  (14 dni) zmniejsza skutek, ale nie zastępuje tych limitów. Rejestracja przetwarza też w tle maks. 50
  zadań naraz (nadmiar dostaje 503).
- **Praca w tle = błędy tylko w logu.** Rejestracja odpowiada natychmiast, a zapis i mail idą w tle
  (brak kanału czasowego enumeracji). Awaria bazy nie dociera do klienta: użytkownik nie dostaje maila i
  może spróbować ponownie. Docelowo monitoring/alert na logi „zadanie w tle (rejestracja) nie powiodło się”.
- **Kraje poza PL i numer VAT.** Rejestracja przyjmuje tylko Polskę (CHECK `country = 'PL'` w bazie, walidacja NIP z
  sumą kontrolną). Inne kraje wymagają: zdjęcia CHECK-a, walidacji VAT-ID (VIES), innych formatów kodu
  pocztowego i zmian w formularzu.
- **Pełny flow self-join pracowników.** Dziś istnieje tylko przełącznik `selfJoinEnabled` (włączany po weryfikacji
  domeny) - nic go jeszcze nie czyta. Brakuje: ekranu „dołącz do organizacji” dla adresów w zweryfikowanej domenie,
  potwierdzenia skrzynki, roli domyślnej, limitu licencji i akceptacji przez admina.
- **Planowane (nie budować przed decyzją):** SSO Microsoft (Entra ID) jako uzupełnienie potwierdzania domeny i
  logowania; fakturowanie w Stripe z danych `organization_billing_details`.
- **Ponowna akceptacja dokumentów przy logowaniu (nie teraz).** Gdy `LEGAL_DOCUMENT_VERSION` jest nowsza niż wersja
  zaakceptowana przez użytkownika (`legal_acceptances`), po zalogowaniu trzeba pokazać ekran akceptacji nowych
  dokumentów i zablokować resztę aż do zapisania nowej zgody. Potrzebne przy każdej przyszłej zmianie regulaminu
  lub polityki; wymaga: sprawdzenia wersji w API (guard albo pole w odpowiedzi logowania), endpointu zapisu zgody,
  ekranu w `apps/web` i decyzji, kto akceptuje w imieniu organizacji (każdy użytkownik czy tylko admin).
- **Strony prawne.** `/regulamin`, `/polityka-prywatnosci`, `/bezpieczenstwo` mają placeholdery i `noindex`, a zgody
  zapisują wersję `draft-1`. Warunek startu publicznego: patrz „Checklista startu produkcyjnego” w
  `docs/deploy-test.md` i `docs/legal/privacy-policy-checklist.md`.

## Adres klienta i limity żądań (`TRUST_PROXY`)

Ruch produkcyjny: przeglądarka → Cloudflare → tunel → **web (BFF)** → api. API nie ma wystawionych portów i
widzi tylko kontener web, więc bez przekazania adresu wszyscy użytkownicy dzieliby jeden licznik throttlera.

- **`TRUST_PROXY=true`** (produkcja, `.env.prod`): web bierze adres z `CF-Connecting-IP` (fallback: pierwszy hop
  `X-Forwarded-For`), przekazuje go w `CF-Connecting-IP` do api (`apps/web/src/lib/api-fetch.ts`, także middleware
  i strony serwerowe przez `fetchJson`), a `ProxyAwareThrottlerGuard` w api liczy limity po tym adresie
  (`apps/api/src/common/client-ip.ts`; wartość musi być poprawnym IP). Express dostaje `trust proxy = 1`.
- **`TRUST_PROXY` inne niż `true`** (domyślnie, lokalnie): nagłówki są ignorowane, liczy się adres gniazda - nie da
  się podszyć IP.
- **Warunek bezpieczeństwa:** api nigdy nie wystawiamy na zewnątrz, a web ma być osiągalny wyłącznie przez tunel/proxy
  (Cloudflare nadpisuje `CF-Connecting-IP`). Inaczej przy `true` nagłówek da się podrobić i obejść limity.

## Sesje i unieważnianie tokenów (`apps/api/src/auth/sessions.service.ts`)

- **Refresh tokeny w bazie jako hash** (tabela `refresh_tokens`: `organizationId`, RLS `FORCE`, złożony FK do
  `users(organizationId, id)`; SHA-256 całego tokenu JWT, nigdy jawnie). Każdy login = nowa „rodzina” (`familyId`).
- **Rotacja przy każdym `/auth/refresh`** i wykrywanie reuse: użycie tokenu już wymienionego, po oknie łaski, unieważnia
  CAŁĄ rodzinę (401). **Okno łaski 10 s** (`REFRESH_ROTATION_GRACE_MS`) to **świadomy kompromis**: równoległe
  odświeżenia (middleware web, RSC, dwie karty) używają tego samego tokenu niemal jednocześnie, więc w oknie token
  wymieniony przed chwilą dostaje kolejny token w tej samej rodzinie zamiast wywołać wylogowanie. Cena: w tym oknie
  **replay jest możliwy** - ktoś, kto przechwycił już wymieniony token, dostanie własny ważny token, a jego gałąź
  (rotowana niezależnie, więc bez alarmu reuse) **trwa do wylogowania / „wyloguj wszędzie” / resetu hasła**. Tempo
  mnożenia gałęzi ogranicza `MAX_TOKENS_PER_GRACE_WINDOW` (3 tokeny rodziny w oknie; więcej = reuse, rodzina
  unieważniona). Po oknie obowiązuje ścisłe wykrywanie. Dodatkowo middleware `apps/web` odświeża single-flight.
- **Serializacja z unieważnieniem:** rotacja (zajęcie tokenu + zapis nowego) i unieważnienie wszystkich sesji są
  serializowane blokadą wiersza użytkownika (`FOR SHARE` w rotacji, `UPDATE users` w unieważnieniu) - token zajęty tuż
  przed resetem hasła nie wyda nowej, żywej rodziny po jego commicie.
- **Limity:** `/auth/refresh` i `/auth/logout` mają 30 żądań/min na klienta (logowanie 10/min). Zwykły logout BFF
  zwraca `sessionRevoked: false`, gdy API odmówi (429/5xx) - cookies są czyszczone, ale sesja w bazie żyje do wygaśnięcia.
- **Trasy publiczne** (`/auth/*` oprócz `logout-all`) mają `@SkipSessionCheck()` - stary, unieważniony Bearer
  doklejony przez klienta ich nie blokuje.
- **`POST /auth/logout`** (refresh token z ciasteczka, przez BFF `/api/auth/logout`) unieważnia rodzinę bieżącej sesji.
  **Zwykły logout NIE unieważnia access tokenu** - ten działa do wygaśnięcia (max 15 min); to świadomy kompromis.
- **`POST /auth/logout-all`** („Wyloguj wszędzie” w ustawieniach) i **reset hasła** ustawiają `users.sessionsRevokedAt`
  (źródło prawdy, transakcja RLS) i unieważniają wszystkie refresh tokeny, a odbicie `sessions-revoked:<userId>` w
  Redisie (TTL = `ACCESS_TOKEN_TTL_SECONDS` + zapas, z `token-config.ts`) sprawia, że globalny guard odrzuca każdy
  access token wydany wcześniej **natychmiast** (401 `SESSION_REVOKED`; jeden `GET`, bez dodatkowego zapytania do bazy).
  Kolejność: najpierw baza, potem Redis.
- **Redis padł albo klucz zniknął:** guard jest fail-open (okno do 15 min, jak bez tej funkcji), a operacja unieważnienia
  i tak się udaje (kolumna w bazie + refresh tokeny unieważnione); incydent loguje `RedisService` (error raz, info po
  powrocie). Utrata klucza bez awarii (restart bez trwałości, eviction) byłaby CICHA - dlatego prod Redis ma AOF i
  `noeviction` (`docker-compose.prod.yml`). Nie odtwarzamy kluczy z kolumny po restarcie (backlog: job/odtwarzanie).
- **Reuse a access tokeny:** wykrycie reuse unieważnia rodzinę refresh tokenów, ale nie access tokenów (żyją do 15 min);
  świadomie nie ustawiamy wtedy `sessionsRevokedAt`, żeby nie wylogowywać innych sesji użytkownika.
- **Zegary:** `sessionsRevokedAt` i `iatMs` liczą zegary instancji API (bez skew NTP porównanie jest dokładne do ms).
- **Po wdrożeniu** wszystkie dotychczasowe sesje (refresh tokeny bez rodziny) przestają działać - każdy zaloguje się raz
  ponownie.
- **Sprzątanie:** job `refresh-token-cleanup` (03:30 UTC) kasuje tokeny po terminie ważności + doba (cross-org DELETE
  przez `runCrossOrgQuery`, bypass tylko w USING - opisany wyjątek w `TenantPrismaService`).

## Zadania w tle (BullMQ, `apps/api/src/jobs/`)

Jeden worker BullMQ w procesie API (Redis z `REDIS_URL`), kolejka `maintenance`. Nowe zadanie cykliczne
(np. OVERDUE, kampanie) rejestruje się w `onModuleInit` swojego modułu przez
`JobsService.registerRecurring({ name, cron, handler })` - harmonogram to idempotentny upsert, więc wiele
instancji API nie dubluje zadań. Zadania muszą być idempotentne (retry: 3 próby, backoff 60 s).

- **Sprzątanie organizacji PENDING** (`pending-organization-cleanup`, codziennie 03:00 UTC): po 7 dniach
  jeden mail do adminów (slot `unverifiedWarningSentAt` zajmowany atomowo), po 14 dniach usunięcie
  organizacji z danymi (kaskadowo). ACTIVE nigdy nie jest ruszana. Usunięcie następuje między 14. a 15. dniem
  (bieg raz na dobę), a mail podaje datę `createdAt + 14 dni`.
- **Semantyka „co najwyżej raz”:** awaria procesu między zajęciem slotu a wysyłką gubi ostrzeżenie
  (świadomie - alternatywą są duplikaty). Błąd wysyłki do WSZYSTKICH adminów zwalnia slot (ponowienie
  następnego dnia); gdy choć jeden admin dostał mail, slot zostaje.
- **Redis niedostępny:** API startuje normalnie, start workera jest ponawiany co 30 s (błędy w logach).
- **Konfiguracja:** `BACKGROUND_JOBS_ENABLED` (domyślnie włączone poza `NODE_ENV=test`), `JOBS_QUEUE_PREFIX`
  (prefiks kluczy Redis, domyślnie `unfooly`). Zamknięcie (`SIGTERM`) dokańcza trwające zadanie (do 30 s).
- **Testy** `jobs.e2e-spec.ts` wymagają Redisa (`REDIS_URL`, domyślnie `localhost:6379`); w CI biegną w jobie `e2e` z kontenerem Redis.
  Jest kończy się czysto (bez `forceExit`): `retryStrategy` ioredis przestaje ponawiać
  połączenia po zamknięciu, a timery limitów mają `unref()`.
- **Kaskada usuwania:** nowa tabela z `organizationId` MUSI mieć `onDelete: Cascade` do `organizations`,
  inaczej sprzątanie nie usunie organizacji (błąd jest logowany, organizacja zostaje).

## Backlog bazy danych (izolacja tenantów)

- **Constrainty spoza `schema.prisma`.** Prisma nie potrafi wyrazić: partial unique index
  `organization_domains_domain_verified_key` oraz złożonego FK `users_organizationId_departmentId_fkey`
  (opcjonalna kolumna w złożonej relacji). Istnieją tylko w migracjach SQL, a `prisma migrate diff` /
  `migrate dev` pokazuje złożony FK jako „do usunięcia”. **Przy generowaniu nowej migracji przez
  `migrate dev` ręcznie usuń z niej `DROP CONSTRAINT users_organizationId_departmentId_fkey`.**
- **Kolejne constrainty SQL-only (moduł symulacji phishingowych):** złożone FK
  `phishing_template_edits_organizationId_templateId_fkey` i `..._organizationId_actorUserId_fkey` z
  `ON DELETE SET NULL (kolumna)` (PostgreSQL 15+; Prisma nie wyraża) oraz CHECK-i na `phishing_templates`.
  `prisma migrate dev` pokaże te FK jako „do usunięcia” - usuń takie linie z nowej migracji.
- **Zwykłe FK na `users(id)` bez sprawdzenia organizacji.** `course_assignments.userId`,
  `user_badges.userId`, `password_reset_tokens.userId` i `email_verification_tokens.userId` mają
  kolumnę `organizationId`, ale FK tylko na `users(id)` (FK omijają RLS), więc baza nie pilnuje, że
  użytkownik jest z tej samej organizacji. Ta sama luka została domknięta na `legal_acceptances` i
  `users.departmentId`. Do zrobienia jedną migracją: złożone FK `(organizationId, userId) ->
  users(organizationId, id)` (`ON UPDATE NO ACTION`; indeks unikalny na `users` już istnieje;
  kolumny `userId` są wymagane, więc Prisma może wyrazić relację normalnie).

## Backlog operacyjny (Redis)

- **Monitoring pamięci Redisa i alert przy 80%.** Prod Redis działa z `maxmemory 128mb` i `noeviction`
  (`docker-compose.prod.yml`), więc zapełnienie pamięci oznacza błędy zapisu: limiter maili przechodzi na
  rezerwę w pamięci procesu (fail-open), zapisy klucza `sessions-revoked:*` przy „wyloguj wszędzie” i resecie hasła
  padają (okno access tokenu do 15 min), a joby BullMQ (sprzątanie organizacji, tokenów) nie zapiszą stanu.
  Do zrobienia: zbieranie `used_memory` (`redis-cli INFO memory`; `used_memory / maxmemory`) i alert przy 80%,
  ewentualnie podniesienie limitu; do tego czasu zapełnienie zobaczymy tylko w logach `RedisService`.

## Backlog CI/CD

- **Testy e2e API działają w CI** (job `e2e` w `build-images`: kontenery `postgres:16` i `redis:7`, rola
  `cyberszkolo_app` z tego samego skryptu co `docker/postgres-init`, `prisma migrate deploy`, potem
  `jest --config ./test/jest-e2e.json --runInBand`); job `images` zależy od `test` i `e2e`. Lokalnie ok. 1 min.
  **Nadal poza CI:** skrypt przeglądarkowy `scripts/e2e-registration.mjs` (Playwright wymaga przeglądarek i
  zbudowanych aplikacji) - uruchamiany ręcznie przed wdrożeniem (`docs/e2e-registration.md`).
- **Sprzątanie GHCR usuwa stare wersje obrazów** (zostaje `:latest` i 3 najnowsze `sha-*`), więc
  wycofanie przez `IMAGE_TAG` działa tylko do 3 ostatnich buildów wstecz. Limit prywatnych paczek
  na planie Free (ok. 500 MB) może i tak być ciasny dla dwóch obrazów po 3 wersje - do sprawdzenia
  w Settings → Packages po kilku buildach; w razie potrzeby zmniejsz `KEEP_SHA_TAGS` w workflow.

## Izolacja danych między organizacjami

Zgodnie z Zasadą nr 1 z `CLAUDE.md`, izolacja tenantów jest wymuszana na dwóch niezależnych
poziomach:

1. **Filtr w kodzie aplikacji** — każdy endpoint dotykający danych klienckich pobiera
   `organizationId` wyłącznie z tokena JWT zalogowanego użytkownika (nigdy od klienta) i jawnie
   filtruje nim zapytania (`apps/api/src/users/users.service.ts`).
2. **Row-Level Security w Postgresie** — tabele `users` i `departments` mają włączone RLS
   (`apps/api/prisma/migrations/*_enable_row_level_security/migration.sql`,
   `*_rls_fail_closed/migration.sql`). Polityka jest **fail-closed**: jeśli kontekst
   `app.current_org_id` nie jest ustawiony, zapytanie zwraca zero wierszy, nie wszystkie.
   Zapytania dotykające danych klienckich muszą przechodzić przez
   `TenantPrismaService.runInOrgContext` (`apps/api/src/prisma/tenant-prisma.service.ts`), które
   ustawia ten kontekst przed wykonaniem zapytania. Jedyny świadomy wyjątek to
   `TenantPrismaService.runAuthLookup`, używany wyłącznie w `AuthService.login` / `.refresh` do
   wyszukania użytkownika po globalnie unikalnym e-mailu/id, zanim jego `organizationId` jest
   znane — ustawia osobny, jawny sentinel `app.bypass_tenant_rls`, a nie "brak kontekstu = pełny
   dostęp". Każdy nowy kod dotykający danych klienckich powinien iść przez
   `TenantPrismaService`, a nie przez gołe wstrzyknięcie `PrismaService`.

### Dwie role Postgresa: migracje vs runtime

RLS nic nie chroni, jeśli aplikacja łączy się z bazą jako superuser albo jako właściciel
tabel — obie te role **zawsze omijają RLS**, nawet z `ALTER TABLE ... FORCE ROW LEVEL
SECURITY` (tak było w tym repo do commitu wprowadzającego rolę `cyberszkolo_app` — RLS był
włączony, ale całkowicie nieaktywny). Dlatego są tu dwie role:

- **`cyberszkolo`** (`DATABASE_URL`) — superuser tworzony przez obraz `postgres` w
  `docker-compose.yml`, właściciel wszystkich tabel. Używany **wyłącznie** przez
  `prisma migrate` (potrzebuje uprawnień DDL).
- **`cyberszkolo_app`** (`DATABASE_URL_APP`) — rola bez `SUPERUSER`/`BYPASSRLS`, nie właściciel
  żadnej tabeli, tworzona przez `docker/postgres-init/01-create-app-role.sh` i z nadanymi
  uprawnieniami DML przez migrację `*_grant_app_role_privileges`. Jedyna rola, którą łączy się
  backend w runtime (`apps/api/src/prisma/prisma.service.ts`) — tylko wtedy RLS faktycznie
  ogranicza dostęp.

Nie upraszczaj tego z powrotem do jednej roli — patrz komentarze w `docker-compose.yml` i
`apps/api/src/prisma/prisma.service.ts`.

Testy regresyjne tej izolacji:
- `apps/api/test/auth.e2e-spec.ts` — organizacja A nie widzi użytkowników organizacji B
  (izolacja na poziomie API).
- `apps/api/test/rls.e2e-spec.ts` — surowe zapytanie bez ustawionego kontekstu organizacji
  zwraca zero wierszy (dokładnie scenariusz, przed którym RLS ma chronić: kod, który przez
  pomyłkę pominął `TenantPrismaService`).

## Backlog bezpieczeństwa modułu auth

Z audytu bezpieczeństwa modułu auth (izolacja tenantów / hashowanie haseł / JWT). Fail-closed
RLS + role Postgresa, rate limiting na `/auth/login` i `/auth/register` są już zaimplementowane.
Komunikat błędu rejestracji jest ujednolicony (anty-enumeracyjny) TYLKO dla duplikatu e-maila
(`REGISTRATION_FAILED_MESSAGE`) — duplikat organizacji (patrz niżej) celowo dostaje odrębny,
jawny komunikat, bo to informacja na poziomie firmy, nie konkretnego konta. Pozostałe punkty,
do zrobienia w osobnych zadaniach:

- ~~Brak rewokacji refresh tokenów / brak `/auth/logout`~~ - **rozwiązane**, patrz „Sesje i unieważnianie tokenów”.
- **`EmailService` w trybie dev-fallback (brak `MAILERSEND_API_TOKEN`) loguje pełną treść
  `templateData` w czystej postaci** (`apps/api/src/email/email.service.ts`), w tym surowy,
  jednorazowy token resetu hasła z linku wysyłanego przez `AuthService.forgotPassword` — to
  świadomy kompromis na rzecz wygody lokalnego dev (można kliknąć link z konsoli bez
  skonfigurowanego MailerSend), ale w środowisku ze scentralizowanym logowaniem (staging/prod
  z przypadkowo pustym/błędnym tokenem) oznacza to wyciek sekretu równoważnego jednorazowemu
  hasłu do logów czytanych przez więcej osób/narzędzi niż skrzynka mailowa użytkownika.
  Znalezione w security review tej sesji — do zrobienia: albo redagować wartości wyglądające na
  tokeny/URL z parametrami przed logiem, albo odmówić startu bez skonfigurowanego providera
  e-mail poza `NODE_ENV=development`.
- **Globalna unikalność e-maila między organizacjami** (`User.email` ma `@unique`, nie
  `@@unique([organizationId, email])`) — potwierdzić, czy to świadoma decyzja produktowa (ta
  sama osoba nie może dziś mieć kont w dwóch różnych organizacjach-klientach pod tym samym
  adresem).
- **Nazwa organizacji = domena e-maila, z unikalnym constraintem** (`Organization.name`,
  migracja `organization_name_unique`) — pierwsza osoba, która zarejestruje się z danej domeny,
  "zajmuje" ją dla wszystkich kolejnych (świadoma decyzja tej sesji, patrz
  `AuthService.deriveOrganizationNameFromEmail`). Celowo BEZ wyjątku dla domen współdzielonych
  publicznie (gmail.com, outlook.com, ...) — druga osoba z takiej domeny dostanie 400
  (`ORGANIZATION_ALREADY_EXISTS_MESSAGE`), mimo że nie ma żadnego związku z pierwszą. Docelowo,
  jeśli platforma ma obsługiwać rejestracje spoza firmowych domen, potrzebna albo lista
  wykluczonych domen publicznych, albo osobny mechanizm auto-joina do istniejącej organizacji
  (kto dołącza z jaką rolą, czy wymaga akceptacji admina) — żadne z tego nie jest budowane teraz.
- **Brak normalizacji e-maila** (lowercase/trim) przed zapisem i porównaniem w `auth.service.ts`.
- **Polityka haseł** ograniczona do `@MinLength(8)` — rozważyć sprawdzanie względem znanych
  wycieków (np. HaveIBeenPwned range API), skoro produkt sam uczy klientów higieny haseł.
- **Brak Helmet/CORS** w `apps/api/src/main.ts` — dodać przed wystawieniem API publicznie.
- **`organizations` nie ma włączonego RLS** (tylko `users` i `departments`) — to celowe, bo to
  rejestr samych tenantów, nie dane "per organizacja" (brak kolumny `organizationId`). Ale
  każdy przyszły endpoint dotykający tej tabeli (np. panel `SUPER_ADMIN`) musi ręcznie
  filtrować po `id`, RLS tu nie da drugiej linii obrony.
- **`POSTGRES_PASSWORD` w `docker-compose.yml` jest zahardkodowane wprost w pliku**
  (`cyberszkolo_dev`), w przeciwieństwie do `APP_DB_PASSWORD`. To hasło roli superusera z
  `BYPASSRLS`, a port 5432 jest zbindowany na `0.0.0.0`, nie tylko `localhost`. W czystym
  lokalnym dev to akceptowalne, ale warto przenieść je do zmiennej env analogicznie do
  `APP_DB_PASSWORD`, zanim ten sam `docker-compose.yml` posłuży kiedyś za wzorzec dla
  konfiguracji bliższej produkcji — inaczej unieważni to sens rozdziału ról opisanego wyżej.

## Backlog modułu kursów e-learningowych

Z code review modułu kursów (`apps/api/src/courses`). Wyciek klucza odpowiedzi w `/start` i
możliwość ukończenia kursu z pominięciem ocenianych bloków są już naprawione. Pozostałe punkty:

- **`ON DELETE CASCADE` z `courses` do `course_assignments`**
  (`apps/api/prisma/migrations/*_add_courses_and_assignments/migration.sql`) — usunięcie
  wiersza kursu bezpowrotnie kasuje `score`/`completedAt` wszystkich organizacji, które go
  ukończyły. Dziś nie ma endpointu usuwającego kursy, więc nie jest to pilne, ale na platformie
  sprzedawanej pod kątem audytów zgodności warto rozważyć `RESTRICT` + archiwizację kursów
  zamiast hard delete, zanim taki endpoint powstanie.
- **Nieznany `block.type` w `contentBlocks` jest cicho traktowany jak blok nieoceniany**
  (`CoursesService.evaluateBlock`) — niska waga, bo treść kursów jest dziś zarządzana wyłącznie
  administracyjnie (brak endpointu tworzenia kursów), ale warto to zauważyć, zanim ktoś zacznie
  importować treść z zewnętrznego źródła.
- **Brak endpointów administracyjnych** do tworzenia `Course` i przypisywania `CourseAssignment`
  — świadomie poza zakresem tego zadania (testy seedują dane bezpośrednio przez Prisma); osobne
  zadanie, gdy będzie potrzebny panel `ORG_ADMIN`/`SUPER_ADMIN` do zarządzania treścią.

## Backlog modułu dashboard/raporty

- **`overdueCount` w `GET /dashboard/overview` będzie dziś praktycznie zawsze 0.** Zapytanie
  (`DashboardService.getOverview`) poprawnie liczy `CourseAssignment` ze `status: OVERDUE`, ale
  nic w kodzie jeszcze nie ustawia tego statusu — brak joba (BullMQ + Redis, już w stosie
  projektu) przełączającego przypisania po `dueDate` z `NOT_STARTED`/`IN_PROGRESS` na `OVERDUE`.
  Metryka zadziała poprawnie, gdy taki job powstanie; do tego czasu liczba 0 nie znaczy "brak
  zaległości", tylko "nic jeszcze nie oznaczyło ich jako zaległe".
- **Brak ochrony przed CSV/formula injection w `GET /dashboard/export`.** Pola zaczynające się od
  `=`, `+`, `-` lub `@` mogą zostać zinterpretowane jako formuła przy otwarciu w Excelu/Sheets.
  Jedyne wolnotekstowe pole w eksporcie to `department.name`, tworzone przez ORG_ADMIN we
  własnej organizacji — ryzyko dotyczy więc co najwyżej tej samej organizacji, nie wycieku
  między tenantami. Niska waga, ale warto rozważyć prefiksowanie takich pól apostrofem/spacją
  w `DashboardService.exportCsv` przed wystawieniem eksportu szerszemu gronu odbiorców.

### Świadoma asymetria zakresu: "ukończone kursy" vs "ostatnia aktywność"

W `GET /dashboard/export` (kolumna CSV) i `GET /dashboard/admin/organizations` (pole
`lastCourseCompletionAt`) te same dwie metryki liczą się z różnego zakresu przypisań, celowo:

- Licznik ukończonych kursów (`mandatoryCompleted`/`mandatoryTotal`, kolumna CSV "Ukończone/
  Wszystkie obowiązkowe") — WYŁĄCZNIE kursy z `course.mandatory = true`, bo to metryka
  zgodności (compliance), nie ogólnej aktywności.
- `lastCourseCompletionAt` — WSZYSTKIE przypisania, także opcjonalne, bo to sygnał "czy user w
  ogóle coś robi w platformie", nie tylko czy spełnia obowiązek. Ukończenie kursu opcjonalnego
  aktualizuje tę datę tak samo jak obowiązkowego.

Ta asymetria jest identyczna w obu endpointach (`DashboardService.exportCsv` i
`.getOrganizationsOverview`) i pokryta testem w `dashboard.e2e-spec.ts`, który celowo nadaje
kursowi opcjonalnemu późniejszą datę ukończenia niż obowiązkowemu — regresja polegająca na
zawężeniu `lastCourseCompletionAt` tylko do kursów obowiązkowych (raz już się zdarzyła w code
review) zostanie złapana przez ten test.

### Executive Dashboard (`/dashboard`): trendy, status pracowników, raport

- `GET /dashboard/stats/trends` (6 ostatnich miesięcy) i `GET /dashboard/users-status` — oba tylko
  `ORG_ADMIN`, `organizationId` wyłącznie z JWT (+ RLS). Logika wyliczeń: `dashboard-metrics.ts`.
- **Trend liczony wstecz z `createdAt`/`completedAt`, bez tabeli historii.** Trwałe usunięcie
  pracownika (hard delete, CASCADE) usuwa też jego przypisania, więc jego wkład znika również z
  historycznych punktów trendu. Do zmiany, gdy potrzebne będą audytowalne migawki (np. tabela
  `compliance_snapshots` zasilana jobem).
- **Sortowanie i paginacja `users-status` odbywają się w pamięci** (filtr search/dział w SQL,
  `completionPercentage` jest polem wyliczanym). Świadomy kompromis dla skali MVP
  (setki–tysiące użytkowników na organizację); przy większej skali przenieść agregację do SQL.
- **"Ostatnia aktywność"** = najnowszy `CourseAssignment.updatedAt` spośród przypisań w statusie
  innym niż `NOT_STARTED` (samo przypisanie kursu przez admina nie jest aktywnością pracownika).
  Kolumna `updatedAt` została dodana migracją z backfillem `COALESCE(completedAt, createdAt)`.
- **Status zgodności:** `Zgodny` (wszystkie obowiązkowe ukończone), `Zaległości` (status OVERDUE
  albo termin minął), `W trakcie`, `Brak przypisań`. Przypomnienie: nic jeszcze nie ustawia
  statusu OVERDUE (patrz wyżej), ale termin w przeszłości jest wykrywany po `dueDate`.
- **Raport:** "Pobierz raport CSV" (proxy `/api/dashboard/export`) i "Drukuj raport" (druk
  przeglądarki → zapis jako PDF; style `@media print` chowają nawigację). Osobny generator PDF
  po stronie serwera nie jest zbudowany.

## Backlog frontendu (`apps/web`)

Z code review ekranów logowania (`/login`) i dashboardu admina (`/dashboard`).

- **Strona główna `/` nie odświeża sesji przez API (znany kompromis).** ORG_ADMIN, który wchodzi na `/`
  po wygaśnięciu cookie access tokena (15 min), a z ważnym refresh tokenem, trafia na `/courses` zamiast
  na `/dashboard`: `/` nie jest objęte middleware (`config.matcher`), więc roli nie da się odczytać z
  nieistniejącego cookie i strona wybiera bezpieczny cel wspólny dla wszystkich ról
  (`homePathForRole`, `apps/web/src/lib/home-path.ts`). Jeden klik dalej ("Dashboard" w nawigacji),
  nie blokuje pracy; middleware odświeża sesję już na `/courses`. Rozwiązanie, gdyby przeszkadzało:
  dodać `/` do matchera i odświeżać token w middleware przed decyzją o przekierowaniu.
- **`home-path.ts` i `PROTECTED_ROUTES` (middleware) są spięte tylko komentarzem.** Zmiana dopuszczonych
  ról w middleware bez zmiany `homePathForRole` skończyłaby się wylogowaniem tuż po zalogowaniu.
  Warto wyeksportować `PROTECTED_ROUTES` i dodać test, że dla każdej roli strona startowa mieści się
  w trasach dopuszczających tę rolę.
- **Rozjazd typów DTO między frontendem a `apps/api`.** `apps/web/src/app/dashboard/page.tsx`
  (`OverviewData`), `apps/web/src/app/dashboard/_components/DepartmentsTable.tsx`
  (`DepartmentRow`) i teraz też `apps/web/src/lib/courses-types.ts` ręcznie odwzorowują
  pole-po-polu DTO z `apps/api/src/dashboard/dto/` i `apps/api/src/courses/dto/`. Dla MVP
  akceptowalne — `packages/shared` eksportuje dziś wyłącznie `Role` — ale przy kolejnym module
  (kampanie phishingowe) ręczne duplikowanie kształtu łatwo doprowadzi do rozjazdu pól przy
  zmianie backendu bez aktualizacji frontu. Warto zaplanować przeniesienie współdzielonych DTO
  do `packages/shared`, zanim liczba duplikowanych interfejsów urośnie.
- ~~Brak endpointu wylogowania~~ - **rozwiązane**: `/api/auth/logout` (unieważnia sesję w API i czyści
  cookies) i `/api/auth/logout-all`; oba z ochroną Origin.
- **Login CSRF, niskie ryzyko.** `/api/auth/login` wymaga `Content-Type: application/json`, czego zwykły
  cross-site `<form>` nie potrafi wysłać, więc prosty atak formularzowy kończy się na 400. Trasy zmieniające stan
  przez ciasteczka (`proxyAuthenticated`, logout) mają dodatkowo sprawdzenie `Origin`.

## Backlog modułu kursów (`/courses`, `/courses/[courseId]`)

- **Brak wyjaśnienia tekstowego w feedbacku po odpowiedzi.**
  `CourseProgressResponseDto.lastResult` (`apps/api/src/courses/dto/course-progress-response.dto.ts`)
  zwraca tylko `{blockIndex, type, correct}` — żadnego pola z uzasadnieniem odpowiedzi. Do tego
  `contentBlocks` z `/start` ma już usunięte `correct`/`outcome`/ewentualny `feedback` z opcji
  (celowo, żeby nie ujawniać klucza odpowiedzi przed odpowiedzią — patrz wcześniejszy security
  review modułu kursów). Efekt: `FeedbackPanel` (`apps/web/.../[courseId]/_components/FeedbackPanel.tsx`)
  pokazuje wyłącznie generyczne "Poprawna odpowiedź!"/"Niepoprawna odpowiedź.", bez wyjaśnienia
  *dlaczego*. Żeby to zmienić, `CoursesService.submitBlockProgress` musiałby dodatkowo zwracać
  tekst wyjaśnienia dla wybranej/poprawnej opcji — nowe pole DTO, świadomie poza zakresem tego
  zadania.
- **`DragAndDropBlock` to uproszczona wersja (dwa przyciski klasyfikujące), nie prawdziwe
  przeciąganie.** Uzasadnienie: `CoursesService.evaluateBlock` w ogóle nie ocenia bloków
  `DRAG_AND_DROP` (nie ma go w `SCOREABLE_BLOCK_TYPES`, tak jak `VIDEO`) — prawdziwe drag&drop
  dawałoby złudzenie oceniania, którego backend i tak nie weryfikuje. Jeśli kiedyś ten typ bloku
  ma być realnie oceniany, potrzebna jest zarówno prawdziwa interakcja przeciągania, jak i
  rozszerzenie `evaluateBlock` o logikę oceny — dwie osobne zmiany (frontend + backend).
- **Tracking obejrzenia wideo jest czysto kosmetyczny.** `VideoBlock` blokuje "Dalej" do zdarzenia
  `onEnded`/`onError`, ale nic po stronie backendu tego nie weryfikuje (`VIDEO` też nie jest w
  `SCOREABLE_BLOCK_TYPES`) — user może przewinąć na koniec. Świadomy kompromis: to jest UX, nie
  kontrola dostępu do treści.

## Moduł e-mail (`apps/api/src/email/`)

`EmailService.send({ to, subject, templateName, templateData })` - wysyłka przez **MailerSend**
(`POST https://api.mailersend.com/v1/email`, `Authorization: Bearer MAILERSEND_API_TOKEN`).
Treść maila renderowana z szablonów **w kodzie** (`apps/api/src/email/templates/`: `email-verification`,
`password-reset`, `user-invite`), wartości od użytkownika są escapowane. Nadawca: `EMAIL_FROM` +
`EMAIL_FROM_NAME` - adres MUSI należeć do domeny zweryfikowanej w MailerSend (na koncie trial to
domena `*.mlsender.net`, wysyłka zwykle tylko do właściciela konta).

Flow korzystające z maili: **weryfikacja adresu przy rejestracji** (link 24 h, logowanie
zablokowane do potwierdzenia - `EMAIL_NOT_VERIFIED`), **reset hasła** (link 1 h), **zaproszenie
do organizacji** (mail z nazwą organizacji i osobą zapraszającą; klik w link ustawia hasło i
potwierdza adres).

- **Brak `MAILERSEND_API_TOKEN`** (pusty też się liczy - `.env.test`) -> `send()` loguje treść
  maila do konsoli (`[EMAIL DEV MODE]`). Na `NODE_ENV=production` bez tokenu aplikacja NIE
  wystartuje (linki z tokenami trafiłyby do logów), chyba że `ALLOW_EMAIL_DEV_MODE=true`
  (tylko lokalny stack `prodlocal`).
- **Błąd wysyłki nigdy nie przerywa flow, który wywołał `send()`** - złapany i zalogowany (status
  HTTP + treść odpowiedzi MailerSend, po redakcji tokenu). Konsekwencja: użytkownik, któremu mail nie
  dotarł, korzysta z "Wyślij link ponownie" (`POST /auth/resend-verification`).
- **Token nigdy nie trafia do logów** - komunikaty błędów są skanowane i redagowane. Test:
  `email.service.spec.ts`.
- Token API trzymamy wyłącznie w `.env` (gitignorowany). Token, który wkleisz do czatu/ticketu,
  uznaj za ujawniony i zrotuj po testach.

### Backlog
- `templateData` jest logowane w całości w trybie DEV MODE (zawiera linki z tokenami) - akceptowalne
  lokalnie, patrz guard produkcyjny wyżej.
- Konto MailerSend w trybie trial: wysyłka do dowolnych adresów wymaga zweryfikowanej domeny
  własnej (DNS) - do zrobienia przed publicznym wdrożeniem.
- Niepotwierdzona organizacja nadal "zajmuje" domenę (nazwa organizacji = domena e-maila) - do
  rozważenia wygaszanie niepotwierdzonych kont po X dniach.

## Moduł grywalizacji, awatary i leaderboard (`apps/api/src/gamification/`)

XP/level/odznaki za ukończenie kursów, ranking w obrębie organizacji (i opcjonalnie działu),
personalizacja profilu przez `avatarUrl`. `GamificationService` jest wołany **bezpośrednio** z
`CoursesService.submitBlockProgress` (w tej samej transakcji Prisma co oznaczenie kursu jako
`COMPLETED`), świadomie NIE przez event emitter — projekt tej zależności nie ma, a event w
jednym procesie NestJS bez kolejki/wielu konsumentów nie dawałby żadnej korzyści, za to
wprowadzałby ryzyko "kurs ukończony, proces padł przed obsłużeniem eventu, zero XP, cicho".
Bezpośrednie wywołanie w tym samym `tx` eliminuje to strukturalnie.

- **`level = floor(sqrt(xp / 100)) + 1`** — rozpisane na progi w `level.util.ts`: próg wejścia na
  poziom `L` to `(L-1)² × 100` XP, próg następnego poziomu to `L² × 100` XP.
- **`badges` (katalog odznak) celowo bez `organizationId`/RLS** — globalna definicja, jak
  `courses`. **`user_badges` (kto co odblokował) ma RLS fail-closed**, bez wyjątku bypass — w
  przeciwieństwie do `users`/`password_reset_tokens` nie ma tu ścieżki, która musiałaby odnaleźć
  wiersz przed poznaniem `organizationId` (zawsze znane z JWT).
- **Jednorazowość odznaki** wymuszona przez `@@unique([userId, badgeId])` + `try/catch` na
  naruszeniu tego constraintu w `tryUnlockBadge` (nie tylko logiczny check wcześniej) — chroni
  przed podwójnym przyznaniem XP *za konkretną odznakę* przy współbieżnych wywołaniach.
  **Bazowe/bonusowe XP za samo ukończenie kursu ma OSOBNĄ ochronę** — `submitBlockProgress`
  (`apps/api/src/courses/courses.service.ts`) zapisuje postęp przez `updateMany` z
  `currentBlockIndex` odczytanym na starcie funkcji w `WHERE` (optymistyczna blokada): dwa
  równoległe żądania kończące ten sam blok/kurs (dwie karty przeglądarki, retry) — pierwsze
  wygrywa i commituje, drugie trafia na już zmieniony wiersz, dopasowuje 0 wierszy i dostaje 409
  zamiast cicho wywołać `awardCourseCompletion` drugi raz. Znalezione w niezależnych review
  (`code-reviewer` i `security-reviewer`) tej samej sesji — wcześniejsza wersja tego opisu błędnie
  sugerowała, że sama ochrona odznak wystarcza na całość XP.
- **`firstName`/`lastName` na `User` istnieją w schemacie, ale żaden endpoint w tym module ich
  nie ustawia** — leaderboard w praktyce dziś zawsze spada na inicjały z e-maila
  (`initialsFromEmail`), dopóki nie powstanie ekran edycji profilu. Świadoma decyzja z tej sesji
  (dodanie pól bez API do ich ustawiania) — zanotowane w backlogu niżej, nie ukryte.
- **`SPEED_DEMON` jest zaseedowana, ale bez logiki auto-odblokowania** — wymagałaby pola
  `startedAt` na `CourseAssignment` (moment faktycznego rozpoczęcia, nie samego przypisania),
  którego dziś nie ma — zmiana schematu poza zakresem tego zadania.

### Backlog
- Endpoint do edycji `firstName`/`lastName` (patrz wyżej) — bez niego leaderboard nie pokaże
  realnych imion/nazwisk.
- `startedAt` na `CourseAssignment` + logika odblokowania `SPEED_DEMON`.
- Odznaki dziś sprawdzane tylko przy ukończeniu kursu (`CoursesService`) — kolejne zdarzenia XP
  (np. terminowość względem `dueDate`, seria dni z rzędu) to osobne zadania.
- `AVATAR_PRESETS` (`apps/api/src/users/avatar-presets.ts`) to na razie goła lista slugów —
  brak endpointu zwracającego metadane presetów (np. URL miniatury) dla frontendu.
