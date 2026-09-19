# CLAUDE.md

Ten plik jest czytany automatycznie na starcie każdej sesji Claude Code w tym repo. Traktuj go jako źródło prawdy o konwencjach projektu — jeśli coś tu jest niejasne albo nieaktualne, zapytaj zamiast zgadywać.

## Co budujemy

Wielodostępowa (multi-tenant) platforma SaaS do szkoleń z cyberbezpieczeństwa i symulacji phishingowych, sprzedawana firmom (B2B). Inspiracja funkcjonalna: SoSafe.

Moduły MVP (w tej kolejności priorytetu):
1. Organizacje i użytkownicy (auth, role, multi-tenant)
2. E-learning (kursy, przypisania, tracking postępu)
3. Symulacje phishingowe (szablony, kampanie, landing page, tracking)
4. Zgłaszanie zagrożeń (formularz + skrzynka zgłoszeń)
5. Dashboard i raporty

Pełna specyfikacja: `docs/mvp-spec.md` (skopiuj tam wcześniejszy dokument MVP).

## Stos technologiczny

- **Backend:** Node.js + NestJS, TypeScript
- **ORM / baza:** PostgreSQL + Prisma
- **Frontend:** Next.js (React) + TypeScript + Tailwind CSS
- **Kolejki / scheduler:** BullMQ + Redis (wysyłka kampanii phishingowych, przypomnienia mailowe). Dziś działa jeden worker w procesie API (`apps/api/src/jobs/`), obsługujący zadania cykliczne - patrz sekcja „Zadania w tle”.
- **Auth:** własny JWT (access + refresh token); SSO/SAML/OIDC to backlog v2, nie buduj teraz
- **E-mail:** MailerSend (REST API `POST /v1/email`, klient w `apps/api/src/email`, szablony renderowane w kodzie) — kampanie phishingowe idą z OSOBNEJ domeny niż e-maile transakcyjne; przed produkcją wymagana własna, zweryfikowana domena nadawcy (dziś domena trial MailerSend)
- **Płatności:** Stripe (subskrypcje per liczba licencji) — na MVP wystarczy webhook + ręczna obsługa planów, pełny self-service billing to v2
- **Hosting:** UE (wymóg RODO) — zakładamy AWS eu-central-1
- **Testy:** Jest (backend), Playwright (e2e krytycznych ścieżek), Vitest + React Testing Library (frontend)

Nie proponuj innego stosu bez pytania — jeśli któraś technologia okaże się złym wyborem, zgłoś to zamiast po cichu zmieniać.

## Zasada nr 1: izolacja danych między organizacjami

To jest najważniejsza reguła w całym projekcie. Złamanie jej = wyciek danych jednego klienta do drugiego.

- Każda tabela z danymi klienckimi ma kolumnę `organizationId`.
- Każde zapytanie do bazy MUSI filtrować po `organizationId` bieżącego użytkownika — bez wyjątków, nawet w skryptach administracyjnych i seedach.
- Włącz Row-Level Security (RLS) w Postgresie jako drugą linię obrony, nie poleganie wyłącznie na filtrach w kodzie aplikacji.
- Każdy nowy endpoint API musi mieć test sprawdzający, że użytkownik z organizacji A nie ma dostępu do danych organizacji B.
- Jeśli piszesz kod, który dotyka danych klienckich i nie widzisz w nim filtra po `organizationId` — zatrzymaj się i zapytaj, zanim to scommitujesz.

## Model rejestracji firm (samoobsługowy) i weryfikacja domeny

Firmy zakładają konta same, bez udziału operatora. Przepływ (kod: `apps/api/src/auth/registration.service.ts`,
`apps/api/src/organizations/`, ekrany w `apps/web/src/app/{register,onboarding,dashboard/settings}`):

1. **Rejestracja** (`POST /auth/register`): dane administratora (imię, nazwisko, **służbowy** e-mail), dane firmy (pełna
   nazwa, nazwa wyświetlana, NIP z sumą kontrolną, adres, kraj - na razie tylko PL) i dwie zgody (regulamin, polityka
   prywatności; zapisywane w `legal_acceptances` z wersją dokumentów). **Formularz nie ma pól hasła.** Domeny
   publiczne (Gmail, WP itd.) i sieci wewnętrznych (`.local`, `.internal`, `.corp`, `.lan`) są odrzucane. Nazwa
   organizacji jest podawana przez klienta i **nie** wynika z domeny e-maila (nie jest unikalna).
2. **Potwierdzenie skrzynki = ustawienie hasła.** Admin powstaje jako `INVITED` z losowym hashem; mail (ważny 24 h)
   prowadzi do `/reset-password`, które ustawia hasło, aktywuje konto i potwierdza e-mail. Dzięki temu nikt nie założy
   konta cudzym adresem ze swoim hasłem (pre-hijacking). Odpowiedź rejestracji jest identyczna dla nowych i istniejących
   adresów (anty-enumeracja) - nie zmieniaj tego.
3. **Weryfikacja domeny DNS TXT.** Nowa organizacja ma status `PENDING_DOMAIN_VERIFICATION`. Admin dodaje rekord
   `_unfooly-verify.<domena> = "unfooly-verify=<token>"` i klika „Sprawdź teraz”. **`verifiedAt` i status `ACTIVE`
   ustawia wyłącznie `DomainVerificationService`** - nigdy inny kod. Każda porażka weryfikacji zwraca ten sam błąd
   (bez ujawniania przyczyny, także gdy domena jest już zweryfikowana w innej organizacji).
4. **Guard PENDING (fail-closed).** Globalny `ActiveOrganizationGuard` zwraca 403 dla organizacji niezweryfikowanej na
   **każdym** endpoincie, chyba że oznaczono go `@AllowPendingOrganization()` (dziś: auth, `/organization/*`, avatar).
   Nowy endpoint jest więc domyślnie zablokowany dla PENDING - dodaj dekorator tylko, jeśli endpoint ma działać przed
   weryfikacją (i uzasadnij to). Przekierowania na `/onboarding` w `apps/web` to wyłącznie UX, ochrona jest w API.
5. **Po weryfikacji:** organizacja `ACTIVE`, w ustawieniach można włączyć `selfJoinEnabled`.
6. **Sprzątanie:** organizacja PENDING dostaje mail po 7 dniach i jest usuwana wraz z danymi po 14 dniach (job w tle).

Dane do faktury (`organization_billing_details`) są osobną tabelą z RLS (`organizations` jest globalna, bez RLS) -
nowe dane firmowe/osobowe dodawaj do tabel objętych RLS, nie do `organizations`. Tabela `organizations` jest wyjątkiem:
zapytania na niej filtruj po `id` organizacji z JWT (albo po `id` konkretnej organizacji w jobach).

**Planowane (nie buduj bez decyzji):** SSO Microsoft (Entra ID), fakturowanie w Stripe z danych
`organization_billing_details`, pełny flow samodzielnego dołączania pracowników (dziś jest tylko przełącznik
`selfJoinEnabled`, którego nic jeszcze nie czyta), kraje poza PL i numer VAT. Szczegóły i pozostały backlog: README.

**Warunek publicznego startu:** finalne dokumenty prawne (bez placeholderów i `noindex`, właściwa
`LEGAL_DOCUMENT_VERSION`) - patrz `docs/deploy-test.md` sekcja 9 i `docs/legal/privacy-policy-checklist.md`.
Zmiana zakresu przetwarzania danych osobowych wymaga aktualizacji tej checklisty.

## Zadania w tle (BullMQ)

Jeden worker w procesie API (`JobsService`, kolejka `maintenance`, Redis z `REDIS_URL`). Jak dodać kolejny job cykliczny
(np. OVERDUE, przypomnienia kampanii):

1. W module funkcji dodaj serwis z metodą wykonującą pracę (przyjmuje `now: Date`, żeby testować z zamrożonym zegarem)
   i wstrzyknij `JobsService`.
2. W `onModuleInit` serwisu wywołaj `jobs.registerRecurring({ name, cron, handler })` (cron w UTC). Harmonogram to
   idempotentny upsert - wiele instancji API nie dubluje zadania. Wzorzec: `PendingOrganizationCleanupService`.
3. Zadanie **musi być idempotentne** (retry: 3 próby, backoff 60 s) i race-safe (atomowe zajmowanie pracy, np. warunek w
   `updateMany`). Błędy pojedynczych rekordów łap i loguj (bez danych osobowych), żeby jeden nie blokował reszty.
4. Zadanie nie może omijać RLS: dane klienckie czytaj przez `runInOrgContext(organizationId, ...)`. Zapytania
   międzyorganizacyjne tylko przez istniejące, opisane wyjątki (`TenantPrismaService`) i z uzasadnieniem.
5. Testy: e2e z zamrożonym zegarem (granice czasu, powtórne biegi, równoległe biegi, awarie wysyłki, izolacja A/B).
   Test na prawdziwym Redisie tylko z własnym `JOBS_QUEUE_PREFIX`.
6. Konfiguracja: `BACKGROUND_JOBS_ENABLED` (wyłączone w `NODE_ENV=test`), `JOBS_QUEUE_PREFIX`. Nowa tabela z
   `organizationId` musi mieć `onDelete: Cascade` do `organizations` (inaczej sprzątanie organizacji się zatnie).

## Role i uprawnienia

- `SUPER_ADMIN` — wy, dostęp do wszystkich organizacji (panel operacyjny, nie mylić z rolami klienta)
- `ORG_ADMIN` — admin po stronie klienta, zarządza pracownikami/kampaniami/kursami swojej organizacji
- `DEPARTMENT_MANAGER` — widzi tylko swój dział (jeśli już zaimplementowane; w MVP v1 opcjonalne)
- `EMPLOYEE` — uczestniczy w szkoleniach i symulacjach

Sprawdzanie uprawnień robimy w guardach/middleware backendu, nigdy tylko po stronie frontendu.

## Struktura repo (docelowa)

```
/apps
  /api        -> NestJS backend
  /web        -> Next.js frontend (admin + panel pracownika)
/packages
  /shared     -> typy współdzielone (DTO, enumy ról itd.)
/prisma
  schema.prisma
/docs
  mvp-spec.md
```

Jeśli struktura jeszcze nie istnieje, zaproponuj ją przy pierwszym zadaniu i poczekaj na akceptację, zanim rozbudujesz dalej.

## Workflow pracy z agentem

1. **Najpierw plan, potem kod.** Przy każdym większym zadaniu (nowy moduł, zmiana schematu bazy) opisz plan i poczekaj na potwierdzenie zanim zaczniesz pisać.
2. **Małe, kompletne kroki.** Jeden moduł na sesję/zadanie, nie całą platformę naraz.
3. **Testy obowiązkowe.** Nowa funkcja bez testu nie jest skończona. Minimum: happy path + jeden przypadek brzegowy + test izolacji tenantów (jeśli dotyczy danych klienckich).
4. **Migracje bazy danych** zawsze przez Prisma Migrate, nigdy ręczne ALTER TABLE. Migracja + odpowiadający jej update `schema.prisma` w tym samym commicie.
5. **Sekrety** (klucze API, connection stringi) tylko w zmiennych środowiskowych / `.env` (nieopublikowanym), nigdy hardkodowane w kodzie.
6. **Commity małe i opisowe.** Jeden commit = jedna logiczna zmiana.
7. **Pliki edytujesz narzędziem do edycji plików** (Write/Edit), nigdy przez `echo`, `cat` ani heredoc w powłoce. Powłoka interpretuje backticki i `$(...)` w treści jako komendy: tak backticki w README wykonały się jako polecenia, uruchomiły testy e2e i zostawiły dziury w tekście. Powłoka służy do uruchamiania poleceń, nie do zapisywania treści plików. Dotyczy to także skryptów Python/Node uruchamianych z powłoki do modyfikacji plików (w tym jednorazowych `python - <<EOF`, `node -e`, `sed -i`): jedyny dozwolony sposób edycji plików to Write/Edit.

## Komendy

Uzupełnij po utworzeniu szkieletu projektu (Claude Code ma je uruchamiać przed uznaniem zadania za zakończone):

```bash
# backend
npm run test --workspace=apps/api
npm run lint --workspace=apps/api

# frontend
npm run test --workspace=apps/web
npm run lint --workspace=apps/web

# baza danych
npx prisma migrate dev

# e2e API (Postgres + Redis lokalnie; w CI: job `e2e` w .github/workflows/build-images.yml)
npm run test:e2e --workspace=apps/api

# e2e w przeglądarce całej ścieżki rejestracji (opis: docs/e2e-registration.md)
npx dotenv -e .env -- node scripts/e2e-registration.mjs
```

## Czego NIE robić w MVP (backlog v2+)

- SSO/SCIM (Okta, Entra ID, Google Workspace)
- AI chatbot bezpieczeństwa
- Automatyczna personalizacja trudności treningu wg profilu ryzyka
- Benchmarking branżowy
- Wielojęzyczność (na start: PL + EN wystarczy w danych, nie buduj pełnego i18n frameworka od razu)
- Pełny self-service billing z wieloma planami — na MVP wystarczy Stripe + ręczna zmiana planu przez super-admina

Jeśli zadanie zaczyna dryfować w stronę czegoś z tej listy — zatrzymaj się i zapytaj, czy faktycznie tego chcemy teraz.
