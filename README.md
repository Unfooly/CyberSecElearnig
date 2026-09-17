# CyberSzkoło

Wielodostępowa (multi-tenant) platforma SaaS do szkoleń z cyberbezpieczeństwa i symulacji
phishingowych, sprzedawana firmom (B2B). Pełny kontekst projektu: [`CLAUDE.md`](./CLAUDE.md).

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
RLS + role Postgresa, rate limiting na `/auth/login` i `/auth/register` oraz ujednolicony
komunikat błędu rejestracji są już zaimplementowane. Pozostałe punkty, do zrobienia w
osobnych zadaniach:

- **Brak rewokacji refresh tokenów / brak `/auth/logout`.** Wyciekły refresh token jest ważny
  przez pełne 7 dni i nic go nie unieważni — potrzebna tabela sesji/`jti` i endpoint wylogowania.
- **Globalna unikalność e-maila między organizacjami** (`User.email` ma `@unique`, nie
  `@@unique([organizationId, email])`) — potwierdzić, czy to świadoma decyzja produktowa (ta
  sama osoba nie może dziś mieć kont w dwóch różnych organizacjach-klientach pod tym samym
  adresem).
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

## Backlog frontendu (`apps/web`)

Z code review ekranów logowania (`/login`) i dashboardu admina (`/dashboard`).

- **Rozjazd typów DTO między frontendem a `apps/api`.** `apps/web/src/app/dashboard/page.tsx`
  (`OverviewData`) i `apps/web/src/app/dashboard/_components/DepartmentsTable.tsx`
  (`DepartmentRow`) ręcznie odwzorowują pole-po-polu `DashboardOverviewDto` i
  `DepartmentCompletionDto` z `apps/api/src/dashboard/dto/`. Dla MVP akceptowalne —
  `packages/shared` eksportuje dziś wyłącznie `Role` — ale przy kolejnym module (kursy,
  kampanie phishingowe) ręczne duplikowanie kształtu łatwo doprowadzi do rozjazdu pól przy
  zmianie backendu bez aktualizacji frontu. Warto zaplanować przeniesienie współdzielonych DTO
  do `packages/shared`, zanim liczba duplikowanych interfejsów urośnie.
- **Brak endpointu wylogowania** (`/api/auth/logout`) — `clearAuthCookies` istnieje
  (`apps/web/src/lib/auth-cookies.ts`) i jest używane wewnętrznie przez `middleware.ts` przy
  redirectach, ale nie jest wystawione jako endpoint. Bez niego httpOnly refresh token żyje
  pełne 7 dni niezależnie od intencji użytkownika. Świadomie poza zakresem zadania "login +
  dashboard".
- **Login CSRF, niskie ryzyko.** `/api/auth/login` (jedyny stanowy endpoint frontendu) wymaga
  `Content-Type: application/json`, czego zwykły cross-site `<form>` nie potrafi wysłać, więc
  prosty atak formularzowy kończy się na 400. Warto pamiętać przy dodawaniu kolejnych stanowych
  endpointów frontendu (np. logout) — rozważyć wtedy CSRF token albo `sameSite: 'strict'` tam,
  gdzie to możliwe.
