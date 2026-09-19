# Wdrożenie testowe na VPS przez Cloudflare Tunnel i obrazy z GHCR

Cel: postawić Unfooly na VPS-ie **bez otwierania portów 80/443** i **bez budowania czegokolwiek na
VPS**. Ruch z internetu wchodzi przez Cloudflare Tunnel (`cloudflared` łączy się z Cloudflare
wychodząco, TLS terminuje Cloudflare), a do aplikacji dociera tylko usługa `web`. `api`, Postgres i
Redis nie są wystawione na zewnątrz. Obrazy `api` i `web` buduje GitHub Actions i wypycha do GHCR;
VPS je tylko pobiera.

```
push do main --> GitHub Actions: lint + testy --> build --> ghcr.io/amadispl/cybersecelearnig-{api,web}
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
| `api` i `migrate` | `ghcr.io/amadispl/cybersecelearnig-api` |
| `web` | `ghcr.io/amadispl/cybersecelearnig-web` |

Tagi: `:latest` (ostatni udany build z `main`) oraz `:sha-<7 znaków commita>` (np. `sha-1a2b3c4`).
Tag wybiera zmienna `IMAGE_TAG` w `.env` (domyślnie `latest`), prefiks `IMAGE_PREFIX` (domyślnie
`ghcr.io/amadispl/cybersecelearnig`). Nazwy w GHCR są zawsze pisane małymi literami.

Workflow `.github/workflows/build-images.yml` uruchamia się na push do `main` (poza zmianami w
`docs/` i `*.md`) oraz ręcznie (`workflow_dispatch`). Najpierw job `test` (lint + testy
jednostkowe api i web); dopiero gdy przejdzie, job `images` buduje i wypycha oba obrazy. Padnięte
testy = brak nowych obrazów. Testy e2e (potrzebują Postgresa) nie są częścią tego workflow.

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

Sprawdzenie: `docker pull ghcr.io/amadispl/cybersecelearnig-web:latest` (wymaga, żeby workflow
przeszedł przynajmniej raz).

## 3. Pliki na VPS

```bash
git clone https://github.com/Amadispl/CyberSecElearnig.git unfooly && cd unfooly
cp .env.prod.example .env
chmod 600 .env
```

Uzupełnij `.env` (każda pozycja jest opisana w pliku). Minimum:

- `TUNNEL_TOKEN` (z kroku 1), `COMPOSE_PROFILES=tunnel` (jest domyślnie w przykładzie).
- `IMAGE_TAG` (domyślnie `latest`; do wycofania patrz niżej).
- Hasła Postgresa: `POSTGRES_PASSWORD` oraz `APP_DB_PASSWORD` - **to samo hasło dosłownie** w
  `DATABASE_URL` / `DATABASE_URL_APP` (compose nie podstawia zmiennych wewnątrz env_file).
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`, różne od siebie).
- `FRONTEND_URL` = publiczny adres z kroku 1, z `https://`.
- `MAILERSEND_API_TOKEN`, `EMAIL_FROM` (z zweryfikowanej domeny), `SALES_EMAIL`.

Plik musi nazywać się dokładnie `.env` (compose czyta go do interpolacji i jako `env_file`).

## 4. Pierwszy start

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm migrate      # migracje widoczne w wyjściu
docker compose -f docker-compose.prod.yml up -d                 # api, web, cloudflared
docker compose -f docker-compose.prod.yml ps
```

## 5. Kolejne wdrożenia

Najpierw poczekaj, aż workflow **build-images** dla Twojego commita będzie zielony (zakładka
Actions w repozytorium). Potem na VPS:

```bash
cd ~/unfooly
git pull                                                        # compose, docs, .env.prod.example
docker compose -f docker-compose.prod.yml pull                  # nowe obrazy z GHCR
docker compose -f docker-compose.prod.yml up -d                 # migrate biegnie sam przed api
```

`git pull` jest potrzebny tylko na pliki (compose, Caddyfile, dokumentację) - kod aplikacji jest w
obrazach. `up -d --no-deps api` **pomija** migracje; jeśli nowy kod ma migracje, użyj wersji wyżej
albo najpierw `run --rm migrate`.

**Wycofanie do poprzedniej wersji:** ustaw w `.env` `IMAGE_TAG=sha-<krótki-hash-poprzedniego-commita>`,
potem `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.
(Migracje bazy nie są automatycznie cofane.)

## 6. Lista kontrolna po wdrożeniu

Wszystkie polecenia z VPS-a (lub z dowolnego miejsca, gdzie jest publiczny adres).

1. **Kontenery:** `docker compose -f docker-compose.prod.yml ps` - `postgres`, `redis`, `api`,
   `web`, `cloudflared` w stanie `running`/`healthy`; `migrate` w stanie `exited (0)`.
2. **Właściwy obraz:** `docker compose -f docker-compose.prod.yml images` - `api`/`web` z tagiem
   zgodnym z `IMAGE_TAG`.
3. **Tunel połączony:** `docker compose -f docker-compose.prod.yml logs cloudflared | tail` -
   linie „Registered tunnel connection”. W panelu Cloudflare tunel ma status **Healthy**.
4. **Strona z internetu:** `curl -sI https://app.twoja-domena.pl/` - `HTTP/2 200`.
   `curl -sI https://app.twoja-domena.pl/login` - `200`.
5. **Porty zamknięte:** `nmap -Pn -p 80,443,3000,3001,5432,6379 <IP-VPS>` z zewnątrz - wszystkie
   `closed`/`filtered`. Publicznie działa wyłącznie przez Cloudflare.
6. **Migracje zaaplikowane:**
   `docker compose -f docker-compose.prod.yml logs migrate | tail` -
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
| `required variable ... is missing` przy `compose` | Brak pliku `.env` (nazwa dokładnie `.env`, nie `.env.prod`) albo pusta zmienna. |

## 8. Wycofanie i sprzątanie

```bash
docker compose -f docker-compose.prod.yml down          # zatrzymuje kontenery, dane zostają
docker compose -f docker-compose.prod.yml down -v       # UWAGA: kasuje wolumeny (baza!)
docker image prune -a                                   # stare obrazy po kilku wdrożeniach (oszczędza dysk)
```

Rotacja tokenu tunelu: w panelu Cloudflare wygeneruj nowy token, podmień `TUNNEL_TOKEN` w `.env`
i `docker compose -f docker-compose.prod.yml up -d cloudflared`. Rotacja tokenu GHCR: załóż nowy
(krok 2), `docker login ghcr.io` ponownie, stary usuń w ustawieniach GitHuba.

## Klasyczna alternatywa: Caddy

Zamiast tunelu można użyć Caddy (Let's Encrypt, porty 80/443 otwarte): w `.env` ustaw
`COMPOSE_PROFILES=caddy`, podmień domeny w `Caddyfile` i uruchom jak wyżej. Nie łącz z tunelem.
