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
- **Kolejki / scheduler:** BullMQ + Redis (wysyłka kampanii phishingowych, przypomnienia mailowe)
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
7. **Pliki edytujesz narzędziem do edycji plików** (Write/Edit), nigdy przez `echo`, `cat` ani heredoc w powłoce. Powłoka interpretuje backticki i `$(...)` w treści jako komendy: tak backticki w README wykonały się jako polecenia, uruchomiły testy e2e i zostawiły dziury w tekście. Powłoka służy do uruchamiania poleceń, nie do zapisywania treści plików.

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
```

## Czego NIE robić w MVP (backlog v2+)

- SSO/SCIM (Okta, Entra ID, Google Workspace)
- AI chatbot bezpieczeństwa
- Automatyczna personalizacja trudności treningu wg profilu ryzyka
- Benchmarking branżowy
- Wielojęzyczność (na start: PL + EN wystarczy w danych, nie buduj pełnego i18n frameworka od razu)
- Pełny self-service billing z wieloma planami — na MVP wystarczy Stripe + ręczna zmiana planu przez super-admina

Jeśli zadanie zaczyna dryfować w stronę czegoś z tej listy — zatrzymaj się i zapytaj, czy faktycznie tego chcemy teraz.
