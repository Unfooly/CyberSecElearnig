# Onboarding: pierwszy dzień w repo

Dla nowej osoby (i nowej sesji agenta). Cel: w godzinę mieć działające środowisko, zielone testy i wiedzieć, jakich zasad nie wolno
złamać. Szczegóły komend i konfiguracji są w `README.md` (sekcja „Uruchomienie lokalne”), tu jest ścieżka i pułapki.

## 1. Co to jest

Unfooly (dawniej CyberSzkoło): wielodostępowa (multi-tenant) platforma SaaS do szkoleń z cyberbezpieczeństwa i symulacji phishingowych,
sprzedawana firmom (B2B). Moduły MVP: organizacje i użytkownicy, e-learning, symulacje phishingowe, zgłaszanie zagrożeń, dashboard.
Kontekst produktu i konwencje: `CLAUDE.md` (źródło prawdy, czytaj w całości). Decyzje i ich uzasadnienia: `docs/decisions.md`.

Stos: NestJS + Prisma/PostgreSQL (`apps/api`), Next.js + Tailwind (`apps/web`, warstwa BFF do API), BullMQ + Redis, MailerSend, wspólne typy
w `packages/shared`. Testy: Jest (API), Vitest + React Testing Library (web).

## 2. Cztery zasady, których nie wolno złamać

1. **Izolacja tenantów (Zasada nr 1).** Każde zapytanie o dane klienckie filtruje po `organizationId` **i** idzie przez
   `TenantPrismaService.runInOrgContext` (RLS w Postgresie jest drugą linią obrony). Nie ma zapytań „bez organizacji”. Każdy nowy endpoint
   ma test, że użytkownik organizacji A nie widzi danych organizacji B. Lista wyjątków od RLS jest zamknięta (CLAUDE.md).
2. **Migracje tylko przez Prisma Migrate**, migracja i `schema.prisma` w tym samym commicie. Nigdy ręczny `ALTER TABLE`, nigdy edycja
   migracji, która trafiła na `main`. Nowa tabela z `organizationId` ma `onDelete: Cascade` i RLS (wzór: dowolna migracja `*_user_import_*`).
3. **Test do każdej funkcji:** happy path + przypadek brzegowy + test izolacji A/B. Zielone testy lokalne nie znaczą zielonego CI (patrz 5).
4. **Sekrety tylko w `.env`** (nieopublikowanym) i zmiennych środowiskowych. Żadnych sekretów, dumpów bazy ani danych osobowych w
   kodzie, testach, opisach PR i logach.

Praca zespołowa (branże, PR, review, merge): CLAUDE.md, sekcja „Praca zespołowa: branże i pull requesty”, oraz szablon
`.github/pull_request_template.md`.

## 3. Uruchomienie lokalne (skrót)

Wymagania: Node.js 20+, npm 10+, Docker. Pełny opis z komentarzami: `README.md`.

```bash
cp .env.example .env
cp .env.test.example .env.test         # wpisz TEN SAM APP_DB_PASSWORD (i DATABASE_URL_APP) w obu plikach
docker compose up -d                    # Postgres + Redis (rola cyberszkolo_app powstaje przy pierwszym starcie)
docker exec cyberszkolo-postgres createdb -U cyberszkolo cyberszkolo_test   # jednorazowo
npm install                             # workspace'y + build packages/shared
npm run prisma:migrate --workspace=apps/api                                  # baza dev
npx dotenv -e .env.test -- npm run prisma:deploy --workspace=apps/api        # baza testowa
npm run seed:badges --workspace=apps/api
npm run dev:api                         # http://localhost:3001
npm run dev:web                         # osobny terminal
```

Dev i test dzielą jeden kontener Postgresa; testy używają osobnej bazy `cyberszkolo_test` (`.env.test`), więc nigdy nie dotykają danych dev.

## 4. Codzienne komendy

```bash
npm run test --workspace=apps/api          # testy jednostkowe API
npm run lint --workspace=apps/api
npm run test:e2e --workspace=apps/api      # e2e na prawdziwym Postgresie i Redisie (potrzebują .env.test i uruchomionego docker compose)
npm run test --workspace=apps/web
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web     # typy także w plikach testowych (krok CI)
```

Nowa migracja: zmień `apps/api/prisma/schema.prisma`, potem `npm run prisma:migrate --workspace=apps/api` i nazwij migrację. **Pułapka:**
Prisma nie wyraża części constraintów (partial unique index, złożone FK z `ON DELETE SET NULL (kolumna)`, CHECK-i), więc
`migrate dev`/`migrate diff` proponuje ich usunięcie - takie linie `DROP CONSTRAINT`/`DropForeignKey` **ręcznie usuwasz** z nowej migracji
(README, „Backlog bazy danych”). Sprawdzenie, że schemat i baza się zgadzają: `prisma migrate diff --from-url <baza> --to-schema-datamodel
apps/api/prisma/schema.prisma --script` powinno pokazać wyłącznie te SQL-only FK. Cała aplikacja wymaga PostgreSQL 15+.

## 5. Pułapki, na które ktoś już wpadł

- **CI ≠ lokalnie.** CI (job `e2e` w `.github/workflows/build-images.yml`) działa na Linuksie z Node 20, 2 rdzeniami, Postgresem 16 i Redisem 7.
  Błędy typu `ECONNRESET`, wyścigi i limity puli połączeń wychodzą tylko tam. Przed uznaniem zadania za skończone odtwórz to lokalnie: kontener
  `node:20` z `--cpus=2`, kontenery `postgres:16` i `redis:7` w jednej sieci Dockera, zmienne z sekcji `env` joba `e2e`, rola `cyberszkolo_app` ze
  skryptu `docker/postgres-init/01-create-app-role.sh`, `prisma migrate deploy`, `jest --config ./test/jest-e2e.json --runInBand`. Po zmianie
  `schema.prisma` wygeneruj klienta Prisma w kontenerze (`prisma generate`), inaczej testy nie skompilują się na starym kliencie.
- **E2E biegną szeregowo (`--runInBand`), tak jak w CI.** Specyfikacje dzielą jedną bazę i jeden Redis, a część z nich przechodzi po WSZYSTKICH
  organizacjach (joby sprzątania, retencji, powiadomień) i czyści dane po sobie. Równoległe uruchomienie dawało losowe błędy (znikające konta
  po rejestracji, `P2025`, przekroczone 5 s w hookach), których w CI nie ma. Skrypt `test:e2e` ma flagę wpisaną; przy ręcznym `jest` dodaj ją sam.
- **E2E z równoległymi żądaniami:** `app.listen(0)`, nie `app.init()`, i `Promise.allSettled` (CLAUDE.md, reguła 9).
- **Throttling w e2e:** limity żądań są w pamięci procesu; specyfikacje czyszczą magazyn throttlera (`ThrottlerStorage`) przed testami, które robią
  wiele logowań/rejestracji. Limiter maili jest w Redisie: testy używają własnego `REDIS_KEY_PREFIX` i czyszczą swoje klucze.
- **Zegar w testach zadań w tle:** logika przyjmuje `now: Date`; tokeny tworzone przez kod używają prawdziwego zegara, więc „zamrożony” `now`
  ustawiaj wokół chwili rzeczywistej, nie w dalekiej przyszłości.
- **CHECK w Postgresie przepuszcza NULL:** w ograniczeniach używaj `IS NOT DISTINCT FROM`. Nowej wartości enuma nie da się użyć w tej samej
  migracji, w której powstała.
- **Edycja plików przez narzędzie do edycji plików**, nie przez `echo`/heredoc/`sed -i` (CLAUDE.md, reguła 7); hook `.claude/hooks/block-file-writes.js`
  blokuje takie próby. Pliki tymczasowe (np. wynik testów) zapisuj poza repo, np. do `/tmp`.
- **Daty w web** formatuj wyłącznie przez `apps/web/src/lib/datetime.ts` (strefa `Europe/Warsaw`), nigdy `toLocale*String`/`Intl.DateTimeFormat`.
- **Windows:** repo ma końce linii LF w plikach, git ostrzega o zamianie na CRLF - to nie jest błąd.
- **Sporadyczne „Jest did not exit” przy zielonych testach** nie blokuje (znane, patrz `docs/phishing-simulations.md`).

## 6. Docker: nie buduj obrazów na VPS

Obrazy `api` i `web` buduje GitHub Actions i wypycha do GHCR; VPS ich tylko pobiera (ma 1 GB RAM, `next build` kończy się tam OOM).
Wdrożenie: `docs/deploy-test.md`.

## 7. Mapa dokumentów

| Dokument | Po co |
|---|---|
| `CLAUDE.md` | Konwencje, Zasada nr 1, lista wyjątków od RLS, workflow, praca zespołowa. Czytaj w całości. |
| `docs/decisions.md` | Rejestr decyzji: co rozstrzygnięto, dlaczego, gdzie w kodzie. |
| `docs/backlog-issues.md` | Backlog gotowy do założenia jako zgłoszenia w GitHub. |
| `README.md` | Uruchomienie, komendy, wdrożenie, backlogi modułów, opis modułów (sesje, zadania w tle, e-mail, grywalizacja). |
| `docs/phishing-simulations.md` | Symulacje, wyniki, zgłoszenia, prywatność wyników, znane ograniczenia. |
| `docs/user-import.md` | Import CSV, kolejka zaproszeń, brak sondy istnienia kont, pierwszeństwo do adresu. |
| `docs/legal/privacy-policy-checklist.md` | Rejestr przetwarzania danych osobowych (retencja, role stron, DPIA). Zmiana zakresu danych = aktualizacja. |
| `docs/deploy-test.md` | Wdrożenie testowe na VPS przez Cloudflare Tunnel i GHCR, checklista startu produkcyjnego. |
| `docs/e2e-registration.md` | Przeglądarkowy test ścieżki rejestracji (Playwright, poza CI). |
| `docs/content-backlog-elearning.md` | Backlog treści szkoleniowych. |

## 8. Twój pierwszy PR

1. Weź zgłoszenie z etykietą `good first issue` (albo poproś właściciela produktu o wskazanie z `docs/backlog-issues.md`).
2. Branch `<typ>/<numer>-<opis>` z aktualnego `main`.
3. Zmiana + testy (w tym A/B, jeśli dotyka danych klienckich) + lint + `typecheck` (web) + e2e.
4. Otwórz PR z wypełnionym szablonem; dla zmian w auth/RLS/wysyłce/imporcie najpierw przegląd `security-reviewer`.
5. Zielone CI, review, merge (rebase and merge). Decyzję, którą podjęto po drodze, dopisz do `docs/decisions.md`.

W razie wątpliwości co do konwencji CLAUDE.md każe pytać zamiast zgadywać - zrób to.
