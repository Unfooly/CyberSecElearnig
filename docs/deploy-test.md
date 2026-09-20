# Wdrożenie testowe na VPS przez Cloudflare Tunnel i obrazy z GHCR

Cel: postawić Unfooly na VPS-ie **bez otwierania portów 80/443** i **bez budowania czegokolwiek na
VPS**. Ruch z internetu wchodzi przez Cloudflare Tunnel (`cloudflared` łączy się z Cloudflare
wychodząco, TLS terminuje Cloudflare), a do aplikacji dociera tylko usługa `web`. `api`, Postgres i
Redis nie są wystawione na zewnątrz. Obrazy `api` i `web` buduje GitHub Actions i wypycha do GHCR;
VPS je tylko pobiera.

```
push do main --> GitHub Actions: lint + testy --> build --> ghcr.io/unfooly/cybersecelearnig-{api,web}
                                                                     |
                                                            docker compose pull (VPS)
                                                                     v
przeglądarka --https--> Cloudflare --tunel--> cloudflared --> web:3000 --> api:3001 --> postgres / redis
```

Pełniejszy opis obrazów i sekretów: `README.md`, sekcja „Wdrożenie produkcyjne”.

## VPS nie buduje obrazów i tak ma zostać

VPS ma 1 GB RAM. `next build` (i kompilacja `bcrypt` w obrazie api) kończy się tam `SIGKILL`/OOM
nawet z 2 GB swapu. To nie jest błąd konfiguracji, tylko brak zasobów - dlatego **na VPS nie
uruchamiamy `docker compose build` ani `docker build`**. `docker-compose.prod.yml` celowo nie ma
sekcji `build:` dla `api`, `web` i `migrate` (używają gotowych obrazów z GHCR). Sekcje `build:`
istnieją wyłącznie w `docker-compose.prodlocal.yml` (lokalny test na maszynie dewelopera).

## Nazwy obrazów

| Usługa | Obraz w GHCR |
|---|---|
| `api` i `migrate` | `ghcr.io/unfooly/cybersecelearnig-api` |
| `web` | `ghcr.io/unfooly/cybersecelearnig-web` |

Tagi: `:latest` (ostatni udany build z `main`) oraz `:sha-<7 znaków commita>` (np. `sha-1a2b3c4`).
Tag wybiera zmienna `IMAGE_TAG` w `.env.prod` (domyślnie `latest`), prefiks `IMAGE_PREFIX` (domyślnie
`ghcr.io/unfooly/cybersecelearnig`). Nazwy w GHCR są zawsze pisane małymi literami.

**Skąd bierze się nazwa:** workflow składa ją z `github.repository_owner` (konto lub organizacja, tu
`Unfooly` -> `unfooly`) i nazwy repozytorium: `ghcr.io/<owner>/<repo>-<api|web>`, nic nie jest wpisane
na sztywno w workflow. Compose nie zna kontekstu GitHuba, więc jego domyślny prefiks jest wpisany w
`docker-compose.prod.yml`, a na VPS ustawiasz go jawnie w `.env.prod` (`IMAGE_PREFIX`). **Po
przeniesieniu repozytorium do innego właściciela lub zmianie jego nazwy** zmień `IMAGE_PREFIX` w
`.env.prod` (i domyślną wartość w compose), a stare paczki w GHCR zostają pod starym właścicielem.

**Repozytorium w organizacji:** paczki tworzone przez workflow są przypisane do repozytorium, a ich
widoczność dziedziczy ustawienia organizacji (Organization → Settings → Packages). Sprawdź w
Package settings → „Manage Actions access”, że repozytorium ma rolę **Write** (inaczej workflow nie
wypchnie obrazu ani nie posprząta starych wersji).

Workflow `.github/workflows/build-images.yml` uruchamia się na push do `main` (poza zmianami w
`docs/` i `*.md`) oraz ręcznie (`workflow_dispatch`). Najpierw joby `test` (lint + testy
jednostkowe api i web) i `e2e` (testy e2e API na Postgresie i Redisie w kontenerach serwisowych); dopiero
gdy oba przejdą, job `images` buduje i wypycha oba obrazy. Padnięte testy = brak nowych obrazów.
Skrypt przeglądarkowy Playwright (`docs/e2e-registration.md`) nie jest częścią workflow.

## Wymagania

- VPS (Ubuntu 24.04, min. 1 GB RAM) z Dockerem i pluginem `docker compose`. Buildx nie jest potrzebny.
- Domena w Cloudflare (strefa DNS zarządzana przez Cloudflare).
- Konto MailerSend ze zweryfikowaną domeną nadawcy i tokenem API (bez tego `api` na produkcji
  nie wystartuje).
- Konto GitHub z dostępem do repozytorium (do utworzenia tokenu read-only, patrz niżej).

## 1. Tunel w panelu Cloudflare (jednorazowo)

1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** → typ **Cloudflared**.
2. Nazwij tunel (np. `unfooly-test`) i skopiuj **token** z komendy „Install and run”
   (wartość po `--token`). Nie uruchamiaj tej komendy na VPS - zrobi to compose.
3. Zakładka **Public Hostname → Add**:
   - Subdomain/Domain: np. `app.twoja-domena.pl`
   - Service: **HTTP**, URL: `web:3000` (nazwa usługi compose, nie `localhost`)
4. Tylko `web` ma być publiczny. **Nie** dodawaj hostname dla `api` - przeglądarka rozmawia
   wyłącznie z `web` (BFF), a `web` woła `api` wewnątrz sieci compose.

## 2. Dostęp VPS do obrazów w GHCR (jednorazowo)

Obrazy w GHCR dla **prywatnego** repozytorium są **prywatne**, więc VPS musi się zalogować. Robi to
tokenem **tylko do odczytu**.

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) →
   Generate new token (classic)**. (GHCR nie obsługuje tokenów „fine-grained”, wymagany jest classic.)
2. Nazwa np. `vps-unfooly-ghcr-read`, ważność np. 90 dni (ustaw przypomnienie o rotacji).
3. Zaznacz **wyłącznie** `read:packages`. Nic więcej: bez `repo`, `write:packages`,
   `delete:packages`, `workflow`.
4. Skopiuj token (GitHub pokaże go raz).
5. Jeśli organizacja `Unfooly` wymaga SSO/SAML, obok tokenu kliknij **Configure SSO → Authorize** dla
   tej organizacji - bez tego `docker login`/`pull` zwróci `denied`. Konto tokenu musi być członkiem
   organizacji z dostępem do odczytu paczek (Package settings → Manage access).

**Nie wolno** używać na VPS tokenu z szerszymi uprawnieniami (np. PAT z `repo` albo
`write:packages`): wyciek tokenu z serwera oznaczałby wtedy dostęp do kodu lub możliwość
podmiany obrazów. Token z samym `read:packages` pozwala tylko pobierać obrazy. Uwaga: token
classic dotyczy wszystkich pakietów konta, które może czytać jego właściciel, więc jeśli to
możliwe, załóż go na dedykowanym koncie z dostępem tylko do tego repozytorium. Gdy token wycieknie
lub przestanie być potrzebny: GitHub → Settings → Tokens → **Delete**.

Logowanie na VPS (token przez stdin, żeby nie trafił do historii powłoki):

```bash
read -rs GHCR_TOKEN && echo "$GHCR_TOKEN" | docker login ghcr.io -u <twoj-login-github> --password-stdin && unset GHCR_TOKEN
chmod 600 ~/.docker/config.json     # Docker zapisuje tam poświadczenia
```

Sprawdzenie: `docker pull ghcr.io/unfooly/cybersecelearnig-web:latest` (wymaga, żeby workflow
przeszedł przynajmniej raz).

## 3. Pliki na VPS

```bash
git clone https://github.com/Unfooly/CyberSecElearnig.git unfooly && cd unfooly
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Uzupełnij `.env.prod` (każda pozycja jest opisana w pliku). Minimum:

- `TUNNEL_TOKEN` (z kroku 1), `COMPOSE_PROFILES=tunnel` (jest domyślnie w przykładzie).
- `IMAGE_TAG` (domyślnie `latest`; do wycofania patrz niżej).
- Hasła Postgresa: `POSTGRES_PASSWORD` oraz `APP_DB_PASSWORD` - **to samo hasło dosłownie** w
  `DATABASE_URL` / `DATABASE_URL_APP` (compose nie podstawia zmiennych wewnątrz env_file).
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`, różne od siebie).
- `FRONTEND_URL` = publiczny adres z kroku 1, z `https://`.
- `MAILERSEND_API_TOKEN`, `EMAIL_FROM` (z zweryfikowanej domeny), `SALES_EMAIL`.

**`.env.prod` jest jedynym plikiem konfiguracji na VPS.** Kontenery `api`, `web` i `migrate` czytają
z niego swoje zmienne środowiskowe (`env_file: ${ENV_FILE:-.env.prod}` w compose), a ten sam plik
podajesz compose flagą `--env-file .env.prod` do interpolacji (`IMAGE_TAG`, `TUNNEL_TOKEN`, hasła
Postgresa, profile). Dlatego **każde** polecenie compose w tej instrukcji ma `--env-file .env.prod`.
Dev-owy `.env` (np. z `FRONTEND_URL=http://localhost:3000`) kontenery na VPS **nie** czytają; wcześniej
czytały go, przez co linki w mailach wskazywały localhost. Jeśli na VPS leży stary `.env`, usuń go
albo przenieś sekrety do `.env.prod`, żeby nie mylił.

Żeby nie pisać flag za każdym razem, w sesji powłoki (lub w `~/.bashrc`):

```bash
export COMPOSE_FILE=docker-compose.prod.yml COMPOSE_ENV_FILES=.env.prod
# wtedy wystarczy: docker compose pull && docker compose up -d
```

Gdy zapomnisz flagi, compose przerwie się błędem `required variable POSTGRES_PASSWORD is missing`
(zamierzone zabezpieczenie), zamiast po cichu wystartować z nie tym plikiem.

## 4. Pierwszy start

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate      # migracje widoczne w wyjściu
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d                 # api, web, cloudflared
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

## 5. Kolejne wdrożenia

> **Uwaga - kolejność wdrożenia modelu samoobsługowej rejestracji firmy.** Wdrożenie na VPS ma iść
> bezpośrednio z obrazu zbudowanego **po etapie 5** (formularz rejestracji bez hasła + ekran
> weryfikacji domeny), **nigdy z obrazu etapu 2** (commit `49857e2`). Etap 2 tworzył admina ze
> statusem ACTIVE i hasłem z formularza (pre-hijacking); od etapu 3 rejestracja jest bezpieczna, ale
> dopiero po etapie 5 użytkownik ma w UI komplet ekranów. Produkcja jest dziś na obrazie sprzed
> etapu 1 i bez kont z pośrednich etapów.

Najpierw poczekaj, aż workflow **build-images** dla Twojego commita będzie zielony (zakładka
Actions w repozytorium). Potem na VPS:

```bash
cd ~/unfooly
git pull                                                        # compose, docs, .env.prod.example
docker compose --env-file .env.prod -f docker-compose.prod.yml pull                  # nowe obrazy z GHCR
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d                 # migrate biegnie sam przed api
```

`git pull` jest potrzebny tylko na pliki (compose, Caddyfile, dokumentację) - kod aplikacji jest w
obrazach. `up -d --no-deps api` **pomija** migracje; jeśli nowy kod ma migracje, użyj wersji wyżej
albo najpierw `run --rm migrate`.

**Wycofanie do poprzedniej wersji:** ustaw w `.env.prod` `IMAGE_TAG=sha-<krótki-hash-poprzedniego-commita>`,
potem `docker compose --env-file .env.prod -f docker-compose.prod.yml pull && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`.
(Migracje bazy nie są automatycznie cofane.)

## 6. Lista kontrolna po wdrożeniu

Wszystkie polecenia z VPS-a (lub z dowolnego miejsca, gdzie jest publiczny adres).

1. **Kontenery:** `docker compose --env-file .env.prod -f docker-compose.prod.yml ps` - `postgres`, `redis`, `api`,
   `web`, `cloudflared` w stanie `running`/`healthy`; `migrate` w stanie `exited (0)`.
2. **Właściwy obraz:** `docker compose --env-file .env.prod -f docker-compose.prod.yml images` - `api`/`web` z tagiem
   zgodnym z `IMAGE_TAG`.
3. **Tunel połączony:** `docker compose --env-file .env.prod -f docker-compose.prod.yml logs cloudflared | tail` -
   linie „Registered tunnel connection”. W panelu Cloudflare tunel ma status **Healthy**.
4. **Strona z internetu:** `curl -sI https://app.twoja-domena.pl/` - `HTTP/2 200`.
   `curl -sI https://app.twoja-domena.pl/login` - `200`.
5. **Porty zamknięte:** `nmap -Pn -p 80,443,3000,3001,5432,6379 <IP-VPS>` z zewnątrz - wszystkie
   `closed`/`filtered`. Publicznie działa wyłącznie przez Cloudflare.
6. **Migracje zaaplikowane:**
   `docker compose --env-file .env.prod -f docker-compose.prod.yml logs migrate | tail` -
   „All migrations have been successfully applied” (lub „No pending migrations to apply”).
7. **Logowanie i cookies:** zaloguj się w przeglądarce. W narzędziach deweloperskich cookies
   `access_token` / `refresh_token` mają flagi `HttpOnly` i `Secure`. ORG_ADMIN ląduje na
   `/dashboard`, pozostałe role na `/courses`.
8. **E-mail:** zarejestruj organizację - powinien przyjść mail z linkiem weryfikacyjnym
   (adres w linku zaczyna się od `FRONTEND_URL`, logo w mailu się ładuje).
9. **Formularz demo:** wyślij formularz na stronie głównej - zgłoszenie dociera na `SALES_EMAIL`.
10. **Izolacja danych:** dwie organizacje, użytkownik A nie widzi danych B (testy e2e
    `rls.e2e-spec.ts` uruchamiaj na kopii bazy, nie na produkcji).

## 7. Diagnostyka

| Objaw | Najczęstsza przyczyna |
|---|---|
| `pull access denied` / `unauthorized` przy `pull` | Brak logowania do `ghcr.io` (krok 2), wygasły lub usunięty token, albo token bez `read:packages`. Powtórz `docker login`. |
| `manifest unknown` / `not found` przy `pull` | Workflow jeszcze nie zbudował obrazu (sprawdź zakładkę Actions), albo `IMAGE_TAG` wskazuje nieistniejący tag. |
| Ktoś próbuje `docker compose build` na VPS i dostaje OOM | Nie buduj na VPS - patrz sekcja „VPS nie buduje obrazów”. Poczekaj na workflow i zrób `pull`. |
| Workflow czerwony na kroku lint/testy | Obrazy się nie wypchnęły (zamierzone). Napraw błąd, wypchnij poprawkę; na VPS zostaje poprzednia wersja. |
| Cloudflare pokazuje błąd 502/1033 | `cloudflared` nie działa (pusty/zły `TUNNEL_TOKEN`) albo Public Hostname wskazuje `localhost` zamiast `web:3000`. |
| `cloudflared` restartuje się | Zły token. `docker compose ... logs cloudflared`. |
| `api` nie startuje, `migrate` w stanie `exited (1)` | Błąd migracji lub zły `DATABASE_URL`/hasło. `logs migrate`. Api nie wystartuje, dopóki `migrate` nie zakończy się kodem 0 (to zamierzone). |
| `api` kończy się od razu z błędem o e-mailu | Na produkcji wymagane `MAILERSEND_API_TOKEN` i `EMAIL_FROM`. |
| Logowanie „przechodzi”, ale wraca na `/login` | `FRONTEND_URL`/hostname bez `https` albo dostęp przez `http` (cookies `Secure`); użyj adresu z `https://`. |
| Linki w mailach wskazują localhost | `FRONTEND_URL` nie ustawione na publiczny adres. |
| `required variable ... is missing` albo `env file .env.prod not found` przy `compose` | Polecenie bez `--env-file .env.prod`, brak pliku `.env.prod` w katalogu projektu albo pusta zmienna w nim. |
| Linki w mailach z `localhost:3000` mimo poprawnego `FRONTEND_URL` w `.env.prod` | Kontener wystartował ze starą konfiguracją (sprzed przejścia na `.env.prod`). `up -d --force-recreate api web`; sprawdź: `docker compose --env-file .env.prod exec api printenv FRONTEND_URL`. |

## 8. Wycofanie i sprzątanie

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down          # zatrzymuje kontenery, dane zostają
docker compose --env-file .env.prod -f docker-compose.prod.yml down -v       # UWAGA: kasuje wolumeny (baza!)
docker image prune -a                                   # stare obrazy po kilku wdrożeniach (oszczędza dysk)
```

Rotacja tokenu tunelu: w panelu Cloudflare wygeneruj nowy token, podmień `TUNNEL_TOKEN` w `.env.prod`
i `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d cloudflared`. Rotacja tokenu GHCR: załóż nowy
(krok 2), `docker login ghcr.io` ponownie, stary usuń w ustawieniach GitHuba.

## 9. Checklista startu produkcyjnego (publiczne udostępnienie)

To jest lista **warunków twardych**: dopóki którykolwiek punkt z sekcji A nie jest spełniony, **nie wdrażamy
publicznie** (środowisko testowe z placeholderami i `draft-1` jest w porządku, ale nie może przyjmować
prawdziwych klientów).

### A. Warunki blokujące

- [ ] **Dokumenty prawne są finalne.** Wersja dokumentów zapisywana w `LegalAcceptance` (stała
  `LEGAL_DOCUMENT_VERSION` w `packages/shared`) wskazuje na **finalny** regulamin i politykę prywatności
  (nie `draft-1`), a strony `/regulamin`, `/polityka-prywatnosci` i `/bezpieczenstwo`:
  - nie zawierają żadnych `[DO UZUPEŁNIENIA]` (`grep -r "DO UZUPE" apps/web/src` zwraca pusto),
  - nie mają `noindex` (usuń `robots: { index: false, follow: false }` z ich `metadata`) i nie mają żółtego
    banera „wersja robocza” (`LegalPage`),
  - **Wszystkie organizacje testowe są skasowane przed startem** (na VPS: `docker compose --env-file .env.prod -f
    docker-compose.prod.yml down -v`, czyli świeża baza z migracji) - żadna zgoda na wersję roboczą `draft-1` nie
    przechodzi na produkcję. Sprawdź po starcie: `select count(*) from legal_acceptances where version = 'draft-1'`
    (na produkcji musi zwrócić 0).
- [ ] **Checklista polityki prywatności** (`docs/legal/privacy-policy-checklist.md`) przejrzona z prawnikiem/IOD,
  a wszystkie pozycje odzwierciedlone w polityce.
- [ ] **Wdrożenie z obrazu po etapie 5 lub nowszego** - nigdy z obrazu etapu 2 (patrz uwaga w sekcji 5).
- [ ] **Domena nadawcy e-mail** własna i zweryfikowana w MailerSend (SPF, DKIM, DMARC); kampanie phishingowe z
  OSOBNEJ domeny niż e-maile transakcyjne (`CLAUDE.md`). Trial-owa domena MailerSend nie wystarcza.
- [ ] **Symulacje phishingowe - nadawca i strona lądowania** (warunek blokujący włączenia kampanii; kroki: sekcja 10):
  - domena nadawcy (`PHISHING_EMAIL_DOMAIN`) ma zweryfikowane **SPF, DKIM i DMARC** u dostawcy transportu i nie
    pokrywa się z domeną `EMAIL_FROM` ani hostem `FRONTEND_URL` (API blokuje transport na produkcji przy
    pokrywaniu: `GET /phishing/config` pokazuje `reason`),
  - ustawione `PHISHING_MAIL_TRANSPORT` (mailersend/smtp; `log` jest na produkcji zabroniony) i **własny**
    `PHISHING_MAILERSEND_API_TOKEN` (albo `PHISHING_SMTP_URL`),
  - `PHISHING_LANDING_BASE_URL` wskazuje **osobną domenę** strony lądowania (`https://`), routowaną do web; bez tego
    reputacja domeny aplikacji zależy od linków z symulacji.
- [ ] **Limit na brzegu dla publicznego śledzenia** (`/t/*`, `/api/t/*`): reguła WAF/rate limiting w Cloudflare (limit
  w API to 120/min na adres w pamięci procesu, bez współdzielenia między instancjami), `TRUST_PROXY=true`, API dostępne
  wyłącznie z sieci wewnętrznej, web tylko przez tunel (inaczej nagłówek `CF-Connecting-IP` da się podszyć). Logi
  dostępowe zawierają tokeny z linków - ograniczyć dostęp i retencję.
- [ ] **Scenariusz ręczny** z `docs/e2e-registration.md` przeszedł na środowisku z prawdziwym MailerSend i DNS
  (rejestracja -> mail -> hasło -> rekord TXT -> odblokowanie -> sprzątanie).
- [ ] **Sekrety i tryby deweloperskie wyłączone:** brak `ALLOW_EMAIL_DEV_MODE`, ustawiony `MAILERSEND_API_TOKEN` i
  `EMAIL_FROM`, `FRONTEND_URL` na publiczny `https://`, wygenerowane nowe `JWT_SECRET`/`JWT_REFRESH_SECRET`, brak
  kont demo z seedów (`seed-dev-roles`) w bazie produkcyjnej.
- [ ] **`TRUST_PROXY=true` w `.env.prod`** (tunel Cloudflare): bez tego wszyscy użytkownicy dzielą jeden licznik limitów
  (adres kontenera web). Po wdrożeniu sprawdź: dwa różne IP nie blokują się nawzajem po przekroczeniu limitu
  (np. 4 zgłoszenia „Umów demo” z jednego IP => 429, z drugiego => 202). Api bez wystawionych portów.
- [ ] **Redis z trwałością** (AOF/RDB) i `BACKGROUND_JOBS_ENABLED` niewyłączone: bez workera nie działa sprzątanie
  organizacji PENDING (14 dni) ani przypomnienie po 7 dniach.
- [ ] **Kopie zapasowe bazy** (harmonogram + sprawdzone odtworzenie) i region UE (RODO).

### B. Zalecane przed startem (z backlogu rejestracji, README)

- [ ] CAPTCHA na `/auth/register` i limit globalny/na domenę dla niezweryfikowanych organizacji.
- [ ] Monitoring/alert na logi „zadanie w tle ... nie powiodło się” (rejestracja, sprzątanie organizacji).

## Seed konta administratora ze zweryfikowaną domeną (tylko środowisko TESTOWE)

Skrót do pracy na środowisku testowym: jedna organizacja (`ACTIVE`, domena już zweryfikowana) i jedno konto `ORG_ADMIN`, bez
rejestracji i rekordu DNS TXT. **To świadomy wyjątek od zasady z `CLAUDE.md`** (`verifiedAt` i `ACTIVE` ustawia normalnie tylko
`DomainVerificationService`), więc: nigdy na środowisku z prawdziwymi klientami; na `NODE_ENV=production` skrypt odmawia, dopóki nie
ustawisz `SEED_CONFIRM_TEST_ENVIRONMENT=yes-this-is-not-real-customer-data`. Pełna ścieżka rejestracji z DNS (`docs/e2e-registration.md`)
zostaje jedynym sposobem na produkcji.

- **Hasło jest losowe i nieznane** (nigdzie niewypisywane): wejście przez „Zapomniałem hasła” na stronie logowania (link z maila).
  Na koncie MailerSend w trybie próbnym mail dojdzie tylko na adres dozwolony dla konta (zwykle adres właściciela) - `jakub.pieterwas@aries-it.pl`
  musi nim być albo domena nadawcy musi być zweryfikowana.
- Skrypt niczego nie nadpisuje: istniejące konto o tym e-mailu albo domena już zweryfikowana w innej organizacji => błąd i cofnięta
  transakcja (usuń wcześniej starą organizację, np. `aries-it.pl` z wcześniejszych testów).
- Wymaga obrazu API zawierającego `apps/api/prisma/seed-org-admin.js` (po `pull` obrazu zbudowanego z tego commita):

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm --no-deps \
  -e SEED_ADMIN_EMAIL=jakub.pieterwas@aries-it.pl \
  -e SEED_ORGANIZATION_NAME="Aries IT" \
  -e SEED_CONFIRM_TEST_ENVIRONMENT=yes-this-is-not-real-customer-data \
  migrate node apps/api/prisma/seed-org-admin.js
```

  Usługa `migrate` ma połączenie właściciela schematu (`DATABASE_URL`). Lokalnie (dev): `cd apps/api && SEED_ADMIN_EMAIL=... npx dotenv -e ../../.env -- node prisma/seed-org-admin.js`.
  Przed wykonaniem na VPS sprawdź, że w bazie nie ma konta ani zweryfikowanej domeny `aries-it.pl`. Test skryptu: `apps/api/test/seed-org-admin.e2e-spec.ts`.

## 10. Wdrożenie modułu symulacji phishingowych (kroki)

Moduł jest w API i web od commitów `3743fa6`...`9fd7262`; poniżej to, co trzeba zrobić na środowisku. Wysyłka jest **domyślnie
zablokowana** (transport `none` na produkcji), więc do czasu wykonania kroków 1-4 kampanii nie da się uruchomić (409
`TRANSPORT_NOT_CONFIGURED`), a reszta platformy działa jak dotąd. Opis modułu: `docs/phishing-simulations.md`.

### Zmienne środowiskowe (`.env.prod`; wzór w `.env.prod.example`)

| Zmienna | Wartość na produkcji |
|---|---|
| `PHISHING_EMAIL_DOMAIN` | Własna domena nadawcy kampanii (np. `symulacje.twoja-domena.pl`), **osobna** od domeny `EMAIL_FROM` i hosta `FRONTEND_URL` (na produkcji API blokuje nakładanie się, także subdomeny). Klient edytuje tylko część lokalną adresu. |
| `PHISHING_MAIL_TRANSPORT` | `mailersend` (albo `smtp`). Puste = wysyłka zablokowana; `log` jest na produkcji zabroniony. Środowiska inne niż `development`/`test` (np. `staging`) są traktowane jak produkcja. |
| `PHISHING_MAILERSEND_API_TOKEN` | **Własny** token MailerSend dla symulacji (osobne konto/domena od poczty transakcyjnej). Identyczny z `MAILERSEND_API_TOKEN` jest odrzucany (`TOKEN_SHARED_WITH_TRANSACTIONAL`). |
| `PHISHING_SMTP_URL` | Tylko dla `smtp`: `smtp://` albo `smtps://user:hasło@host:port` (TLS wymuszony poza localhost). |
| `PHISHING_LANDING_BASE_URL` | Publiczny adres strony lądowania w linkach z maili (`https://...`, tylko origin); docelowo osobna domena niż aplikacja. Puste = `FRONTEND_URL`. |

Bez zmian, ale teraz czytane także przez moduł: `NODE_ENV`, `EMAIL_FROM`, `FRONTEND_URL`, `MAILERSEND_API_TOKEN` (tylko do
sprawdzenia rozdziału od poczty transakcyjnej), `REDIS_URL` i `BACKGROUND_JOBS_ENABLED` (nie `false`: bez workera kampanie nie
wysyłają), `TRUST_PROXY=true`. Po zmianie `.env.prod`: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`
(kontener `api` musi się przeładować).

### Kolejność

1. **DNS domeny nadawcy** (u dostawcy DNS domeny, dane z panelu MailerSend → Domains → wybrana domena):
   - **SPF** (TXT na domenie nadawcy): rekord z panelu dostawcy (np. `v=spf1 include:_spf.mlsend.com ~all`),
   - **DKIM** (CNAME/TXT `<selektor>._domainkey.<domena>`): dokładnie wartości z panelu,
   - **DMARC** (TXT `_dmarc.<domena>`): start od `v=DMARC1; p=none; rua=mailto:dmarc@twoja-domena.pl`, po stabilizacji
     zaostrzyć do `quarantine`,
   - (zalecane) rekord zwrotny/`Return-Path` z panelu, żeby SPF przechodził w trybie zestawionym.
   Poczekaj na status **Verified** w panelu MailerSend, sprawdź: `dig TXT <domena>`, `dig TXT _dmarc.<domena>`,
   `dig CNAME <selektor>._domainkey.<domena>`. Domena testowa `*.mlsender.net` służy tylko środowisku testowemu.
   **Środowisko testowe z jedną domeną próbną** (ta sama w `EMAIL_FROM` i `PHISHING_EMAIL_DOMAIN`): API na `NODE_ENV=production`
   blokuje nakładanie domen (`SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL`), więc dopisz do `.env.prod`
   `PHISHING_ALLOW_SHARED_TRANSACTIONAL_DOMAIN=yes-this-is-a-test-environment` (dokładnie ta wartość; wyłącza tylko tę jedną
   kontrolę) oraz **drugi, osobny token** MailerSend w `PHISHING_MAILERSEND_API_TOKEN` (ten sam co `MAILERSEND_API_TOKEN` jest
   odrzucany: `TOKEN_SHARED_WITH_TRANSACTIONAL`). Na środowisku z prawdziwymi klientami tej zmiennej nie ustawiać.
2. **Domena strony lądowania** (zalecana osobna): w tunelu Cloudflare (sekcja 1) dodaj drugi **Public Hostname**
   (np. `verify.twoja-domena.pl` → `web:3000`) i ustaw `PHISHING_LANDING_BASE_URL=https://verify.twoja-domena.pl`. To ten sam
   kontener `web`, więc na tym hostname działa CAŁA aplikacja - w Cloudflare WAF dodaj regułę **Block** dla hosta lądowania i
   ścieżek poza `/t/*`, `/api/t/*` i `/_next/*` (favicon). Origin BFF liczy się po hoście żądania, więc strona lądowania
   działa na własnej domenie bez dodatkowej konfiguracji.
3. **Limit na brzegu (WAF/rate limiting) - WARUNEK STARTU:** Cloudflare → Security → WAF → Rate limiting rules dla ścieżek
   `/t/*` i `/api/t/*` (np. 120 żądań/min na adres, akcja Block na 10 minut). Limit w API (120/min na adres, IPv6 po /64) jest w
   pamięci procesu i nie zastępuje limitu brzegowego. Razem z tym: `TRUST_PROXY=true`, API bez wystawionych portów (sekcja 1),
   dostęp do logów dostępowych ograniczony (zawierają tokeny z linków).
4. **Migracje**: wykonuje usługa `migrate` przy `up -d` (sekcja 5). Moduł dodaje tabele `phishing_*` z RLS oraz zależy od
   PostgreSQL **15+** (`ON DELETE SET NULL (kolumna)`); stack używa 16. Po wdrożeniu: `docker compose ... logs migrate` -
   migracje `phishing_templates`, `phishing_campaigns`, `phishing_tracking`, `phishing_tracking_lookup_sentinel`,
   `phishing_results` muszą być zastosowane.
5. **Weryfikacja konfiguracji**: zaloguj się jako ORG_ADMIN aktywnej organizacji i `GET /phishing/config` (albo kreator nowej
   kampanii): `configured: true`, `sendsRealMail: true`, poprawny `senderDomain` i `landingHost`; przy `configured: false` pole
   `reason` wskazuje przyczynę (`SENDER_DOMAIN_OVERLAPS_TRANSACTIONAL`, `TOKEN_SHARED_WITH_TRANSACTIONAL`, `SMTP_URL_MISSING`...).
6. **Próba na własnej skrzynce**: kampania z jednym odbiorcą (własne konto `ACTIVE`; wyniki zbiorcze wymagają >= 3 osób, ale do
   próby wystarczy 1) z wąskim oknem (10 minut). Sprawdź: mail dotarł (nie w spamie: nagłówki SPF/DKIM/DMARC = pass),
   link prowadzi na domenę lądowania, `/t/<token>` pokazuje stronę, po 2,5 s kliknięcie zostaje zapisane, po "Potwierdź" pojawia się
   lekcja i przypisuje się kurs. Potem anuluj kampanię testową. Na koniec kilka realnych skrzynek (Gmail, Outlook) przed
   pierwszą kampanią klienta.
7. **Monitoring po starcie**: `docker compose ... logs api | grep -i "phishing\|Wysyłka"` (kody `HTTP_*`, `TIMEOUT_UNKNOWN` = "niepewne"),
   licznik odbić i skarg w panelu MailerSend, alert przy wzroście skarg/bounce (reputacja domeny nadawcy).

### Rollback modułu

Wyłączenie wysyłki bez wycofywania obrazu: puste `PHISHING_MAIL_TRANSPORT` i `up -d` (nowe kampanie dostają 409
`TRANSPORT_NOT_CONFIGURED`; wysyłki już zaplanowane kończą się nieudane z kodem `NOT_CONFIGURED_*`, bez wysłania maila - najpierw
anuluj aktywne kampanie w panelu, żeby wyniki nie zawierały takich wpisów). Migracje są addytywne - wycofanie obrazu do sprzed
modułu nie wymaga cofania schematu (nowe tabele są ignorowane).

## Klasyczna alternatywa: Caddy

Zamiast tunelu można użyć Caddy (Let's Encrypt, porty 80/443 otwarte): w `.env.prod` ustaw
`COMPOSE_PROFILES=caddy`, podmień domeny w `Caddyfile` i uruchom jak wyżej. Nie łącz z tunelem.
