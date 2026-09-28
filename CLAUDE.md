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

### Wyjątki od Zasady nr 1 (omijanie RLS): pełna lista

Wszystkie idą przez `TenantPrismaService` (sentinel `app.bypass_tenant_rls`, w politykach RLS wyłącznie w `USING`
odczytu, nigdy w `WITH CHECK`); nowy wyjątek wymaga decyzji, opisu w kodzie i wpisu tutaj. Zapisy zawsze przez
`runInOrgContext(organizationId)` po odczycie.

1. `runAuthLookup` - użytkownik po globalnym e-mailu/id (login, refresh, reset, rejestracja - tylko sprawdzenie istnienia;
   oraz `AddressClaimService` przy zaproszeniu/imporcie/potwierdzeniu rejestracji - decyzja o przejęciu nieaktywowanego zaproszenia).
   Dlaczego bezpieczne: wynik (rekord konta) służy wyłącznie do decyzji wewnątrz serwisu i nigdy nie trafia do klienta (odpowiedź
   API jest taka sama dla adresu wolnego i zajętego, więc nie da się enumerować kont); przy zaproszeniu/imporcie odczyt idzie
   dopiero po sprawdzeniu, że wnioskująca organizacja ma zweryfikowaną (DNS) domenę dokładnie tego adresu; przy rejestracji
   (`POST /auth/register`, publiczne) sam odczyt niczego nie zmienia, a przejęcie następuje dopiero po kliknięciu linku, który
   dostaje wyłącznie właściciel skrzynki; usunięcie cudzego konta idzie przez `runInOrgContext` (organizacja właściciela), nigdy
   przez bypass.
2. `runPasswordResetTokenLookup`, 3. `runEmailVerificationTokenLookup` - token po `tokenHash`, zanim znamy organizację.
4. `runRefreshTokenLookup` - refresh token po `tokenHash` (sesje).
5. `runTrackingTokenLookup` - odbiorca kampanii po `tokenHash` tokenu z linku symulacji (publiczne `POST /t/:token/view|submit`;
   sztywny `findUnique`, wąski `select` bez e-maila i treści). Ma WŁASNY sentinel `app.bypass_tracking_lookup` (migracje
   `phishing_tracking*`), honorowany wyłącznie w polityce SELECT `phishing_campaign_recipients`: generyczny
   `runCrossOrgQuery` (poz. 7) odbiorców kampanii NIE widzi.
6. `listCampaignsToReconcile` - pary (id, organizationId) kampanii do uzgodnienia przez `CampaignReconcileService`
   (bypass tylko w SELECT `phishing_campaigns`).
7. `runCrossOrgQuery` - dashboard SUPER_ADMIN i sprzątanie wygasłych refresh tokenów (jawny warunek `where` po stronie wołającego).

Nie jest wyjątkiem, ale wymaga tu wzmianki: `TenantPrismaService.runInOrgContextsSequence` (jedna transakcja, w której kolejne
kroki idą pod RLS RÓŻNYCH organizacji; bez sentinela bypass, polityki bez zmian) służy **wyłącznie do przejęcia adresu**
(`RegistrationService.claimRegistration`: usunięcie cudzego nieaktywowanego zaproszenia + utworzenie admina atomowo).
Nowy wywołujący wymaga decyzji i wpisu tutaj; identyfikatory organizacji muszą pochodzić z zaufanego źródła, nigdy wprost z żądania.

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
   **każdym** endpoincie, chyba że oznaczono go `@AllowPendingOrganization()` (dziś: auth, `/organization/*`, avatar oraz publiczne `/t/*`
   - śledzenie symulacji: trasa bez sesji i bez kontekstu organizacji wywołującego, oznaczona też `@SkipSessionCheck()`).
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
   Zadania jednorazowe z danymi i opóźnieniem (np. wysyłka jednego maila kampanii): `jobs.registerTask({ name, handler(data) })`
   i `jobs.enqueueDelayed(name, data, { delayMs, jobId })` (dedup po `jobId`, bez `:`), usuwanie `jobs.removeQueued([jobId])`.
   Dane zadania to same identyfikatory (organizationId + id rekordu), nigdy dane osobowe; stan i wynik trzymamy w bazie, a
   kolejka to tylko wyzwalacz (zadanie uzgadniające odtwarza zgubione). Wzorzec: `apps/api/src/phishing/campaigns/`.
6. Konfiguracja: `BACKGROUND_JOBS_ENABLED` (wyłączone w `NODE_ENV=test`), `JOBS_QUEUE_PREFIX`. Nowa tabela z
   `organizationId` musi mieć `onDelete: Cascade` do `organizations` (inaczej sprzątanie organizacji się zatnie).

## Silnik szkoleń (`packages/content`)

Kursy to treść (JSON modułu zwalidowany zod), nie kod; szczegóły i format: `packages/content/README.md`, decyzje: D-051. Niezmienniki:

1. **Klucz odpowiedzi nigdy nie trafia do klienta.** Treść bloku idzie do przeglądarki wyłącznie przez `toClientBlock` (biała lista pól,
   `FIELD_CLASSIFICATION`). Nowe pole schematu bloku musi być sklasyfikowane jako `client` albo `secret` (test kompletności wywala CI), a
   podpowiedzi, rozwiązania i poprawne odpowiedzi to zawsze `secret`. Nigdy nie zwracaj `Course.contentBlocks` ani `CourseVersion.contentBlocks`
   wprost w odpowiedzi API.
2. **Ocenę wylicza wyłącznie serwer** (`apps/api/src/courses/scoring`); klient wysyła swój wybór, nigdy poprawność ani punkty.
3. **Treść jest wersjonowana i niemutowalna** (`course_versions`): zmiana treści = nowa wersja, przypisanie zostaje na swojej. Nigdy nie
   edytuj zapisanej wersji ani `blockId` opublikowanego bloku. `progress` jest kluczowany `blockId`.
4. **Id elementów ocenianych po id (ORDERING, kryteria EMAIL_ANALYSIS) są dla klienta nieprzejrzyste** (HMAC z kluczem serwera, inne w każdym
   przypisaniu); tasowanie ma seed z tego samego klucza, nigdy z samych publicznych identyfikatorów. SVG tylko przez `<img>`; `EMBEDDED_HTML` tylko w
   `<iframe sandbox>` bez `allow-same-origin`.
5. **Kurs z przypisaniami nie da się usunąć** (`RESTRICT`). W testach e2e sprzątaj organizacje (kasują przypisania kaskadowo) PRZED kursami:
   `deleteMany` przypisań bez kontekstu organizacji ich nie widzi (FORCE RLS).
6. **Każda grafika otwierana kliknięciem (zbliżenie przedmiotu, dokument, okno, ekran) ma przezroczyste tło** (D-101): przedmioty/dokumenty/okna →
   `scripts/content/scenes/crop-zooms.ts` (`wall: 'none'`, ciasny kadr); ekrany komputera → `scripts/content/scenes/wrap-in-monitor.ts`. Test w CI
   (`scripts/content/scenes/transparent-zooms.test.ts`): każdy plik z `media.image` i `media.scene` w module ma `<svg>` bez prostokąta tła na całą
   scenę (albo jest owinięty ramką monitora - sama ramka takiego prostokąta nie rysuje). Szczegóły i kolejność pracy: `docs/content/MODULE-PLAYBOOK.md`.

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
8. **Status CI po pushu.** Dopóki nie masz dostępu do GitHub Actions, po pushu raportujesz „wypchnięte, czekam na status CI” (razem z hashem) i prosisz użytkownika o status runa. Zielone testy lokalne nie oznaczają zielonego CI (inna liczba rdzeni, wersja Node, pula połączeń) - nie pisz „gotowe”, dopóki nie znasz wyniku CI. Nie zaczynaj kolejnego kroku, gdy CI jest czerwone.
9. **E2E API: równoległe żądania = `app.listen(0)`, nie `app.init()`.** Supertest na nie-nasłuchującym serwerze robi z pierwszego żądania „właściciela”, który zamyka serwer po swojej odpowiedzi i zrywa (`read ECONNRESET`) pozostałe żądania w locie; wychodzi to na Linuksie/Node 20 (CI), nie na Windows/Node 24. Serie żądań czekaj przez `Promise.allSettled`. Replika CI lokalnie: kontener `node:20` z `--cpus=2`, Postgres 16 i Redis 7 w Dockerze, dane z joba `e2e`. **Do czasu B-085 nie da się uruchomić `test:e2e` lokalnie** (kontenery `ci-pg`/`ci-redis` nie publikują portów na hosta) - zmiana wspólnej fixtury treści (`packages/content` `fullModule()`/`fullBlocks()`, np. liczba lub kolejność bloków) wymaga ręcznego przejrzenia `apps/api/test/course-engine.e2e-spec.ts` pod kątem twardo zakodowanych `blockIndex` i `currentBlockIndex` (żadnego zaufania, że "testy jednostkowe apps/api przeszły" wystarczy - ten plik jest e2e i idzie tylko na CI) - zweryfikuj wynikiem CI, nie lokalnym przebiegiem.

10. **„Nie gotowy do commitu” od security-reviewera = brak commitu.** Wracasz do użytkownika z listą uwag (także gdy dotyczą jego
    wcześniejszych decyzji), użytkownik rozstrzyga każdą, dopiero potem robisz commit (poprawki jako osobny commit, gdy to
    kolejna iteracja). Nie commituj „bo uwagi wynikają z decyzji użytkownika” ani „a uwagi opiszę w raporcie po fakcie”.

11. **Żadnych poleceń niszczących na origin ani na main.** Nie uruchamiasz: `git push --force`/`-f`/`--force-with-lease`, `git push --delete`/`-d`,
    `git push <remote> :<ref>` (usunięcie refu), `--mirror`/`--all`, pushu NA `main`, `git branch -D`, `git reset --hard`, `git clean -f`,
    `git checkout -- .`/`git restore .` (odrzucenie zmian z całego drzewa), rebase gałęzi `main` (będąc na `main` albo z `main` jako rebasowaną
    gałęzią), aliasów gita ukrywających takie polecenia, ani `gh repo delete`, `gh release delete`, `gh pr merge` (poza wyjątkiem niżej), `gh api`
    z metodą DELETE lub zmieniającego refy - także „na próbę”, także z `--dry-run` w tej formie.
    **Wyjątek - merge przez agenta (decyzja właściciela, 2026-09-27): WYŁĄCZNIE `node scripts/dev/safe-merge.mjs <nr PR>`.** `gh pr merge`
    wprost zostaje w `permissions.deny` i w hooku; w `permissions.allow` jest tylko wywołanie tego skryptu, a jego edycja przez agenta
    (`Edit`/`Write` na `scripts/dev/safe-merge*`) jest w deny. Skrypt odmawia (i wypisuje, który warunek zablokował), jeśli: PR nie jest
    otwarty/mergeable do `main` albo nie jest aktualny względem `main`; wymagane sprawdzenia (`lint + testy`, `testy e2e (api)` z workflow
    `build-images`) nie są zielone na HEAD PR albo jakieś sprawdzenie jest czerwone/w toku; HEAD PR różni się od lokalnego HEAD po `git fetch`,
    drzewo ma niezacommitowane zmiany albo uruchomiony skrypt różni się od wersji z `origin/main`; PR zmienia `.github/**`, `.claude/**`,
    `.githooks/**`, `CLAUDE.md`, `scripts/dev/safe-merge*`, `docker/**`, compose, Dockerfile/`.dockerignore`, `Caddyfile`, pliki env/sekretów,
    dowiązania symboliczne; PR zmienia cokolwiek pod `apps/api/prisma/migrations/` (każda migracja, także addytywna, idzie do człowieka -
    bez analizy SQL); opis PR nie ma niepustych sekcji „Decyzje autopilota” i „Jak to sprawdzono”. Dopiero wtedy woła
    `gh pr merge <nr> --rebase --delete-branch --match-head-commit <sprawdzony sha> -R <repo>` (bez ruszania lokalnego katalogu). To bariera
    przed odruchem, nie sandbox. **Przed wywołaniem** agent i tak musi mieć: code-reviewer = gotowy,
    security-reviewer = gotowy (jeśli PR dotyka API/bazy/auth/walidacji), layout-check zielony (jeśli player/UI), `--check` i
    `--assets --check` zielone - tych warunków skrypt nie sprawdza. PR-y, których skrypt nie przepuszcza, czekają na człowieka. **Do sprawdzania hooków i uprawnień służy
    wyłącznie:** `--dry-run` (gdy polecenie go obsługuje i nie jest z powyższej listy), tymczasowe repozytorium (`git init` w katalogu
    tymczasowym z lokalnym „origin” w tym katalogu) albo test jednostkowy hooka (`.githooks/pre-push.test.js`,
    `.claude/hooks/block-destructive-git.test.js`) - **nigdy prawdziwy origin**. Rebase własnego brancha roboczego na `origin/main` jest dozwolony
    (tak go aktualizujemy); zabroniony jest rebase, gdy aktualną gałęzią jest `main` (regułę rebase egzekwuje wyłącznie hook, który zna aktualną
    gałąź; `permissions.deny` nie potrafi jej rozróżnić). Egzekwują to mechanicznie: `permissions.deny` w `.claude/settings.json` oraz hook
    PreToolUse `.claude/hooks/block-destructive-git.js` (bo `permissions.deny` bywa pomijane w trybie auto); jest to bariera przed odruchem,
    nie sandbox (nie wykryje m.in. poleceń ze zmiennych, skryptów i aliasów z `~/.gitconfig`; fail-open przy uszkodzonym wejściu hooka). Jeśli coś z listy jest naprawdę potrzebne, zatrzymaj się i zapytaj użytkownika.

12. **Zmiana układu odtwarzacza = `layout-check` przed pushem.** PR dotykający `PlayerStage.tsx`, `SceneHotspotsBlock.tsx`,
    `ScenePanContainer.tsx`, `DialogueBlock.tsx`, kart hotspotu/bottom sheeta/wątku rozmowy uruchamia lokalnie
    `node scripts/layout-check.mjs` (Playwright, prawdziwa
    przeglądarka - jsdom nie liczy layoutu CSS: container query, grid, `cqw`/`cqh` - nie złapie regresji, które łapie ten skrypt;
    poznane na fix/hotspot-card-fit/B-101, druga runda code review) przed pushem i wkleja wynik (tabela viewport × przypadek →
    OK/błąd) do opisu PR. Skrypt spawnuje `next dev` z `NEXT_PUBLIC_DEV_HARNESS=1` (strona
    `apps/web/src/app/dev/player-harness/page.dev.tsx` - treść wprost z `packages/content`, bez backendu/logowania) - nie wymaga
    Postgresa/Redisa/apps/api. Jeszcze NIE jest częścią
    CI (B-101 w backlogu: „layout-check w CI”) - do czasu tamtej zmiany to lokalny, ręczny krok, nie automatyczna bramka.

13. **Jeden katalog roboczy jest współdzielony.** Nie przełączaj gałęzi, gdy prosisz mnie o publikację assetów/TTS. W prośbie o
    publikację zawsze podawaj gałąź i wynik `--check`; publikacja tylko z gałęzi PR. (Poznane na fix/company-name: publikacja
    uruchomiona po przełączeniu katalogu na gałąź z `main` widziała stare pliki i nic nie opublikowała.)

## Praca zespołowa: branże i pull requesty

Dotyczy ludzi i agentów (Claude Code) tak samo. Powiązane dokumenty: `.github/pull_request_template.md` (szablon opisu PR),
`docs/decisions.md` (rejestr decyzji), `docs/onboarding.md` (start nowej osoby), `docs/backlog-issues.md` (backlog jako zgłoszenia).

- **`main` jest zawsze wdrażalny i chroniony.** Zmiany trafiają tam wyłącznie przez pull request; nikt nie pushuje na `main`
  bezpośrednio (agent też pracuje na branchu). Ustawienia GitHub (Settings → Branches → ochrona `main`): wymagany PR, wymagane zielone
  joby `lint + testy` i `testy e2e (api)`, co najmniej 1 zatwierdzenie, branch aktualny względem `main`, brak force-push. Ochrona
  gałęzi w GitHub wymaga planu Team (dziś Free), więc **do czasu upgrade'u działa blokada lokalna: hook `.githooks/pre-push` odrzuca
  każdy push na `refs/heads/main`** (też usunięcie i force-push). Włącz go raz na klon: `git config core.hooksPath .githooks` (albo
  `npm run hooks:install`); to krok 0 w `docs/onboarding.md`. Nie omijaj go `--no-verify`. Merge do `main` robi właściciel w GitHub po
  zielonym CI (albo agent przez `scripts/dev/safe-merge.mjs`, reguła 11), potem `git switch main && git pull`. Agent też pracuje na branchu i otwiera PR (reguła 8: po pushu podajesz hash i
  prosisz o status CI).
- **Nazwa brancha:** `<typ>/<numer-zgłoszenia>-<krótki-opis>`, np. `feat/142-import-csv`, `fix/155-limit-zaproszen`. Typy: `feat`, `fix`,
  `refactor`, `test`, `docs`, `chore`. Bez zgłoszenia pomijasz numer (`chore/typecheck-web`). Branch żyje krótko (dni, nie tygodnie); większe
  zadanie dzielisz na kilka PR-ów (reguła 2), a nie na jeden wielki branch.
- **Jeden PR = jedna logiczna zmiana** (reguła 6), z małymi, opisowymi commitami. Migracja bazy i odpowiadająca jej zmiana `schema.prisma`
  są w tym samym commicie (reguła 4). PR bez testu nie jest skończony (reguła 3), w tym test izolacji A/B dla każdego nowego endpointu.
- **Opis PR** wypełnia szablon `.github/pull_request_template.md` (po co, co się zmienia, jak sprawdzono, ryzyka: izolacja tenantów, migracje,
  wysyłka maili, dane osobowe). Nie usuwaj sekcji; wpisz „nie dotyczy”, jeśli punkt nie ma zastosowania.
- **Review:** co najmniej jedna osoba poza autorem. Przed otwarciem PR dotykającego auth, guardów, RLS, zapytań na danych klienckich,
  wysyłki maili, wyników symulacji albo importu: przegląd `security-reviewer`; w pozostałych przypadkach `code-reviewer`. Werdykt „nie
  gotowy” blokuje merge do decyzji właściciela produktu (reguła 10); uwagi wklejasz do opisu PR razem z rozstrzygnięciem. W trybie
  autopilota (merge przez `safe-merge`, reguła 11) rolę recenzenta pełnią agenci `code-reviewer`/`security-reviewer` z werdyktem „gotowy”;
  PR-y, których skrypt nie przepuszcza, dalej przegląda i merguje człowiek.
- **PR bez zielonych sprawdzeń nie jest mergowany.** Workflow `build-images` uruchamia na KAŻDYM pull requeście do `main` (także tylko z
  dokumentami) dwa sprawdzenia: `lint + testy` (lint API i web, testy jednostkowe API i web, `typecheck` web, testy skryptów i hooków: reguła 7
  oraz blokada pushu na `main`) i `testy e2e (api)` (Postgres + Redis, szeregowo). PR nie buduje ani nie publikuje obrazów (to tylko po
  pushu do `main`). Właściciel merguje dopiero, gdy oba sprawdzenia są zielone (po upgrade'ie planu wymusi to ochrona gałęzi, B-010).
  Czerwone CI blokuje też start następnego kroku (reguła 8). Sporadyczne „Jest did not exit” przy
  zielonych testach nie blokuje (patrz `docs/phishing-simulations.md`, „Znane ograniczenia”); każdy inny błąd tak.
- **Sposób scalania:** „Rebase and merge” dla PR z małymi, opisowymi commitami (zachowuje historię z reguły 6); „Squash and merge” tylko
  wtedy, gdy commity w PR to szum (poprawki, WIP) - squash robi wyłącznie człowiek (`safe-merge` zawsze robi rebase, więc agent przed
  merge sam porządkuje commity). Nigdy merge commit z `main` do brancha - aktualizujesz przez rebase.
- **Migracje w równoległych branchach:** nazwy migracji mają znacznik czasu, więc dwa branche mogą dodać migracje w dowolnej kolejności.
  Po zmergowaniu cudzej migracji robisz rebase i, jeśli twoja jest starsza niż zmergowana, zmieniasz jej znacznik czasu na nowszy.
  Nigdy nie edytujesz migracji, która trafiła na `main` - dodajesz nową.
- **Decyzje i backlog:** decyzja, która zmienia zachowanie produktu, bezpieczeństwo albo konwencje, dostaje wpis w `docs/decisions.md` w
  tym samym PR. Odłożone uwagi z review wchodzą do backlogu (`docs/backlog-issues.md`, potem zgłoszenie w GitHub) - nie znikają w komentarzu.
- **Sekrety i dane:** żadnych sekretów, dumpów bazy ani danych osobowych w commitach, opisach PR i logach CI (reguła 5).

## Daty i strefy czasowe (web)

Daty i godziny formatujemy **wyłącznie** przez `apps/web/src/lib/datetime.ts` (jawna strefa, domyślnie `Europe/Warsaw`; docelowo
`Organization.timezone`). Nie używaj `toLocale*String`, `Intl.DateTimeFormat`, `getHours()`, `getTimezoneOffset()` itp. poza tym plikiem:
serwer renderuje w UTC, a przeglądarka w strefie użytkownika, więc format bez strefy daje inne godziny w SSR i po hydracji. Pola
`datetime-local` to czas ścienny w strefie organizacji (`isoToZonedInput` / `zonedInputToIso`). Test `datetime.test.tsx` pilnuje reguły.

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
