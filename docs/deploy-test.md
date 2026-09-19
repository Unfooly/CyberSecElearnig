# Wdrożenie testowe na VPS przez Cloudflare Tunnel

Cel: postawić Unfooly na VPS-ie **bez otwierania portów 80/443**. Ruch z internetu wchodzi przez
Cloudflare Tunnel (`cloudflared` łączy się z Cloudflare wychodząco, TLS terminuje Cloudflare),
a do aplikacji dociera tylko usługa `web`. `api`, Postgres i Redis nie są wystawione na zewnątrz.

```
przeglądarka --https--> Cloudflare --tunel--> cloudflared --> web:3000 --> api:3001 --> postgres / redis
                                              (ta sama sieć compose)
```

Pełniejszy opis obrazów i sekretów: `README.md`, sekcja „Wdrożenie produkcyjne”.

## Wymagania

- VPS (Ubuntu 24.04, min. 1 GB RAM) z Dockerem i pluginem `docker compose`.
- Domena w Cloudflare (strefa DNS zarządzana przez Cloudflare).
- Konto MailerSend ze zweryfikowaną domeną nadawcy i tokenem API (bez tego `api` na produkcji
  nie wystartuje).

## 1. Tunel w panelu Cloudflare (jednorazowo)

1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** → typ **Cloudflared**.
2. Nazwij tunel (np. `unfooly-test`) i skopiuj **token** z komendy „Install and run”
   (wartość po `--token`). Nie uruchamiaj tej komendy na VPS - zrobi to compose.
3. Zakładka **Public Hostname → Add**:
   - Subdomain/Domain: np. `app.twoja-domena.pl`
   - Service: **HTTP**, URL: `web:3000` (nazwa usługi compose, nie `localhost`)
4. Tylko `web` ma być publiczny. **Nie** dodawaj hostname dla `api` - przeglądarka rozmawia
   wyłącznie z `web` (BFF), a `web` woła `api` wewnątrz sieci compose.

## 2. Pliki na VPS

```bash
git clone https://github.com/Amadispl/CyberSecElearnig.git unfooly && cd unfooly
cp .env.prod.example .env
chmod 600 .env
```

Uzupełnij `.env` (każda pozycja jest opisana w pliku). Minimum:

- `TUNNEL_TOKEN` (z kroku 1), `COMPOSE_PROFILES=tunnel` (jest domyślnie w przykładzie).
- Hasła Postgresa: `POSTGRES_PASSWORD` oraz `APP_DB_PASSWORD` - **to samo hasło dosłownie** w
  `DATABASE_URL` / `DATABASE_URL_APP` (compose nie podstawia zmiennych wewnątrz env_file).
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`, różne od siebie).
- `FRONTEND_URL` = publiczny adres z kroku 1, z `https://`.
- `MAILERSEND_API_TOKEN`, `EMAIL_FROM` (z zweryfikowanej domeny), `SALES_EMAIL`.

## 3. Start: najpierw migracje, potem reszta

Migracje są osobnym, jednorazowym krokiem (usługa `migrate`), a `api` startuje dopiero po jego
sukcesie (`service_completed_successfully`).

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm migrate      # migracje widoczne w wyjściu
docker compose -f docker-compose.prod.yml up -d                 # api, web, cloudflared
docker compose -f docker-compose.prod.yml ps
```

Kolejne wdrożenia (po `git pull`):

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d                 # migrate biegnie sam przed api
```

Uwaga: `up -d --no-deps api` **pomija** migracje. Jeśli nowy kod ma migracje, użyj wersji wyżej
albo najpierw `run --rm migrate`.

## 4. Lista kontrolna po wdrożeniu

Wszystkie polecenia z VPS-a (lub z dowolnego miejsca, gdzie jest publiczny adres).

1. **Kontenery:** `docker compose -f docker-compose.prod.yml ps` - `postgres`, `redis`, `api`,
   `web`, `cloudflared` w stanie `running`/`healthy`; `migrate` w stanie `exited (0)`.
2. **Tunel połączony:** `docker compose -f docker-compose.prod.yml logs cloudflared | tail` -
   linie „Registered tunnel connection”. W panelu Cloudflare tunel ma status **Healthy**.
3. **Strona z internetu:** `curl -sI https://app.twoja-domena.pl/` - `HTTP/2 200`.
   `curl -sI https://app.twoja-domena.pl/login` - `200`.
4. **Porty zamknięte:** `nmap -Pn -p 80,443,3000,3001,5432,6379 <IP-VPS>` z zewnątrz - wszystkie
   `closed`/`filtered`. Publicznie działa wyłącznie przez Cloudflare.
5. **Migracje zaaplikowane:**
   `docker compose -f docker-compose.prod.yml logs migrate | tail` -
   „All migrations have been successfully applied” (lub „No pending migrations to apply”).
6. **Logowanie i cookies:** zaloguj się w przeglądarce. W narzędziach deweloperskich cookies
   `access_token` / `refresh_token` mają flagi `HttpOnly` i `Secure`. ORG_ADMIN ląduje na
   `/dashboard`, pozostałe role na `/courses`.
7. **E-mail:** zarejestruj organizację - powinien przyjść mail z linkiem weryfikacyjnym
   (adres w linku zaczyna się od `FRONTEND_URL`, logo w mailu się ładuje).
8. **Formularz demo:** wyślij formularz na stronie głównej - zgłoszenie dociera na `SALES_EMAIL`.
9. **Izolacja danych:** dwie organizacje, użytkownik A nie widzi danych B (testy e2e
   `rls.e2e-spec.ts` uruchamiaj na kopii bazy, nie na produkcji).

## 5. Diagnostyka

| Objaw | Najczęstsza przyczyna |
|---|---|
| Build web: „BLAD: brak .../standalone/apps/web/server.js” albo COPY standalone „not found” | Na VPS jest stary checkout (bez `output: 'standalone'` w `apps/web/next.config.mjs`). `git pull` i sprawdź: `grep -n standalone apps/web/next.config.mjs` (ma zwrócić linię z `output`). Build przerywa się celowo z czytelnym komunikatem. |
| Cloudflare pokazuje błąd 502/1033 | `cloudflared` nie działa (pusty/zły `TUNNEL_TOKEN`) albo Public Hostname wskazuje `localhost` zamiast `web:3000`. |
| `cloudflared` restartuje się | Zły token. `docker compose ... logs cloudflared`. |
| `api` nie startuje, `migrate` w stanie `exited (1)` | Błąd migracji lub zły `DATABASE_URL`/hasło. `logs migrate`. Api nie wystartuje, dopóki `migrate` nie zakończy się kodem 0 (to zamierzone). |
| `api` kończy się od razu z błędem o e-mailu | Na produkcji wymagane `MAILERSEND_API_TOKEN` i `EMAIL_FROM`. |
| Logowanie „przechodzi”, ale wraca na `/login` | `FRONTEND_URL`/hostname bez `https` albo dostęp przez `http` (cookies `Secure`); użyj adresu z `https://`. |
| Linki w mailach wskazują localhost | `FRONTEND_URL` nie ustawione na publiczny adres. |

## 6. Wycofanie i sprzątanie

```bash
docker compose -f docker-compose.prod.yml down          # zatrzymuje kontenery, dane zostają
docker compose -f docker-compose.prod.yml down -v       # UWAGA: kasuje wolumeny (baza!)
```

Rotacja tokenu tunelu: w panelu Cloudflare wygeneruj nowy token, podmień `TUNNEL_TOKEN` w `.env`
i `docker compose -f docker-compose.prod.yml up -d cloudflared`.

## Klasyczna alternatywa: Caddy

Zamiast tunelu można użyć Caddy (Let's Encrypt, porty 80/443 otwarte): w `.env` ustaw
`COMPOSE_PROFILES=caddy`, podmień domeny w `Caddyfile` i uruchom jak wyżej. Nie łącz z tunelem.
