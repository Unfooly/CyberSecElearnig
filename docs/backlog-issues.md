# Backlog jako zgłoszenia (issues)

Backlog rozproszony po README, `docs/*.md` i uwagach z przeglądów, zebrany w jednym miejscu **w formie gotowej do założenia jako
zgłoszenia w GitHub**. Każdy wpis ma tytuł, etykiety, priorytet, źródło, opis i kryteria akceptacji.

## Jak z tego korzystać

0. **Hurtowo:** `scripts/create-issues.sh` zakłada etykiety (`gh label create --force`) i zgłoszenia (`gh issue create`) ze wszystkich wpisów
   poniżej (wymaga `gh` i zalogowania: `gh auth login` albo `GH_TOKEN`). Jest idempotentny: pomija zgłoszenia, których numer `B-NNN` jest już
   w tytule któregoś zgłoszenia (otwartego lub zamkniętego), oraz wpisy ze statusem „zrobione”; przed zapisem sprawdza etykiety. Najpierw
   `scripts/create-issues.sh --dry-run` (tylko drukuje polecenia), potem bez flagi; `--repo WLASCICIEL/REPO` wskazuje repozytorium.
1. Zakładasz zgłoszenie ręcznie (tytuł = nagłówek wpisu, treść = Opis + Kryteria akceptacji, etykiety jak niżej), a do wpisu tutaj dopisujesz numer
   zgłoszenia w polu `Zgłoszenie:`. Od tej chwili źródłem prawdy jest zgłoszenie; wpis tutaj zostaje jako indeks.
2. Wpis zrobiony przez PR oznaczasz `Status: zrobione (PR #N)` (nie usuwasz - historia).
3. Nowe uwagi odłożone z review dopisujesz tu w tym samym PR (CLAUDE.md, „Praca zespołowa”).
4. Etykiety do założenia w repo: priorytet `P1` (przed publicznym startem), `P2` (wkrótce), `P3` (kiedyś); typ `bug`, `security`, `tech-debt`,
   `feature`, `docs`, `ops`, `decision-needed`; moduł `mod:auth`, `mod:rejestracja`, `mod:kursy`, `mod:dashboard`, `mod:phishing`,
   `mod:zgloszenia`, `mod:import`, `mod:gamifikacja`, `mod:web`, `mod:ci`, `mod:db`; oraz `good first issue` dla małych, dobrze opisanych zadań.
5. Wpisy `decision-needed` nie wolno implementować bez decyzji właściciela produktu (CLAUDE.md); najpierw wpis w `docs/decisions.md`.

Pochodzenie: README (sekcje „Backlog …”), `docs/phishing-simulations.md`, `docs/user-import.md`, `docs/deploy-test.md`, przeglądy
bezpieczeństwa i kodu tej serii prac. Wpisy oznaczone **(zweryfikuj)** pochodzą ze starszych notatek README i mogły się zdezaktualizować.

---

## A. Przed publicznym startem (P1)

### B-001 Finalne dokumenty prawne: regulamin, polityka prywatności, bezpieczeństwo
- Etykiety: `P1`, `feature`, `docs`, `mod:web` · Źródło: README „Strony prawne”, CLAUDE.md „Warunek publicznego startu”, `docs/legal/privacy-policy-checklist.md`
- Opis: `/regulamin`, `/polityka-prywatnosci`, `/bezpieczenstwo` mają placeholdery i `noindex`, zgody zapisują wersję `draft-1`.
- Akceptacja: dokumenty bez placeholderów i bez `noindex`, poprawna `LEGAL_DOCUMENT_VERSION`, linki w stopce, checklista prywatności zamknięta (w tym role stron).

### B-002 Własna, zweryfikowana domena nadawcy w MailerSend
- Etykiety: `P1`, `ops`, `mod:ci` · Źródło: CLAUDE.md „E-mail”, README „Moduł e-mail”
- Opis: dziś domena trial (wysyłka tylko do ograniczonej puli adresów). Kampanie phishingowe mają iść z OSOBNEJ domeny niż maile transakcyjne.
- Akceptacja: dwie zweryfikowane domeny (transakcyjna, symulacje) z SPF/DKIM/DMARC; `GET /phishing/config` pokazuje `configured: true`, poprawny `senderDomain`.

### B-003 Limit na brzegu (WAF/rate limiting) dla `/t/*` i `/api/t/*`
- Etykiety: `P1`, `ops`, `security`, `mod:phishing` · Źródło: `docs/deploy-test.md` „Limit na brzegu - WARUNEK STARTU”
- Opis: limit w API jest w pamięci procesu i nie zastępuje limitu brzegowego.
- Akceptacja: reguła Cloudflare (np. 120 żądań/min na adres, blokada 10 min), `TRUST_PROXY=true`, API bez wystawionych portów, ograniczony dostęp do logów.

### B-004 Ochrona przed masowym zakładaniem organizacji
- Etykiety: `P1`, `security`, `mod:rejestracja` · Źródło: README „Backlog rejestracji firmy”
- Opis: throttle 10/min/IP i limit 50 zadań w tle; brak CAPTCHA (Turnstile/hCaptcha), limitu globalnego i limitu niezweryfikowanych organizacji na domenę.
- Akceptacja: CAPTCHA na `/register`, limit niezweryfikowanych organizacji na domenę, test przeciążenia (503 zamiast pamięci).

### B-005 Helmet i CORS w API
- **Status: zrobione** (Helmet z konfiguracją domyślną, bez CSP: `common/security-headers.ts`, test `security-headers.spec.ts`). Kryterium „CORS zawężony do
  `FRONTEND_URL`” ZMIENIONO na „CORS niewłączony” (najściślejsza konfiguracja: API woła server-side BFF, uwierzytelnianie nagłówkiem, nie cookie); patrz `docs/decisions.md` D-047
- Etykiety: `P1`, `security`, `mod:auth` · Źródło: README „Backlog bezpieczeństwa modułu auth”
- Opis: w `apps/api/src/main.ts` nie było Helmet.
- Akceptacja: nagłówki bezpieczeństwa i test nagłówków (także na odpowiedziach błędów parsera).

### B-006 Ponowna akceptacja dokumentów prawnych po zmianie wersji
- Etykiety: `P1`, `feature`, `decision-needed`, `mod:auth` · Źródło: README „Ponowna akceptacja dokumentów”
- Opis: gdy `LEGAL_DOCUMENT_VERSION` jest nowsza niż zaakceptowana, po logowaniu potrzebny ekran akceptacji i blokada reszty aplikacji.
- Akceptacja: decyzja, kto akceptuje w imieniu organizacji; sprawdzenie wersji w API (guard/pole logowania), endpoint zapisu zgody, ekran w web, testy.

### B-007 Throttler żądań w Redisie (limity per instancja)
- Etykiety: `P1`, `tech-debt`, `mod:auth` · Źródło: README „Backlog rejestracji firmy”
- Opis: `@nestjs/throttler` liczy w pamięci procesu, więc przy więcej niż jednej instancji API limity są per instancja.
- Akceptacja: storage w Redisie z awaryjnym fallbackiem, test dwóch instancji (lub testu współdzielenia), dokumentacja w README.

### B-008 Monitoring pamięci Redisa i alert przy 80%
- Etykiety: `P1`, `ops` · Źródło: README „Backlog operacyjny (Redis)”
- Opis: prod Redis ma `maxmemory 128mb` i `noeviction`; zapełnienie oznacza błędy zapisu (limiter maili fail-open, brak `sessions-revoked:*`, joby bez stanu).
- Akceptacja: zbieranie `used_memory / maxmemory`, alert przy 80%, decyzja o limicie; Redis chroniony hasłem i siecią wewnętrzną.

### B-009 Alert na błędy pracy w tle rejestracji
- Etykiety: `P1`, `ops`, `mod:rejestracja` · Źródło: README „Praca w tle = błędy tylko w logu”
- Opis: awaria zapisu/maila w tle nie dociera do klienta (celowo), widać ją tylko w logu.
- Akceptacja: alert na log „zadanie w tle (rejestracja) nie powiodło się”; runbook.

### B-010 Gałąź `main` chroniona i wymagane joby CI
- Etykiety: `P1`, `ops`, `mod:ci` · Źródło: CLAUDE.md „Praca zespołowa”
- Opis: ustawienia GitHub: wymagany PR, zielone `lint + testy` i `testy e2e (api)`, 1 zatwierdzenie, brak force-push. Wymaga planu Team (dziś Free);
  do czasu upgrade'u działa lokalny hook `.githooks/pre-push` (blokada pushu na `main`, `docs/decisions.md` D-048), którego NIE da się wymusić na
  klonie (każdy włącza go sam), więc to tylko dyscyplina, nie ochrona.
- Sprawdzenia CI biegną już na każdym PR (D-049); po upgrade'ie ustaw je jako WYMAGANE pod stałymi nazwami `lint + testy` i `testy e2e (api)`.
- Akceptacja: upgrade planu, reguły ochrony włączone (w tym wymagane sprawdzenia) i opisane w README; hook zostaje jako pierwsza linia obrony.

## B. Rejestracja, auth, dane

### B-011 Unieważnianie linku aktywacyjnego przez osoby trzecie
- Etykiety: `P2`, `security`, `mod:rejestracja` · Źródło: README „Backlog rejestracji firmy”
- Opis: nowy link kasuje poprzedni nieużyty token, więc obcy może powtarzalnie unieważniać ważny link ofiary (limit 1 mail/skrzynka/10 min + 10/min/IP).
- Akceptacja: nie kasujemy tokenu, który ma jeszcze >1 h ważności (albo równoważne rozwiązanie), test.

### B-012 Kraje poza PL i numer VAT
- Etykiety: `P3`, `feature`, `decision-needed`, `mod:rejestracja` · Źródło: README, CLAUDE.md „Planowane”
- Opis: dziś CHECK `country = 'PL'`, NIP z sumą kontrolną. Inne kraje: zdjęcie CHECK-a, walidacja VAT-ID (VIES), formaty kodu pocztowego, zmiany formularza.
- Akceptacja: decyzja o krajach; migracja, walidacja, formularz, testy.

### B-013 Pełny flow samodzielnego dołączania pracowników (`selfJoinEnabled`)
- Etykiety: `P3`, `feature`, `decision-needed`, `mod:rejestracja` · Źródło: README, CLAUDE.md
- Opis: istnieje tylko przełącznik, którego nic nie czyta. Brakuje ekranu „dołącz”, potwierdzenia skrzynki, roli domyślnej, limitu licencji, akceptacji admina.
- Akceptacja: decyzja produktowa; potem implementacja z testami A/B.

### B-014 Potwierdzenie decyzji: globalna unikalność `users.email` (D-009)
- Etykiety: `P2`, `decision-needed`, `mod:auth` · Źródło: README, `docs/decisions.md` D-009
- Opis: ta sama osoba nie może mieć kont w dwóch organizacjach-klientach pod jednym adresem.
- Akceptacja: decyzja właściciela produktu wpisana do `docs/decisions.md` (Przyjęta albo Zastąpiona).

### B-015 Polityka haseł: sprawdzanie znanych wycieków
- Etykiety: `P3`, `security`, `mod:auth` · Źródło: README „Backlog bezpieczeństwa modułu auth”
- Opis: dziś tylko `@MinLength(8)`; produkt uczy klientów higieny haseł.
- Akceptacja: sprawdzenie w HaveIBeenPwned (range API, k-anonimowość) z fallbackiem przy awarii usługi.

### B-016 `POSTGRES_PASSWORD` zahardkodowane w `docker-compose.yml` i port 5432 na `0.0.0.0`
- Etykiety: `P2`, `security`, `ops` · Źródło: README „Backlog bezpieczeństwa modułu auth”
- Opis: hasło superusera (BYPASSRLS) w pliku; przy wzorcowaniu produkcji na tym pliku unieważnia rozdział ról.
- Akceptacja: hasło ze zmiennej env (jak `APP_DB_PASSWORD`), port tylko na `127.0.0.1`.

### B-017 SSO Microsoft (Entra ID)
- Etykiety: `P3`, `feature`, `decision-needed`, `mod:auth` · Źródło: CLAUDE.md „Planowane”
- Opis: uzupełnienie potwierdzania domeny i logowania. Nie budować bez decyzji.
- Akceptacja: decyzja i projekt; implementacja w osobnych zgłoszeniach.

### B-018 Fakturowanie w Stripe z `organization_billing_details`
- Etykiety: `P3`, `feature`, `decision-needed` · Źródło: CLAUDE.md „Planowane”
- Opis: na MVP wystarczy webhook + ręczna zmiana planu przez super-admina.
- Akceptacja: decyzja o zakresie; projekt; implementacja.

### B-019 Aktualizacja README: sekcje nieaktualne wobec kodu **(zweryfikuj)**
- **Status: zrobione** (README opisuje stan faktyczny: rejestracja, nazwa organizacji, normalizacja e-maila, eksport CSV, dev-fallback e-maila, wygasanie kont, lista zadań w tle, szablony maili)
- Etykiety: `P2`, `docs` · Źródło: porównanie README z CLAUDE.md i kodem
- Opis: m.in. „Nazwa organizacji = domena e-maila, unikalna” (CLAUDE.md: nazwa podawana przez klienta i nieunikalna), „Brak normalizacji e-maila”
  (DTO używają `@NormalizeEmail`), „Brak ochrony przed CSV/formula injection w `/dashboard/export`” (jest w `escapeCsvField`), „Niepotwierdzona
  organizacja zajmuje domenę” (jest sprzątanie po 14 dniach), backlog rejestracji „pre-hijacking”.
- Akceptacja: każda wymieniona sekcja poprawiona albo usunięta, z odnośnikiem do wpisu w `docs/decisions.md`.

## C. Baza danych i CI

### B-020 Złożone FK `(organizationId, userId)` na tabelach z kolumną `userId`
- Etykiety: `P2`, `security`, `tech-debt`, `mod:db` · Źródło: README „Backlog bazy danych”
- Opis: `course_assignments`, `user_badges`, `password_reset_tokens`, `email_verification_tokens` mają FK tylko na `users(id)` (FK omijają RLS), więc baza
  nie pilnuje zgodności organizacji.
- Akceptacja: jedna migracja ze złożonymi FK `ON UPDATE NO ACTION` (indeks unikalny na `users` już jest), testy naruszeń w e2e.

### B-021 Sprawdzenie backfillu `notifiedAt` przy pierwszym wdrożeniu
- Etykiety: `P2`, `ops`, `mod:zgloszenia` · Źródło: `docs/phishing-simulations.md` „Znane ograniczenia”, `docs/decisions.md` D-046
- Opis: dane migracji nie są osiągalne w e2e.
- Akceptacja: przed pierwszym wdrożeniem na bazie z istniejącymi zgłoszeniami `SELECT count(*) FROM threat_reports WHERE kind='REAL' AND "notifiedAt" IS NULL` = 0.

### B-022 Sporadyczne „Jest did not exit one second after the test run has completed”
- Etykiety: `P3`, `tech-debt`, `mod:ci` · Źródło: `docs/phishing-simulations.md`, `docs/decisions.md` D-045
- Opis: ok. 3 z 8 pełnych przebiegów repliki CI, przy zielonych testach, zwykle w pierwszym przebiegu po świeżym starcie kontenerów.
  `--detectOpenHandles` niczego nie wykazał; podejrzenie: klient Redis/BullMQ z ponawianiem połączenia przy zimnym starcie.
- Akceptacja: przyczyna ustalona i usunięta albo udokumentowana; wracamy, jeśli CI zacznie padać.

### B-023 Testy e2e przeglądarkowe (Playwright) w CI
- Etykiety: `P3`, `tech-debt`, `mod:ci` · Źródło: README „Backlog CI/CD”, `docs/e2e-registration.md`
- Opis: `scripts/e2e-registration.mjs` uruchamiany ręcznie przed wdrożeniem.
- Akceptacja: job CI z przeglądarkami i zbudowanymi aplikacjami dla krytycznej ścieżki rejestracji.

### B-024 Retencja obrazów w GHCR
- Etykiety: `P3`, `ops`, `mod:ci` · Źródło: README „Backlog CI/CD”
- Opis: zostaje `:latest` i 3 najnowsze `sha-*`, więc wycofanie działa do 3 buildów wstecz; limit planu Free może być ciasny.
- Akceptacja: sprawdzenie zużycia w Settings → Packages, ewentualna zmiana `KEEP_SHA_TAGS`.

## D. E-learning, dashboard, gamifikacja

### B-030 Job oznaczający przypisania jako `OVERDUE`
- Etykiety: `P2`, `feature`, `mod:dashboard`, `mod:kursy` · Źródło: README „Backlog modułu dashboard/raporty”
- Opis: nic nie ustawia statusu `OVERDUE`, więc `overdueCount` jest praktycznie zawsze 0 (termin w przeszłości jest wykrywany po `dueDate`).
- Akceptacja: cykliczny job wg wzorca z CLAUDE.md „Zadania w tle” (idempotentny, `runInOrgContext`, test z zamrożonym zegarem, izolacja A/B).

### B-031 Endpointy administracyjne do kursów i przypisań
- Etykiety: `P2`, `feature`, `decision-needed`, `mod:kursy` · Źródło: README „Backlog modułu kursów e-learningowych”
- Opis: brak tworzenia `Course` i przypisywania `CourseAssignment` (testy seedują przez Prisma). Potrzebny panel ORG_ADMIN/SUPER_ADMIN.
- Akceptacja: decyzja o zakresie i rolach; endpointy z testami A/B; walidacja `contentBlocks` (nieznany `block.type` nie jest cicho pomijany).

### B-032 `ON DELETE CASCADE` z `courses` do `course_assignments`: RESTRICT + archiwizacja
- **Status: RESTRICT zrobione** (silnik scen, migracja `course_versions`, D-051: `course_assignments` → `courses` i → `course_versions`). Archiwizacja kursów
  (zamiast usuwania) zostaje otwarta.
- Etykiety: `P3`, `tech-debt`, `mod:kursy`, `mod:db` · Źródło: README
- Opis: usunięcie kursu bezpowrotnie kasuje wyniki wszystkich organizacji (ważne dla audytów zgodności).
- Akceptacja: `RESTRICT` i archiwizacja kursów przed powstaniem endpointu usuwającego.

### B-033 Trend ukończenia szkoleń z tabeli historii
- Etykiety: `P3`, `tech-debt`, `mod:dashboard` · Źródło: README „Executive Dashboard”
- Opis: trend liczony wstecz z `createdAt`/`completedAt`; twarde usunięcie pracownika usuwa jego wkład z historii.
- Akceptacja: migawki (np. `compliance_snapshots` zasilane jobem) z RLS i testami.

### B-034 Agregacja `users-status` w SQL
- Etykiety: `P3`, `tech-debt`, `mod:dashboard` · Źródło: README
- Opis: sortowanie i paginacja w pamięci (OK dla setek-tysięcy użytkowników).
- Akceptacja: przeniesienie do SQL przy przekroczeniu skali, benchmark przed/po.

### B-035 Wyjaśnienie odpowiedzi w feedbacku kursu
- **Status: częściowo** (silnik scen, D-051): nowe typy zwracają wyjaśnienia po ukończeniu bloku (`lastResult.detail`, rozwiązanie zadania tekstowego po
  wyczerpaniu prób). Dla QUIZ/BRANCHING_SCENARIO `feedback` opcji NIE wychodzi (projekcja klienta go wycina) i nadal nie ma go w odpowiedzi po zapisie.
- Etykiety: `P3`, `feature`, `mod:kursy` · Źródło: README „Backlog modułu kursów”
- Opis: `FeedbackPanel` pokazuje tylko „Poprawna/Niepoprawna”; wyjaśnienie wymaga nowego pola DTO bez ujawniania klucza odpowiedzi przed odpowiedzią.
- Akceptacja: pole wyjaśnienia w `submitBlockProgress`, test braku wycieku klucza, UI.

### B-036 Prawdziwe drag&drop z oceną i realny tracking wideo
- Etykiety: `P3`, `feature`, `mod:kursy` · Źródło: README
- Opis: `DragAndDropBlock` to uproszczenie (backend go nie ocenia), a obejrzenie wideo jest tylko kosmetyczne.
- Akceptacja: rozszerzenie `evaluateBlock` i frontendu razem; decyzja, czy wideo ma być weryfikowane.

### B-037 Gamifikacja: edycja imienia i nazwiska, `startedAt`, kolejne zdarzenia XP
- Etykiety: `P3`, `feature`, `mod:gamifikacja` · Źródło: README „Moduł grywalizacji”
- Opis: brak endpointu ustawiającego `firstName`/`lastName` (leaderboard używa inicjałów z e-maila); brak `startedAt` na `CourseAssignment` (odznaka
  `SPEED_DEMON`); odznaki tylko przy ukończeniu kursu; `AVATAR_PRESETS` bez metadanych.
- Akceptacja: osobne zgłoszenia na każdy punkt po decyzji o kolejności.

## E. Frontend

### B-040 Odświeżanie sesji na stronie głównej `/`
- Etykiety: `P3`, `tech-debt`, `mod:web` · Źródło: README „Backlog frontendu”
- Opis: ORG_ADMIN z ważnym refresh tokenem po wygaśnięciu access tokena trafia z `/` na `/courses` zamiast `/dashboard`.
- Akceptacja: `/` w matcherze middleware z odświeżaniem tokenu przed decyzją o przekierowaniu.

### B-041 Test spinający `PROTECTED_ROUTES` z `homePathForRole`
- Etykiety: `P3`, `tech-debt`, `mod:web` · Źródło: README
- Opis: zmiana ról w middleware bez zmiany `home-path.ts` kończy się wylogowaniem tuż po zalogowaniu.
- Akceptacja: eksport `PROTECTED_ROUTES` i test, że dla każdej roli strona startowa mieści się w dopuszczonych trasach.

### B-088 Ostrzeżenie w UI, gdy wylogowanie nie unieważniło sesji w API (`sessionRevoked: false`)
- Etykiety: `P2`, `security`, `mod:web` · Źródło: przegląd bezpieczeństwa PR „menu użytkownika w Topbarze”
- Opis: trasa BFF `apps/web/src/app/api/auth/logout/route.ts` zwraca `{ success: true, sessionRevoked: false }`, gdy `apps/api` nie
  potwierdziło unieważnienia (5xx, 429, timeout, awaria sieci). Cookies są wtedy i tak czyszczone, ale refresh token w bazie pozostaje
  ważny aż do naturalnego wygaśnięcia (do 7 dni). Wspólny hook `apps/web/src/lib/use-logout.ts` (UserMenu w Topbarze, PendingHeader) nie
  czyta odpowiedzi, więc użytkownik dostaje ciche „wylogowano” - istotne na komputerze współdzielonym. Stan sprzed tej zmiany (ten sam
  brak był w PendingHeader), ale menu w Topbarze jest teraz głównym punktem wylogowania w aplikacji.
- Akceptacja: `useLogout` czyta `sessionRevoked` z odpowiedzi; przy `false` użytkownik widzi ostrzeżenie (np. na `/login`) z odnośnikiem
  do „Wyloguj wszędzie” (`/api/auth/logout-all`, ekran ustawień); test dla obu wariantów odpowiedzi.

### B-042 Współdzielone DTO w `packages/shared`
- Etykiety: `P3`, `tech-debt`, `mod:web` · Źródło: README
- Opis: frontend ręcznie duplikuje typy DTO z API (dashboard, kursy, import, phishing) - ryzyko rozjazdu przy zmianie backendu.
- Akceptacja: przeniesienie współdzielonych DTO, kompilacja obu workspace'ów, brak duplikatów.

### B-096 Dymek podpowiedzi (`Hint.tsx`, dawniej `MascotOverlay.tsx`) może nie ogłosić PIERWSZEGO komunikatu na bloku
- Etykiety: `P2`, `bug`, `mod:web` · Źródło: dwa niezależne review (code-reviewer + a11y) fix-passu `feat/player-stage` po PR #44
- Aktualizacja (D-093): problem przeszedł 1:1 na `player/Hint.tsx` - `Hint` zwraca `null` bez tekstu, a `PlayerStage.tsx` przekazuje
  `hint` tylko wtedy, gdy jest; poniższy opis (nazwy sprzed D-093) dotyczy dziś `Hint`/`hint` zamiast `MascotOverlay`/`mascot`.
- Opis: `<p role="status" aria-live="polite">` montuje się RAZEM z treścią (`{mascot && <MascotOverlay .../>}` w
  `PlayerStage.tsx`, `{text && <p role="status">...}` w środku) - czytniki ekranu z reguły NIE ogłaszają żywego
  regionu, który pojawił się w DOM już wypełniony, tylko kolejne ZMIANY treści już zamontowanego regionu. Blok bez
  `idleMascot` (np. QUIZ, `showingFeedback`) nie renderuje `MascotOverlay` wcale, więc PIERWSZA reakcja maskotki na
  takim bloku montuje komponent od zera z tekstem już w środku - i może przepaść dla czytnika ekranu.
- Akceptacja: `role="status"` (pusty, bez tekstu) montuje się i zostaje w DOM niezależnie od tego, czy jest aktualnie
  `pose`/`text` (albo świadomie inny mechanizm dający ten sam efekt); tekst wstawiany PO montażu regionu, nie razem z
  nim; test odtwarzający przejście "brak maskotki -> pierwsza reakcja z tekstem" (nie tylko "maskotka od razu z
  tekstem", jak dziś w `MascotOverlay.test.tsx`).

### B-097 Zamknięcie transkrypcji/notatnika przy zmianie bloku może ukraść fokus nowo ustawionemu nagłówkowi
- Etykiety: `P2`, `bug`, `mod:web` · Źródło: j.w.
- Opis: `TranscriptPanel.tsx`/`NotesDrawer.tsx` oddają fokus na swój `triggerRef` przy KAŻDYM przejściu otwarty ->
  zamknięty, także gdy zamknięcie nie jest efektem bezpośredniej akcji użytkownika (np. `useNarrationBar.ts` zamyka
  transkrypcję przy zmianie `resetKey` - nowy blok). `CoursePlayer.tsx` w tym samym cyklu renderu przenosi fokus na
  nagłówek nowego bloku (`headingRef`) - jeśli transkrypcja była otwarta, efekt zwracający fokus na "Transkrypcja"
  odpala się PO tym i przestawia fokus z powrotem na dolny pasek, więc czytnik ekranu nie ogłasza nowego bloku.
- Akceptacja: fokus wraca na trigger WYŁĄCZNIE, gdy zamknięcie jest efektem interakcji użytkownika z samym panelem
  (np. fokus w chwili zamknięcia leżał wewnątrz panelu) - nie przy zamknięciu "z zewnątrz" (zmiana bloku); test na
  oba przypadki.

### B-098 `Hint.tsx` (dawniej `MascotOverlay`): po "Zwiń" fokus zostaje na niewidocznym przycisku, bez wskaźnika fokusu
- Etykiety: `P3`, `decision-needed`, `mod:web` · Źródło: a11y review fix-passu `feat/player-stage` po PR #44
- Aktualizacja (D-093): dotyczy dziś przycisku „Zwiń podpowiedź” w `player/Hint.tsx` (oba warianty); „ikona maskotki” niżej = ikona
  żarówki „Pokaż podpowiedź”.
- Opis: świadoma decyzja tej rundy poprawek - zwinięcie dymka NIE przenosi fokusu (nie jest to modal, brak
  semantyki "powrotu"). Skutek uboczny: klawiaturowy użytkownik, który aktywował "Zwiń" (albo miał tam fokus, gdy
  odpalił się 8-sekundowy auto-collapse), zostaje z fokusem na przycisku, który zaraz potem znika wizualnie
  (`opacity-0`, `max-h-0`) - WCAG 2.4.7/2.4.11 (widoczny fokus). Przeniesienie fokusu na (widoczną) ikonę maskotki
  rozwiązałoby to bez łamania decyzji "nie przenoś fokusu przy zwinięciu" w duchu (ikona to SIBLING, nie "powrót" do
  triggera modala) - wymaga jednak decyzji właściciela produktu, bo to zmiana zachowania ustalonego w tej rundzie.
- Akceptacja: decyzja w `docs/decisions.md`, potem implementacja i test.

### B-099 Drobne porządki w odtwarzaczu kursu (`feat/player-stage`) - bez wpływu na zachowanie
- Etykiety: `P3`, `tech-debt`, `mod:web` · Źródło: code review fix-passu `feat/player-stage` po PR #44
- Opis: kilka drobiazgów znalezionych przy okazji, żaden nie zmienia obserwowalnego zachowania: (1) `MascotOverlay.tsx`
  dymek w stanie zwiniętym ma jednocześnie bazowe `pointer-events-auto` i warunkowe `pointer-events-none` - w
  Tailwind v3 klasa zdefiniowana później w arkuszu wygrywa niezależnie od kolejności w `className`, więc efekt jest
  dziś poprawny, ale zapis wprowadza w błąd przy czytaniu. (2) `MascotOverlay.tsx`: `aria-label="Fooli - pokaż
  wiadomość"` na ikonie zostaje taki sam też przy ROZWINIĘTYM dymku, gdzie klik w ikonę nic nie robi. (3)
  `PlayerStage.tsx`: klasa `w-full` na `<main>` jest martwa (`.player-frame` w `globals.css` i tak narzuca szerokość);
  `titleId` jest sztywnym stringiem zamiast `useId()`. (4) `NotesDrawer.tsx`: selektor pułapki fokusu
  (`a[href], button:not([disabled])`) pominie `input`/`textarea`/`select`/`[tabindex]`, gdyby `NotesPanel` kiedyś
  dostał taką zawartość.
- Akceptacja: każdy punkt osobnym, małym PR-em albo przy najbliższej zmianie dotykającej dany plik.
- Aktualizacja (D-093): `MascotOverlay.tsx` zastąpił `player/Hint.tsx`. (1) dotyczy dziś dymku w `Hint.tsx` (ten sam zapis klas);
  (2) zrobione - przy rozwiniętym dymku ikona „Pokaż podpowiedź” jest `sr-only` i poza kolejnością Tab (`tabIndex=-1`).

### B-100 Łańcuch wysokości sceny (SCENE_HOTSPOTS, 16:9) - weryfikacja w prawdziwej przeglądarce
- Etykiety: `P2`, `tech-debt`, `mod:web` · Źródło: code review fix-passu `feat/player-stage` po PR #44; zależne od `B-085`
- Status: zrobione (PR #49, `scripts/layout-check.mjs`) - `layout-check.mjs` sprawdza w prawdziwej
  przeglądarce (Playwright, nie jsdom) na wszystkich 4 viewportach (w tym 844x390, telefon w poziomie), że obraz
  sceny głównej mieści się w obszarze bloku bez przewijania (sprawdzenie „e” tego skryptu) - NIEZALEŻNIE od B-085,
  bo strona `apps/web/src/app/dev/player-harness/page.tsx` nie potrzebuje backendu (treść wprost z packages/content).
  Uruchamiane dziś ręcznie przed pushem (CLAUDE.md, reguła 12), nie automatycznie w CI - patrz B-101.
- Opis: `SceneHotspotsBlock.tsx` dostał w PR-ie `feat/player-stage` pełny łańcuch `min-h-0`/`flex-1`, pokryty testem
  na KLASACH (`Investigation.test.tsx`), ale pudełko aspect-ratio jest elementem flex w wierszu (szerokość `auto`,
  zależna od intrinsic size obrazu) - test jednostkowy w jsdom nie może potwierdzić, że scena faktycznie mieści się
  w pionie na niskim/wąskim viewporcie (telefon w poziomie, tryb pełnoekranowy). Wymagało realnej przeglądarki;
  `scripts/e2e-module-01.mjs` było wtedy zablokowane przez B-085 - `layout-check.mjs` (`fix/hotspot-card-fit`)
  obchodzi to ograniczenie, bo w ogóle nie potrzebuje backendu.
- Akceptacja: ✅ przebieg `layout-check.mjs` na niskim viewporcie (844x390, telefon w poziomie) potwierdza, że scena
  mieści się w pionie, nie tylko szerokością (sprawdzenie „e”) - zamiast e2e/ręcznego sprawdzenia z pierwotnej
  akceptacji, które nadal blokuje B-085.

### B-101 `layout-check.mjs` i `check-no-secrets-in-bundle.mjs` w CI
- Etykiety: `P2`, `tech-debt`, `security`, `mod:web`, `mod:ci` · Źródło: code review `fix/hotspot-card-fit` (druga
  runda) - bugi w container query/grid karty hotspotu, których żaden test jsdom nie mógł wykryć (jsdom nie liczy
  layoutu CSS); `scripts/check-no-secrets-in-bundle.mjs` dopisany przy przeglądzie bezpieczeństwa tego samego PR-a
  (dev/player-harness czyta treść modułu wprost z `packages/content` - test na stałe pilnuje, że sekrety treści
  (klucz odpowiedzi, `reactions.result`, podpowiedzi) nie trafiają do klienckiego bundla `apps/web/.next/static/`,
  niezależnie od tego, co ktoś zmieni w `page.tsx` w przyszłości).
- Opis: `scripts/layout-check.mjs` (Playwright, `apps/web/src/app/dev/player-harness/page.dev.tsx` za
  `NEXT_PUBLIC_DEV_HARNESS=1`, bez backendu) i `scripts/check-no-secrets-in-bundle.mjs` (wymaga
  `npm run build --workspace=apps/web`, bez i z `NEXT_PUBLIC_DEV_HARNESS=1` - patrz opis PR) uruchamiane dziś
  WYŁĄCZNIE ręcznie przed pushem PR-ów zmieniających układ odtwarzacza (CLAUDE.md, reguła 12) - nic nie pilnuje, że
  ktoś o tym nie zapomni. Docelowo osobne joby w `.github/workflows/build-images.yml` (albo kroki w `lint + testy`) -
  `layout-check.mjs` uruchamiany zawsze (tani - nie potrzebuje Postgresa/Redisa) albo warunkowo (pliki
  PlayerStage/SceneHotspotsBlock/karty/bottom sheet w diffie PR-a); `check-no-secrets-in-bundle.mjs` po
  `npm run build --workspace=apps/web` (oba warianty flagi) - zawsze, bo to bramka bezpieczeństwa, nie tylko UX.
- Akceptacja: oba skrypty w CI, czerwony blokuje merge tak samo jak `lint + testy`; CLAUDE.md reguła 12
  zaktualizowana (uruchomienie ręczne przestaje być jedyną linią obrony).

### B-102 Dymek maskotki (MascotOverlay.tsx) za wąski na telefonie w pionie
- Etykiety: `P3`, `bug`, `mod:web` · Źródło: `feat/player-portrait` - zauważone przy okazji (zrzuty
  `scripts/layout-check.mjs` dla 390x844/360x800), PRE-EXISTING (niezależne od tego PR-a - nikt wcześniej nie
  testował `MascotOverlay.tsx` na tak wąskim viewporcie, `max-w-[30%]` istniało już wcześniej).
- Opis: wrapper avatara+dymka ma `max-w-[30%]` (`MascotOverlay.tsx`) - na telefonie w pionie (scena ~390px
  szerokości) to ~117px na avatar (76px) + dymek razem, więc tekst dymka wychodzi skrajnie wąski i ucięty (jedno-
  dwuznakowa kolumna). `min-w-0`/`max-w-[280px]` na samym dymku nie pomaga, bo rodzic i tak ogranicza dostępną
  przestrzeń wcześniej.
- Akceptacja: dymek czytelny (rozsądna szerokość, bez wielowierszowego przycinania pojedynczych słów) na telefonie
  w pionie; test regresyjny albo dopisanie do `scripts/layout-check.mjs`.
- Aktualizacja (D-093): nakładka to dziś `player/Hint.tsx` (wariant `overlay`, dalej `max-w-[30%]`); zamiast avatara 76 px jest ikona
  36 px, a przy rozwiniętym dymku ikona jest `sr-only` - dymek ma więc prawie całe ~117 px, nadal wąsko. Otwarte.

### B-103 Dymek maskotki może wizualnie zachodzić na pierwszy chip stopki DIALOGUE
- Etykiety: `P3`, `bug`, `mod:web` · Źródło: `fix/dialogue-sticky-questions` - zauważone przy okazji (zrzuty
  `scripts/layout-check.mjs`, `1366x768-dialogue-00-start.png`), PRE-EXISTING geometria `MascotOverlay.tsx`
  (`bottom-3 left-3`, dymek rozwija się do ~280px w prawo od ikonki) w połączeniu z NOWĄ, zawsze widoczną stopką
  DIALOGUE (chipy pytań, `.pl-24 sm:pl-28` w `DialogueBlock.tsx` rezerwuje miejsce WYŁĄCZNIE na samą ikonkę, nie na
  rozwinięty dymek). Numer B-103 nadany przy rebase na `main` po zmergowaniu PR #51, który równolegle zajął B-102
  (`feat/player-portrait`) innym, niezależnym zgłoszeniem o tym samym komponencie.
- Opis: na starcie rozmowy (dymek jeszcze rozwinięty, przed 8 s auto-zwinięciem/pierwszym kliknięciem) pierwszy chip
  listy pytań bywa częściowo przykryty dymkiem maskotki - wizualnie nieczytelny/trudny do trafienia w tym miejscu
  (użytkownik klikający w przykrytą część widzi/dotyka dymek, nie chip - drugi klik trafia już poprawnie, bo pierwszy
  zwija dymek). Zautomatyzowany `scripts/layout-check.mjs` tego NIE łapie (Playwright klika w ŚRODEK bounding boksa
  chipa, który zwykle wychodzi poza obszar zachodzenia) - to czysto wizualny/UX problem, nie twardy blocker kliknięcia.
  Pełne rozwiązanie wymaga albo zarezerwowania ~400px (ikonka+pełna szerokość dymka - marnotrawne, gdy dymek
  zwinięty) albo zmiany w `MascotOverlay.tsx` (współdzielony przez wszystkie typy bloków - poza zakresem tego PR-a).
- Akceptacja: pierwszy chip nigdy nie jest wizualnie przykryty dymkiem maskotki, niezależnie od długości jego tekstu;
  test regresyjny (layout-check.mjs albo jsdom - bounding boxy się nie nakładają).
- **Rozwiązane (D-080, gałąź `fix/dialogue-polish`):** Fooli w DIALOGUE (`contentLayout='fill'`) nie jest już floating
  nakładką (`MascotOverlay.tsx`) - `DialogueBlock.tsx` renderuje `MascotBanner.tsx`, pasek w normalnym przepływie NAD
  nagłówkiem rozmowy, poza obszarem przewijania. Nic nie może już zachodzić na chipy, bo dymek nie jest już
  `position:absolute` - usunięty jest sam mechanizm, który powodował ten problem, nie tylko jego symptom. `.pl-24
  sm:pl-28` (rezerwacja miejsca na ikonkę we wcześniejszej wersji stopki) stała się zbędna i została usunięta razem
  z tą zmianą. (D-093: `MascotBanner.tsx` zastąpił pasek `player/Hint.tsx`, wariant `bar` - dalej w przepływie.)

### B-104 DIALOGUE na bardzo niskich/poziomych viewportach - pełne pokrycie WCAG 1.4.10
- Etykiety: `P3`, `a11y`, `mod:web` · Źródło: code review `fix/dialogue-sticky-questions` - `DialogueBlock.tsx`'s
  prompt/nagłówek rozmowy/stopka (chipy + ExploreFooter) są `shrink-0` (nie oddają miejsca wątkowi), więc na bardzo
  niskich viewportach (telefon w poziomie o małej wysokości) albo przy dużym powiększeniu przeglądarki suma ich
  wysokości może przekroczyć dostępną wysokość obszaru bloku (`overflow-clip`, bez fallbackowego scrolla całego
  panelu - to świadoma cecha `contentLayout='fill'`, nie bug). Rozważana doraźna rezerwacja minimalnej wysokości
  wątku (`min-h-[…]`) świadomie ODRZUCONA (druga runda code review): obcinałaby stopkę (JEDYNE kontrolki rozmowy -
  chipy, "Następna kwestia") WCZEŚNIEJ niż zwykłe `min-h-0`, tracąc kontrolki zamiast tylko historii wątku - zostaje
  `min-h-0`, priorytet ma stopka, wątek jako pierwszy oddaje miejsce. **Zaktualizowane (`fix/dialogue-polish`,
  D-080):** przybył JESZCZE JEDEN `shrink-0` element nad nagłówkiem rozmowy - `MascotBanner` (`{!review &&
  <MascotBanner/>}`, `mb-3`), renderowany gdy blok ma mascota - suma `shrink-0` elementów rośnie, więc dolna granica
  wysokości viewportu, przy której wątek/stopka stają się nieosiągalne, jest teraz WYŻSZA (problem bardziej
  prawdopodobny, nie mniej) niż w chwili zgłoszenia tego wpisu (od D-093 ten pasek to `Hint` wariant `bar` - niższy, bez avatara).
  **Zaktualizowane (`feat/dialogue-chat`, D-087):** „Następna kwestia”
  usunięte; przy wysokości ≤ 500 px nagłówek rozmowy znika, a chipy są w jednym przewijanym rzędzie - na 844x390 wątek ma ~120 px
  (layout-check sprawdza ≥ 80 px); zostaje duże powiększenie przeglądarki. Nie zmienia to akceptacji niżej, tylko fakt, że
  zmierzona granica musi uwzględnić też ten pasek.
- Opis: żaden test (`layout-check.mjs`, `DIALOGUE_VIEWPORTS`) nie sprawdza dziś niskiego/poziomego viewportu ani
  symulacji powiększenia przeglądarki w trakcie rozmowy z wieloma pytaniami - nieznana jest faktyczna dolna granica,
  przy której wątek (a docelowo i stopka) staje się nieosiągalny. Pełne rozwiązanie wymaga decyzji projektowej (np.
  składany/mniejszy nagłówek rozmowy poniżej pewnej wysokości, albo dodatkowy fallback scroll całego bloku na bardzo
  małych viewportach) - poza zakresem tego PR-a.
- Akceptacja: zmierzona i udokumentowana najniższa obsługiwana wysokość viewportu (albo poziom powiększenia) dla
  DIALOGUE; test w `layout-check.mjs` pokrywający tę granicę; jeśli granica jest zbyt wysoka (WCAG 1.4.10 wymaga
  wsparcia do 256px wysokości przy standardowym zoomie), projekt UI stopki/nagłówka na niskich wysokościach.

### B-105 Dwa niezależne żądania `GET /api/users/me/avatar` na każde wejście na `/courses/[id]`
- Etykiety: `P4`, `tech-debt`, `mod:web` · Źródło: code review `fix/dialogue-polish` - `Topbar.tsx` i `CoursePlayer.tsx`
  wołają `useMyAvatar()` NIEZALEŻNIE od siebie (żaden nie renderuje się na trasie odtwarzacza równocześnie z drugim
  dziś - `/courses/[courseId]` nie ma Topbara - ale każde WEJŚCIE na tę trasę z innej strony, która ma Topbar, to
  jedno żądanie tam + jedno tutaj, osobno). Nie jest to błąd (oba poprawnie się fetch'ują, oba poprawnie łapią
  `AVATAR_CHANGED_EVENT`), tylko zbędny duplikat żądania.
- Opis: naprawa wymaga wspólnego kontekstu/cache (np. `AvatarProvider` wysoko w drzewie, `useMyAvatar` czytający z
  kontekstu zamiast fetchować samodzielnie) - większa zmiana niż jest to wart ten PR. Przy tej samej okazji: `useMyAvatar`
  dziedziczy z `Topbar.tsx` istniejący, drobny wyścig - `AVATAR_CHANGED_EVENT`, który przyjdzie PRZED odpowiedzią
  własnego `fetch()`, zostaje nadpisany starszą wartością z tej odpowiedzi, gdy ona wreszcie dojdzie (potrzebna flaga
  "zdarzenie wygrało" albo ignorowanie odpowiedzi fetcha, gdy zdarzenie już nadpisało stan).
- Akceptacja: jedno żądanie `GET /api/users/me/avatar` na wejście na stronę, niezależnie od liczby konsumentów hooka;
  `AVATAR_CHANGED_EVENT` zawsze wygrywa z później rozstrzygającą się odpowiedzią fetch-a sprzed zdarzenia.

### B-106 Testy `scripts/content` czytają lokalny `.env.local`
- Etykiety: `P4`, `tech-debt`, `mod:content` · Źródło: `fix/company-name` - lokalnie 2 faile w `src/tts.test.ts`
  („tryb z kluczami bez konfiguracji”, „--assets --check --remote --storage r2 bez konfiguracji”), bo autor treści ma
  skonfigurowany `scripts/content/.env.local` i CLI ładuje z niego klucze, zamiast zgłosić ich brak. W CI (bez pliku) zielone.
- Opis: testy CLI mają izolować środowisko - nie czytać `.env.local` (np. wstrzykiwana ścieżka pliku env / flaga
  wyłączająca ładowanie w `main()`), żeby wynik nie zależał od maszyny.
- Akceptacja: `npm run test --prefix scripts/content` zielone także z uzupełnionym `scripts/content/.env.local`.

### B-107 Trasy BFF przepuszczają do przeglądarki pełną treść błędu z apps/api
- Etykiety: `P3`, `security`, `mod:web` · Źródło: security-review PR #55 (`feat/module-briefing`, uwaga L2), decyzja właściciela 2026-09-26
- Opis: trasy `apps/web/src/app/api/**` przy odpowiedzi błędu z API zwracają klientowi całe ciało (`NextResponse.json(data, { status })`).
  Dziś to standardowe błędy Nest (`message`, `code`) bez danych osobowych, ale przyszły błąd backendu z dodatkowymi polami trafiłby
  do przeglądarki bez filtra. Wzorzec jest wspólny dla wszystkich tras BFF (np. `users/me/avatar`, `users/me/display-name`).
- Akceptacja: wspólna funkcja w `apps/web/src/lib` przepuszczająca przy błędzie wyłącznie `message`/`code` (i status), użyta we
  wszystkich trasach BFF; test, że dodatkowe pola z ciała błędu API nie docierają do klienta.

### B-108 Teczka sprawy (DOSSIER): dostępność i podgląd ukończonego bloku
- Etykiety: `P3`, `a11y`, `mod:web` · Źródło: code-review PR 2 (`feat/dossier-folder`, uwagi 8-9), D-083
- Opis: (1) `role="tablist"` bez `aria-orientation` - przekładki są pionowe od `sm`, poziome na telefonie (strzałki działają w obu
  osiach, brakuje tylko atrybutu zależnego od układu); (2) `aria-pressed` na wierszu sugeruje przełącznik, którego nie da się
  wyłączyć, a ponowny klik w tę samą zwykłą linijkę nie ogłasza się (ten sam tekst w `role="status"`); (3) w trybie „Wstecz”
  wcześniej zebrane dowody nie są zakreślone (`noted` to stan lokalny), choć w teczce zakreślenie jest główną informacją.
- Akceptacja: `aria-orientation` zgodny z układem, semantyka wiersza bez fałszywego przełącznika i ponowne ogłoszenie komunikatu
  (test RTL); w podglądzie zakreślone wiersze z `progress.notes`/dowodów (test).

### B-109 Sceny odprawy (BRIEFING, D-084): czytelność na telefonie i drobne a11y/UX
- Etykiety: `P3`, `a11y`, `mod:web`, `mod:content` · Źródło: code-review `feat/briefing-scenes` (uwagi 2, 5, 11), layout-check 390×844
- Opis: (1) telefon w pionie: scena 16:9 w trybie „contain” ma ~200 px wysokości, więc tekst dymka i zadań dopasowuje się do ok. 8 px -
  mieści się, ale jest drobny (pod sceną zostaje dużo pustego miejsca); (2) karta sprawy: lista zadań (w scenie) jest w DOM przed
  sr-only „Sprawa nr …” i etykietą „Zadania” - czytnik czyta zadania przed nagłówkiem; (3) hotspot `telefon` obejmuje cały ekran
  telefonu z narysowanym „Odrzuć”, więc klik w „Odrzuć” odbiera połączenie (UX grafiki); (4) layout-check mierzy tylko kontekst
  reduced-motion (Chromium): sprawdza, że adres ma `#static` i obraz się ładuje, ale nie że animacja naprawdę stoi, ani zachowania
  `#static:target` w `<img>` w Safari/WebKit (drugą ochroną jest `@media (prefers-reduced-motion)` wewnątrz SVG).
- Akceptacja: na telefonie w pionie tekst kroku czytelny (np. dymek/zadania pod sceną przy małej wysokości sceny, decyzja UX); kolejność
  DOM: nagłówek sprawy przed zadaniami (test RTL); hotspot tylko na „Odbierz” albo „Odrzuć” usunięte z grafiki; przypadek bez
  reduced-motion w layout-check.

### B-110 Podgląd linku kursu (og:image) z miniatury PNG
- Etykiety: `P3`, `mod:web`, `mod:content` · Źródło: `feat/briefing-scenes` (F, miniatura modułu), D-084
- Opis: właściciel dostarczył `miniatura-wyludzone-haslo.png` (1600×900) na `og:image`, ale strona kursu nie ma dziś żadnych meta
  (`generateMetadata`), a karty kursu używają SVG. PNG nie jest w repo ani w magazynie (plik lokalny u właściciela).
- Akceptacja: `generateMetadata` dla strony kursu (tytuł, opis, `og:image` z PNG opublikowanego potokiem `--assets`, np. osobne pole
  `thumbnailPng` albo konwencja nazwy), test, że strony wymagające logowania nie ujawniają w meta treści kursu poza tytułem i miniaturą.

### B-111 Zbliżenie przedmiotu (D-086): odłożone uwagi z code review
- Etykiety: `P3`, `mod:web`, `mod:content` · Źródło: `feat/scene-zoom` (H), code review
- Opis: (1) przy oddalaniu grafika i przyciski znikają od razu (montowane warunkowo) - crossfade działa tylko przy wejściu;
  (2) transform kamery liczony raz w px - obrót telefonu/resize przy otwartym zbliżeniu zostawia przesunięcie; (3) warstwa
  overlay-stack nadal nazywa się `hotspotCard`; (4) walidacja nie sprawdza unikalności `openHotspot.id` względem `hotspot.id`;
  (5) CLAUDE.md reguła 12 wymienia „karty hotspotu/bottom sheeta” (do zmiany przez właściciela); (6) `content` przedmiotów z grafiką
  nie jest już pokazywany - wiedza z dawnych kart (np. „bank nigdy nie prosi o kod SMS”) żyje tylko w notatkach/rozmowach - przegląd
  treści modułu 1 pod tym kątem.
- Akceptacja: fade-out grafiki 200 ms przed oddaleniem (bez ruchu przy reduced-motion); przeliczenie kamery na `resize` albo
  zamknięcie zbliżenia; nazwa warstwy `sceneZoom`; test unikalności w `module.spec.ts`; decyzja treściowa co do `content`.

### B-112 safe-merge (D-085): uwagi z recenzji, poza zgodą na zmianę skryptu
- Etykiety: `P2`, `security`, `mod:infra` · Źródło: `chore/safe-merge` (G), security + code review, runda 3
- Opis: (1) **DDL poza katalogiem migracji:** `apps/api/src/scripts/content-import.ts` działa rolą migracyjną (`DATABASE_URL`, DDL) i
  rusza automatycznie po `migrate` przy wdrożeniu - PR dodający tam (albo w imporcie) `$executeRawUnsafe` z np. `DISABLE ROW LEVEL
  SECURITY` przeszedłby przez warunek 5; to samo dotyczy seedów (`apps/api/prisma/*.ts`) i przeniesienia schematu przez `apps/api/package.json`
  (pole `prisma.schema`). (2) Atrapa w `safe-merge.test.mjs` nadal obsługuje `git show` dowolnego pliku, a testy z SQL sugerują, że treść
  migracji ma znaczenie. (3) Lista chronionych ścieżek w CLAUDE.md (reguła 11) jest krótsza niż w kodzie/D-085. (4) `main` może się
  przesunąć między sprawdzeniem a merge (`--match-head-commit` przypina tylko HEAD PR).
- Akceptacja: decyzja właściciela; propozycja: `apps/api/src/scripts/**`, `apps/api/prisma/*.{ts,js}` i `apps/api/package.json` w
  `PROTECTED_PATHS` (docelowo własna rola bez DDL dla content-import); atrapa rzuca na `git show` inny niż skrypt; test `failures = []`
  dla samego `schema.prisma`; pełna lista w regule 11; wzmianka o oknie `main` w D-085.

### B-113 Komunikator (DIALOGUE, D-087): odłożone uwagi z code review
- Etykiety: `P3`, `mod:web` · Źródło: `feat/dialogue-chat` (I), code review
- Opis: (1) krok e2e „kwestia otwierająca jest pisana” usunięty ze `scripts/e2e-module-01.mjs` (wskaźnik żyje 0,7-2,2 s - wyścig przy wolnym
  starcie strony); pokrywa to test komponentu; (2) `__setGestureSeenForTests` eksportowany z modułu produkcyjnego `sfx.tsx`; (3) brak testu
  odmontowania bloku w trakcie „pisania” (onReady/notatka); (4) `aria-live` przy `role="log"` nadmiarowe.
- Akceptacja: e2e z wydłużonym opóźnieniem (parametr testowy) albo bez; helper testowy poza modułem; test odmontowania.

### B-114 Tablica śledcza (ORDERING, D-088): odłożone uwagi z code review
- Etykiety: `P3`, `mod:web`, `mod:content` · Źródło: `feat/evidence-board` (J), code review
- Opis: (1) telefon w poziomie (844x390): scena 16:9 ograniczona wysokością - tekst kart ~5 px (jest podpowiedź „Obróć telefon”, bez
  alternatywnego układu); (2) kolory spoza tokenów w cieniowaniu pinezek i liniaturze karty (`globals.css`), promień karty 4 px nie
  skaluje się z `--u`; (3) wyszukiwanie `caseNo` zdublowane (`CoursePlayer.tsx` i `BriefingBlock.tsx`) - wspólny helper; (4) warunek
  `boardFeedback` powiela warunek wyboru `stage`; (5) podgląd ORDERING bez `result.detail` (stary postęp) w układzie `fill` - tekst przy
  górnej krawędzi; (6) `feedbackSentence` dzieli zdania po kropce - skróty („np.”, „A.K.”) rozbiją zdanie; (7) długie elementy (schemat do
  300 znaków) i napisy zdjęć (40/60 znaków) ucinane bez ostrzeżenia - layout-check (b3) sprawdza tylko moduł 1; (8) wskaźnik
  przewijania tacki (dziś tylko licznik w etykiecie).
- Akceptacja: układ kompaktowy dla niskiej sceny (np. tacka jako panel boczny) albo decyzja „tylko pion”; tokeny cieniowania; helper
  `caseNoOf(blocks)`; walidacja treści: limit długości elementu ORDERING dopasowany do karty albo auto-dopasowanie czcionki (FitText).

### B-115 Zamknięcie sprawy (D-089): następna sprawa i odłożone uwagi
- **Status: zrobione (PR #62)** - rozstrzygnięte przez właściciela 2026-09-27: (3) nowa grafika raportu - 9 woreczków (mail, karteczka,
  wydruk, poczta głos., kalendarz, logi, WHOIS, SMS, tablica), liścik w prawej kolumnie strony (nic nie zasłania), nowe sloty pieczęci i
  liściku; (4) panorama raportu w pionie zatwierdzona bez podpowiedzi; (1) „Następna sprawa · wkrótce” i (2) czas „—” dla starych
  przypisań zostają jako zachowanie MVP.
- Etykiety: `P3`, `mod:web`, `mod:api`, `mod:content` · Źródło: `feat/case-closed` (K), D-089
- Opis: (1) „Następna sprawa” jest zawsze zamknięta („wkrótce”) - API nie zna kolejności spraw ani następnego przypisania; (2) przypisania
  rozpoczęte przed migracją `startedAt` pokazują czas „—”; (3) woreczki dowodów w grafice raportu (mail, karteczka, SMS, wydruk, logi,
  WHOIS) to wybór - dowody z telefonu, kalendarza i tablicy nie mają woreczka, a liścik komisarza (slot z treści) przykrywa szósty
  woreczek (WHOIS); (4) panorama raportu na telefonie w pionie nie ma podpowiedzi „przesuń” (jak `.scene-pan-hint` w scenie).
- Akceptacja: pole/endpoint „następna sprawa” (kolejność kursów w katalogu organizacji) i aktywny przycisk; decyzja treściowa o
  woreczkach/pozycji liściku (grafika albo slot); podpowiedź przesuwania w panoramie raportu z testem w layout-check.

### B-116 Ruch w odtwarzaczu - część 2 (D-090)
- **Status: (1) i (2) zrobione (`feat/player-motion-2`); (3) otwarte.**
- Etykiety: `P2`, `mod:web`, `mod:content` · Źródło: `feat/player-motion` (B), plan właściciela
- Opis: czekało na merge zamknięcia sprawy (#65 - te same pliki): (1) stempel PRIORYTET w grafice akt spada (scale 1.4 → 1, rotate −12°,
  lekki bounce, 350 ms) - animacja jednorazowa w klocku sceny (`props-odprawa.ts`, klasa w `compose.ts`, rebuild i publikacja scen);
  (2) koniec modułu: pasek postępu poziomu (600 ms), pop odznaki (.6 → 1.08 → 1), jednorazowe konfetti w kolorach marki (accent,
  accent-soft, success, #FFE066), max 30 cząstek, 1,2 s - na ekranie zamknięcia (`CaseClosedScreen`); reduced-motion bez konfetti.
  (3) Drobne z części 1: szuflada notatnika bez fade (zostaje wysuwana, 200 ms); starsze animacje (odprawa, teczka, czat: 260/280 ms,
  `ease-out`) i zmienne `--motion-*` jeszcze nie czytane przez CSS - przejście na tokeny; lot dowodu startuje ze środka przycisku, nie
  z punktu kursora.
- Akceptacja: jak w specyfikacji B; test reduced-motion, layout-check (brak przesunięć układu przy konfetti), e2e modułu 1.

### B-117 Kopia zapasowa bazy produkcyjnej (postgres_data)
- Etykiety: `P1`, `ops`, `mod:db` · Źródło: `chore/disk-hygiene` (D), docs/ops/DISK.md
- Opis: wolumen `postgres_data` na VPS nie ma kopii zapasowej - awaria dysku, pomyłka (`down -v`, `volume prune`) albo błąd migracji
  oznacza nieodwracalną utratę danych klientów. Skrypty w `scripts/ops` mają zakaz czyszczenia wolumenów (test w CI), ale to tylko
  bariera przed pomyłką.
- Akceptacja: codzienny `pg_dump` (rola z prawem odczytu, poza RLS tylko przez jawny wyjątek) do magazynu poza VPS (np. R2, szyfrowany,
  retencja 14 dni), procedura odtworzenia sprawdzona na kopii, alarm przy nieudanym backupie; wpis w checkliście RODO (retencja kopii).

### B-118 Okno przeglądarki (D-094): tekst ostrzeżenia z treści i odłożone uwagi z code review
- Etykiety: `P3`, `feature`, `mod:kursy` · Źródło: code review `feat/browser-evidence` (D-094)
- Opis: (1) ostrzeżenie po rozstrzygnięciu zadania z `frame: "browser"` ma stały tekst odtwarzacza („Ta strona podszywa się pod bank”,
  „kodów z SMS-ów”) - każde przyszłe zadanie z tą oprawą (np. fałszywe logowanie do poczty albo kuriera) dostałoby komunikat o banku,
  a wersje treści są niemutowalne; (2) w oknie komunikat złej próby (`role="status"`, montowany warunkowo), licznik prób (`aria-live`) i
  pasek podpowiedzi mogą ogłosić złą próbę 2-3 razy - lepszy jeden stały region; (3) layout-check nie sprawdza ścieżki „wyczerpane próby
  z rozwiązaniem w pasku adresu” (dziś ten sam adres co przy poprawnej odpowiedzi); (4) `browserHistory` ma martwą gałąź `hot` (bez
  wpływu na SVG).
- Akceptacja: (1) opcjonalny tekst ostrzeżenia w treści (np. `frame: { kind: "browser", warning: {...} }`, pole ujawniane dopiero po
  rozstrzygnięciu - z odpowiedzi `/attempt`, bo może zawierać fałszywą domenę) albo neutralny tekst domyślny; (2) jeden region live w
  oknie z testem; (3) przypadek w sekcji `browser`; (4) uproszczenie bez zmiany SVG (test identyczności).

### B-119 Resztki maskotki po D-096 (pliki chronione i schemat)
- Etykiety: `P3`, `tech-debt`, `mod:kursy`, `mod:ci` · Źródło: `refactor/remove-mascot-content` (D-096)
- Opis: (1) `.dockerignore` ma dwie martwe linie `packages/content/mascot/*` - plik jest chroniony (reguła 11, safe-merge), więc zostały;
  przy tej samej zmianie warto dopisać `apps/web/public/mascot/` (stara lokalna kopia SVG, której już nic nie czyści, trafiłaby do obrazu
  z lokalnego `docker build`; CI buduje z czystego checkoutu - bez skutku);
  (2) `MASCOT_POSES`, `mascotSchema` i opcjonalne `pose` w `reactions` zostają w schemacie dla starszych wersji treści (`course_versions`
  są niemutowalne); (3) `RESERVED_SLUGS` w `scripts/content/src/hash.ts` nadal zastrzega slug `mascot` (nieszkodliwe).
- Akceptacja: (1) usunięcie linii przy najbliższej zmianie `.dockerignore` przez człowieka; (2) usunięcie pól ze schematu dopiero, gdy
  żadna wersja kursu w bazie ich nie używa (zapytanie na `course_versions` przed zmianą) - osobna decyzja.

### B-120 Sceny pionowe (D-098): ścieżka zastępcza i odłożone uwagi z code review
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: code review `feat/portrait-scenes` (D-098)
- Opis: (1) moduł BEZ `closing.portrait` na niskim telefonie w pionie (360x740) - panorama raportu daje wnioski ~9,7 px (próg 11 px
  ustalono dla 390x844; zachowanie sprzed D-098 - moduł 1 ma już raport pionowy); (2) obrót w oknie 600 ms podpisu (etap `signing`)
  przewija panoramę według slotów poprzedniej orientacji (w pionie bez przewijania - kosmetyka); (3) rotacja nie jest sprawdzana w CI
  (layout-check poza CI - B-101), w vitest są testy ResizeObservera dla sceny i ceremonii; (4) layout-check sprawdza pionowe zamknięcie
  tylko z wnioskami modułu 1 (3 krótkie) - przypadek maksymalny schematu (5 x 120 znaków: lista przewijana, limit 30dvh) bez przebiegu w
  prawdziwej przeglądarce.
- Akceptacja: (1) wnioski pod raportem w HTML także w panoramie (wszystkie moduły) albo próg per wysokość; (2) sloty z bieżącej orientacji
  w chwili przewijania; (3) po B-101; (4) wariant harnessu z najdłuższymi wnioskami (np. `?longLessons=1`) i (z6) na 360x740.

### B-121 Końcowe podsumowanie na telefonie (D-099): odłożone
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: `feat/mobile-summary` (D-099)
- Opis: (1) pionowy zygzak tablicy w `lib/evidence-board.ts` (`boardLayout(..., 'portrait')`) nie jest już używany przez UI (telefon w pionie
  ma listę) - martwy kod z testami; (2) `.mobile-readable` obejmuje tylko bloki od rekonstrukcji do końca - reszta modułu na telefonie ma
  nadal tekst 12-14 px (scena, rozmowa, teczka, mail) i nie jest objęta audytem `auditMobileView`; (3) lista tablicy nie ma przeciągania
  palcem (tylko stuknięcia; myszą - tak).
- Akceptacja: (1) usunięcie gałęzi portrait z `boardLayout` albo decyzja o jej zostawieniu; (2) decyzja właściciela, czy 15 px obowiązuje w
  całym module - wtedy `readableOnPhone` dla wszystkich bloków i sekcja layout-check na cały moduł; (3) tylko jeśli testy z użytkownikami
  pokażą potrzebę.
- **Pkt 2 zrobiony (D-103, `feat/mobile-module-15px`, decyzja właściciela 2026-09-28):** `.mobile-readable` na całej ramce odtwarzacza,
  sekcja layout-check `mobile-module` (s1-s3, s5 w każdym bloku modułu 1 na 390x844 i 360x740). Pkt 1 i 3 zostają. Nowy pkt 4 (code
  review D-103): `mobile-module` nie sprawdza ekranów wyniku bloków modułu 1 (FeedbackPanel, podgląd „Wstecz”) ani bloków spoza modułu 1
  (QUIZ, DRAG_AND_DROP, TABS, VIDEO, EMBEDDED_HTML) - reguła CSS je obejmuje, audyt nie; akceptacja: sekcja z fixturą `fullBlocks()` w
  harnessie.
- **Pkt 1 nie dotyczy (D-105, `fix/phone-review-board`):** tablica w pionie wróciła na korek - gałąź portrait `boardLayout` (teraz jedna
  kolumna zygzakiem) znowu jest używana. **Pkt 3 przeformułowany:** tablica zygzakiem na telefonie nie ma przeciągania palcem (tylko
  stuknięcia: ślad, potem pole; myszą - tak) - bez zmian w akceptacji.

### B-122 Easter egg (D-100): odłożone uwagi z review
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: code review `feat/easter-egg-game` (D-100)
- Opis: ~~(1) ogólne id w SVG ikony `game` (`sky`, `ic`)~~ - **nie dotyczy** (sprawdzone w `feat/transparent-zooms`, D-101): kompozytor
  (`compose.ts`, `scopeIds`) dopisuje do każdego lokalnego id i `url(#…)` sufiks id elementu sceny (`sky-gra`, `ic-gra`), więc id się nie
  dublują; (2) sekcja „Wyróżnienia” jest tylko w panelu notatnika, nie w blokach NOTEPAD/SUMMARY (zgodne z „ukrytym” charakterem - do
  potwierdzenia przez właściciela).
- Akceptacja: (2) decyzja właściciela.

### B-123 Okna na ekranach i w pionie (D-104): odłożone uwagi z review
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: code review `fix/phone-review-windows` (D-104)
- Opis:
  1. `SceneHotspotsBlock` mierzy pion sceny własnym `ResizeObserver` (widok montuje się warunkowo), a nie przez `usePortraitContainer`.
     Warto rozszerzyć hook o zewnętrzny ref/zależności i używać go w obu miejscach.
  2. Klocki `mailWindowPortrait` i `browserHistoryPortrait` zawijają tekst po liczbie znaków. Tytuły i adresy historii w ogóle się nie
     zawijają, a `📎` zależy od czcionki emoji urządzenia. Przy treści modułu 1 wszystko się mieści.
- Akceptacja:
  - (1) jeden hook, testy bez zmian;
  - (2) zawijanie po szacowanej szerokości albo walidacja długości w teście kompozytora; spinacz narysowany ścieżką.

### B-124 Tablica zygzakiem (D-105): odłożone uwagi z review
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: code review `fix/phone-review-board` (D-105)
- Opis:
  1. Obrót (tablet z klawiaturą) montuje przyciski tacki i „Sprawdź trop” od nowa - fokus spada na `body`.
  2. Podpowiedź obrotu (`cramped`) liczy szerokość sceny z korzenia bloku (z promptem), nie ze sceny - przy 844×390 bez skutku (prompt
     `sr-only`).
  3. Przeciąganie myszą w pionie nie przewija sceny przy krawędzi; pióro w pionie dostaje `pointercancel` (`touch-pan-y`).
  4. Tabliczka tytułu bez limitu szerokości - bardzo długi `caseNo` nachodziłby na zdjęcie początku.
  5. W pionie etykieta i podpis zdjęcia mają ten sam rozmiar (15 px) - słabsza hierarchia.
  6. layout-check nie sprawdza przewinięcia kontenera sceny po wyborze śladu (Playwright sam przewija pole przed kliknięciem).
- Akceptacja: poprawki z testem albo decyzja, że zostają.

### B-125 `scripts/e2e-registration.mjs` nieaktualny względem odtwarzacza
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: `fix/single-next` (D-106)
- Opis: skrypt (ręczny, poza CI) klika „Kontynuuj” w blokach eksploracyjnych i czeka na „Blok ukończony.” po nich, a mierzy pasek
  przez `.sticky`. Tego wszystkiego odtwarzacz nie ma od czasu gotowości przez pasek (`onReady`) i ramki `PlayerStage`. W D-106
  poprawione tylko miejsca jednego „Dalej” (zadanie tekstowe, „Ukończyłem”, „Zakończ sprawę”).
- Akceptacja: pełne przejście skryptu na lokalnym stosie.

### B-126 Jeden „Dalej” (D-106): odłożone uwagi z review
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: code review `fix/single-next` (D-106)
- Opis:
  1. Fokus po podpisie raportu (`CaseClosedScreen.sign`) szuka „Wróć do biblioteki” w DOM powłoki (`querySelector`) - czyściej ref
     z `PlayerStage`/`CoursePlayer`.
  2. Puls „Dalej” pojawia się też przy wejściu w podgląd „Wstecz” (tam „Dalej” staje się aktywny) - można ograniczyć do gotowości
     i wyniku.
  3. `readySubmit` zamyka `preference.enabled` z chwili zgłoszenia gotowości - przełączenie lektora przed „Dalej” daje nieaktualną
     decyzję o autoodtwarzaniu następnego bloku (kosmetyka).
  4. Nieaktywny „Dalej” (`disabled`) nie jest osiągalny Tabem, więc podpowiedź w `aria-describedby` słyszy tylko ktoś, kto do niego
     trafi - rozważyć `aria-disabled` z fokusem.
  5. Brak testu ostatniego kroku odprawy z niewczytanym obrazem (gotowy od wejścia, bez cta).
- Akceptacja: poprawki z testem albo decyzja, że zostają.
- **Status: (2) i (5) zrobione** (V, `chore/pre-module-2`): puls i ogłoszenie „Dalej” tylko przy gotowości i wyniku (`announceForward`,
  bez podglądu „Wstecz”) z testem; test ostatniego kroku odprawy z niewczytanym obrazem. (1), (3), (4) otwarte (ponad 15 min każde).

### B-127 Zamknięcie sprawy w pionie (D-107): odłożone
- Etykiety: `P3`, `ux`, `mod:kursy` · Źródło: code review `fix/phone-review-closing` (D-107)
- Opis:
  1. Nagroda (awans na poziom, nowe odznaki) na telefonie w pionie jest tylko w opisie dla czytnika - wzrokowo niewidoczna (spod
     raportu zniknął pasek poziomu i odznaki, D-107). Pomysł: slot na odznakę/awans w grafice raportu albo krótki toast przy ceremonii.
  2. Wnioski w slocie pionowego raportu (min. 15 px, `overflow-hidden`) - bardzo długie wnioski innego modułu ucięłyby się bez
     sygnału; layout-check pilnuje tylko modułu 1. Limit długości `lessons` w walidacji treści albo test w `odprawa.test`.
- Akceptacja: (1) decyzja właściciela; (2) walidacja albo test.
- **Status: (1) zrobione** (V, `chore/pre-module-2`, decyzja właściciela): toast nagrody nad dolnym paskiem w pionie (awans poziomu i nowe
  odznaki, 2,5 s, reduced-motion bez animacji, `aria-hidden` - czytnik ma opis raportu), styl jak karta trofeum. (2) otwarte.

### B-128 Drugi moduł: narzędzia i otwarte kwestie treści (D-108)
- Etykiety: `P2`, `tech-debt`, `mod:kursy` · Źródło: code review `docs/module-playbook` (D-108)
- Opis:
  1. Narzędzia weryfikacji są pod moduł 1: `scripts/content/scenes/odprawa.test.ts` bierze wszystkie `scenes/examples/*.json` i porównuje
     je z grafikami `wyludzone-haslo` (`toHaveLength(28)`), harness `apps/web/src/app/dev/player-harness/page.dev.tsx` ma
     `MODULE_SLUG = 'wyludzone-haslo'`, a `scripts/e2e-module-01.mjs` przechodzi tylko moduł 1. Uogólnić: źródła scen w
     `scenes/examples/<slug>/`, slug w harnessie i layout-check, e2e per moduł.
  2. `steps[].caller.avatar` (BRIEFING, krok `call`) nie jest w `ASSET_PATHS` (`scripts/content/src/assets.ts`) - avatar dzwoniącego nie
     zostałby opublikowany.
  3. Brak zapisu sprawdzenia fikcyjnych nazw modułu 1 („Bank Wektor”, `bankwektor.pl`, `bankwektor-weryfikacja.pl`) - wynik i data do
     `SCENARIUSZ.md`.
  4. Nazwa okienka easter egga „GTA6_PL.exe” (D-100) nawiązuje do cudzej marki - decyzja właściciela: zostaje czy zmiana nazwy.
- Akceptacja: (1) drugi moduł przechodzi layout-check i e2e; (2) pole w `ASSET_PATHS` z testem; (3) zapis w scenariuszu; (4) decyzja.
- **Status: zrobione** (V, `chore/pre-module-2`): (1) źródła scen w `scenes/examples/<slug>/` (i `achievements/`), test scen per cel z
  kontrolą „grafika bez źródła”, harness `?module=<slug>` (zasoby `/dev/module-assets/<slug>/…`), layout-check `LAYOUT_CHECK_MODULE` (sekcja
  `module`), e2e smoke `scripts/e2e-module.mjs <slug>`; (2) `steps[].caller.avatar` w `ASSET_PATHS` z testem; (3) rejestr nazw fikcyjnych w
  `MODULE-PLAYBOOK.md` (rozdział 8) - status domen `.pl` do sprawdzenia przez właściciela (dns.pl); (4) „GTA6_PL.exe” zostaje (D-100).

### B-129 Nagrania ze `spokenText` (D-109): napisy i zgodność napisu z mową
- Etykiety: `P3`, `ux`, `mod:kursy` · Źródło: code review `fix/tts-numbers` (D-109)
- Opis:
  1. Narracja ze `spokenText` nie dostaje `cues` z TTS (potok celowo ich nie liczy - wyświetlałyby słowny zapis zamiast „8:47”);
     odtwarzacz dzieli napisy proporcjonalnie do długości zdań, więc długie ostatnie zdanie może się rozjechać z mową. Pomysł: cues z
     `spokenText` przemapowane na zdania z `text` (ta sama liczba zdań).
  2. `odprawa` krok 1 (moduł 1): napis „Mamy zgłoszenie…” różni się od mowy „Detektywie, mamy zgłoszenie…” - różnica sprzed D-109 (poza
     zakresem W: „nie zmieniaj treści poza spokenText”).
- Akceptacja: (1) cues dla narracji ze `spokenText` z testem potoku; (2) decyzja właściciela - wyrównać napis czy zostawić.

### B-130 Osiągnięcia (D-111): odłożone uwagi z review
- Etykiety: `P3`, `ux`, `mod:kursy` · Źródło: code review i security review `feat/achievements` (X, część 2)
- Opis:
  1. Outro easter egga pokazuje „Nowe osiągnięcie” na podstawie notatnika bieżącego podejścia - po restarcie kursu także dla osiągnięcia
     zdobytego wcześniej (klient nie zna zdobytych osiągnięć; serwer przyznaje je dopiero przy zapisie bloku, po outro).
  2. Rewers karty osiągnięcia (przewijany przy długim tekście) jest w przycisku i `aria-hidden` - czytnik dostaje treść z `aria-live`,
     ale osoba z klawiaturą nie przewinie dłuższego tekstu na wąskim ekranie (dzisiejsze teksty się mieszczą - layout-check).
  3. `gamification.e2e-spec.ts` dokłada do kursu `wyludzone-haslo` wersję testową, jeśli kurs już jest w bazie (lokalnie); sprzątana w
     `afterAll`, ale przerwany test ją zostawi. Test izolacji A/B osiągnięć nie przechodzi lokalnie (superuser omija RLS, B-085) - tylko CI.
  4. Teoretyczne zakleszczenie (40P01): użytkownik bez przyznania wstecznego kończy kurs dokładnie w chwili ładowania profilu w innej
     karcie - oba ruszają `user_badges` i `users` w innej kolejności; Postgres przerwie jedno, odświeżenie naprawia (idempotentnie).
- Akceptacja: (1) /start (albo odpowiedź zapisu) mówi, czy osiągnięcie easter egga jest już zdobyte, outro bez „Nowe” w takim przypadku;
  (2) przewijanie rewersu klawiaturą (np. osobny, fokusowalny region po odwróceniu); (3) test na własnym kursie albo rollback wersji.

## F. Symulacje phishingowe i zgłoszenia

### B-050 Alert SUPER_ADMIN: odbiorcy spoza zweryfikowanej domeny
- Etykiety: `P2`, `security`, `mod:phishing` · Źródło: `docs/phishing-simulations.md` „Znane ograniczenia”
- Opis: sygnał nadużycia (wysyłka z naszej domeny do osób trzecich), gdy >20% odbiorców kampanii to adresy spoza domeny organizacji.
- Akceptacja: alert i test progu.

### B-051 Dopracowane limity wysyłki symulacji
- Etykiety: `P2`, `security`, `mod:phishing` · Źródło: `docs/phishing-simulations.md`
- Opis: poza limitem dobowym (2 × licencje): per kampania, per godzinę, reputacja domeny.
- Akceptacja: limity z testami; decyzja o wartościach.

### B-052 Alert audytowy różnicowania wyników małych grup
- Etykiety: `P3`, `security`, `mod:phishing`, `mod:zgloszenia` · Źródło: `docs/phishing-simulations.md`, checklista prywatności
- Opis: gdy w ciągu 7 dni powstają wielokrotne, zbliżone widoki pozwalające odjąć małą grupę (ryzyko rezydualne zaakceptowane w D-021).
- Akceptacja: alert audytowy i test.

### B-053 Powiadomienia o zgłoszeniach: kolejka per organizacja
- Etykiety: `P3`, `tech-debt`, `mod:zgloszenia` · Źródło: `docs/phishing-simulations.md`, D-026
- Opis: zamiast pętli co 5 minut po wszystkich organizacjach - kolejka opóźniona uruchamiana przy zgłoszeniu (wzorzec `phishing/campaigns`).
- Akceptacja: mniejsze opóźnienie maila, brak skanowania organizacji bez zgłoszeń, testy izolacji i idempotencji.

### B-054 Ekran kierownika działu (v2)
- Etykiety: `P3`, `feature`, `decision-needed`, `mod:zgloszenia` · Źródło: `docs/phishing-simulations.md`
- Opis: API kierownika jest gotowe i przetestowane, osobny ekran to backlog v2.
- Akceptacja: decyzja i projekt ekranu (bez tematu i nadawcy, D-023).

## G. Import i zaproszenia

### B-060 Domena organizacji-właściciela nie jest blokowana przy przejęciu przez rejestrację
- Etykiety: `P3`, `security`, `mod:import`, `mod:rejestracja` · Źródło: przegląd bezpieczeństwa (niska waga)
- Opis: w `claimRegistration` sprawdzenie zweryfikowanej domeny organizacji-właściciela nie blokuje wiersza domeny (`FOR SHARE`); okno ułamka sekundy,
  skutek to jedno zaproszenie do ponownej wysyłki.
- Akceptacja: `FOR SHARE` na wierszu domeny albo warunek w samym zapisie; test wyścigu.

### B-061 Sprzątanie wygasłych potwierdzeń rejestracji bez skanu wszystkich organizacji PENDING
- Etykiety: `P3`, `tech-debt`, `mod:rejestracja` · Źródło: przegląd (koszt `purgeExpiredClaims`)
- Opis: po zawężeniu do organizacji starszych niż 24 h nadal skanujemy je transakcja po transakcji (filtr po relacji poza RLS nie działa).
- Akceptacja: znacznik na `organizations` (np. „ma oczekujący wpis”) albo inne tanie kryterium; benchmark przy tysiącach organizacji PENDING.

### B-062 Wyścig limitu dobowego zaproszeń: ręczne vs kolejka
- Etykiety: `P3`, `tech-debt`, `mod:import` · Źródło: przegląd bezpieczeństwa
- Opis: `assertInviteQuota` (ręczne zaproszenia) nie bierze blokady `import-invites:<org>`, więc bieg joba i ręczne zaproszenie mogą przekroczyć 300 o kilka.
- Akceptacja: wspólna blokada albo świadomie udokumentowane przybliżenie.

### B-063 Nieaktualne liczniki w podsumowaniu importu po przeniesieniu wierszy do `EXISTING`
- Etykiety: `P3`, `bug`, `mod:import` · Źródło: przegląd
- Opis: `validCount`/`existingCount` partii nie są aktualizowane przy potwierdzeniu, gdy konto pojawiło się po podglądzie.
- Akceptacja: liczniki zgodne z wierszami po potwierdzeniu, test.

### B-064 Job zaproszeń nie sprawdza statusu organizacji
- Etykiety: `P3`, `tech-debt`, `mod:import` · Źródło: przegląd
- Opis: po zawieszeniu lub zmianie statusu organizacji kolejka nadal wysyła zaproszenia.
- Akceptacja: warunek statusu w jobie (jeśli taki stan istnieje) i test.

### B-065 Szacowana data zakończenia importu uwzględniająca zaproszenia ręczne
- Etykiety: `P3`, `feature`, `mod:import` · Źródło: `docs/user-import.md`
- Opis: ETA zakłada stały limit i brak innych zaproszeń w organizacji.
- Akceptacja: lepsze przybliżenie albo jawny opis w UI.

### B-066 Adresy e-mail odbiorców w logach `EmailService`
- Etykiety: `P2`, `security`, `mod:ci` · Źródło: przegląd bezpieczeństwa (RODO)
- Opis: `logger.error` zapisuje adres odbiorcy i fragment odpowiedzi dostawcy; to dane osobowe w logach aplikacyjnych.
- Akceptacja: logowanie wyłącznie kodu/szablonu i identyfikatorów, test na brak adresu w logu.

### B-067 Niezgodność długości kolumn `pending_admin_claims.legalVersion` (64) i `legal_acceptances.version` (40)
- Etykiety: `P3`, `bug`, `mod:db` · Źródło: wykryte testem atomowości
- Opis: wersja dokumentów dłuższa niż 40 znaków przeszłaby zapis wpisu, a padła przy tworzeniu zgód.
- Akceptacja: wyrównanie długości (migracja) albo walidacja przy zapisie wpisu.

### B-068 `README` opisuje wygasanie niepotwierdzonych kont jako „do rozważenia”
- **Status: zrobione** (razem z B-019)
- Etykiety: `P3`, `docs` · Źródło: README „Moduł e-mail / Backlog”
- Opis: wygasanie jest zrobione (organizacje PENDING po 14 dniach, zaproszenia po 30 dniach, wpisy potwierdzeń po 24 h).
- Akceptacja: wpis README zaktualizowany; patrz B-019.

## D. Silnik szkoleń (scen) - odłożone i następne kroki

### B-069 Certyfikat ukończenia szkolenia (następne zadanie po silniku scen)
- Etykiety: `P1`, `feature`, `decision-needed`, `mod:kursy` · Źródło: decyzja właściciela produktu 2026-09-21 (D-051)
- Opis: certyfikat jest potrzebny do kwalifikacji „usługa szkoleniowa” (decyzja podatkowa); dziś nie ma go w produkcie (SUMMARY w silniku scen pokazuje raport z
  notatek i wynik, bez certyfikatu). To kolejne zadanie zaraz po silniku scen (PR 1-4).
- Akceptacja: decyzja o treści i danych na certyfikacie (imię i nazwisko, kurs, wersja treści, data, wynik, numer), generowanie i pobieranie (PDF), weryfikacja
  autentyczności (numer/link), dane osobowe w `docs/legal/privacy-policy-checklist.md`, RLS i test izolacji A/B, blok SUMMARY z linkiem do certyfikatu.

### B-070 Przeniesienie pracownika będącego w trakcie kursu na nowszą wersję treści
- Etykiety: `P3`, `feature`, `decision-needed`, `mod:kursy` · Źródło: D-051
- Opis: przypisanie zostaje na wersji, na której się zaczęło (niemutowalne `course_versions`). Brakuje operacji świadomego przeniesienia (np. gdy stara wersja ma
  błąd merytoryczny) z mapowaniem po `blockId`.
- Akceptacja: decyzja (kto, kiedy, co z wynikiem), operacja w panelu administracyjnym (B-031) z podglądem skutków, testy A/B.

### B-072 Złożony klucz obcy `(courseId, courseVersionId)` w `course_assignments`
- Etykiety: `P3`, `tech-debt`, `security`, `mod:kursy`, `mod:db` · Źródło: przegląd bezpieczeństwa silnika scen (D-051)
- Opis: FK wskazuje tylko `course_versions.id`, więc spójność wersji z kursem przypisania pilnuje wyłącznie kod (`resolveVersion`). Dziś nie ma ścieżki ataku.
- Akceptacja: złożony FK (jak dla tenantowych kluczy użytkownika), migracja z odpowiednim `@@unique` na `course_versions(courseId, id)`, test.

### B-073 Testy współbieżności `/progress` oraz `/start` równolegle z `/attempt`
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: przegląd bezpieczeństwa silnika scen (D-051)
- Opis: pokryte są równoległe `/attempt` (limit prób) i równoległe `/start` (wersja 1), brak równoległych zapisów postępu ani mieszanki start/attempt.
- Akceptacja: testy e2e (`app.listen(0)`, `Promise.allSettled`): jeden zwycięzca zapisu bloku (409 dla reszty), brak podwójnego XP, spójny stan po mieszance.

### B-074 Migracja na Node 22 (Dockerfile'e, CI, reguła 9) - osobny PR
- Etykiety: `P2`, `tech-debt`, `ops`, `mod:ci` · Źródło: `docs/decisions.md` D-052
- Opis: obrazy (`node:20-alpine`) i CI (`node-version: 20`) działają na Node 20, przez co `re2` jest przypięte do 1.21.5 (nowsze wymagają Node >=22 i nie
  mają prebuilda `linux-musl` pod Node 20). Migracja odblokowuje aktualne `re2` i inne zależności z wymaganiem Node >=22 (np. nowsze `node-gyp`).
- Akceptacja: Dockerfile'e API i web oraz joby CI na Node 22 (LTS), replika CI z reguły 9 w CLAUDE.md (`node:22`), zielone testy i e2e, podniesione `re2`
  (usunięty pin z D-052), zaktualizowane `docs/onboarding.md` i README (wersja Node).

### B-075 Awatary: tylko presety albo własny upload (zamiast dowolnego URL)
- **Status: zrobione** (D-067): API przyjmuje wyłącznie presety, migracja wyczyściła awatary z zewnętrznych adresów do NULL, a własne
  zdjęcie wgrywa się przez `POST /users/me/avatar/image` (obraz kodowany od nowa: 256×256 WebP bez EXIF, w bazie z RLS, serwowany przez
  nasz origin). Testy: `avatar-image.spec.ts`, e2e avatara w `gamification.e2e-spec.ts` (w tym izolacja A/B), testy tras BFF i UI.
- Etykiety: `P2`, `security`, `feature`, `decision-needed`, `mod:web` · Źródło: D-053 (CSP), decyzja właściciela 2026-09-21
- Opis: awatar z dowolnego adresu `https` (`<img src={avatarUrl}>`) nie mieści się w `img-src 'self' data: <CONTENT_BASE_URL>` (CSP z D-053), więc obrazek
  się nie załaduje; do czasu decyzji UI pokazuje inicjały (fallback przy błędzie ładowania). Nie poszerzamy `img-src` o `https:`.
- Akceptacja: decyzja (tylko presety albo własny upload do zasobów z `CONTENT_BASE_URL`), walidacja w API (odrzucenie zewnętrznych URL-i), migracja
  istniejących awatarów z URL-a (na preset/inicjały), test A/B, zaktualizowana sekcja avatara w ustawieniach konta (`AvatarSettings`).

### B-076 Migracja istniejących bloków VIDEO na zasoby z `CONTENT_BASE_URL`
- Etykiety: `P2`, `tech-debt`, `mod:kursy` · Źródło: D-053 (CSP), decyzja właściciela 2026-09-21
- Opis: `<video src>` z dowolnego hosta jest blokowany przez `media-src 'self' <CONTENT_BASE_URL>`. Nowe bloki VIDEO używają ścieżki względnej z
  `CONTENT_BASE_URL`; stare bloki z zewnętrznym adresem `https` dostają w odtwarzaczu link „Otwórz wideo” (`target="_blank"`, `rel="noopener noreferrer"`,
  tylko `https`).
- Akceptacja: lista istniejących kursów z zewnętrznym wideo, wgranie plików do zasobów (R2), nowa wersja kursu z ścieżkami względnymi (wersje niemutowalne,
  D-051), usunięcie linku zastępczego po migracji.

### B-077 Menu główne na wąskich ekranach (hamburger)
- Etykiety: `P2`, `feature`, `mod:web` · Źródło: zrzuty odtwarzacza (PR 2), decyzja właściciela 2026-09-21
- Opis: pozycje menu w `Topbar` nie mieszczą się na 390 px (np. „Zesp” ucięte). Tymczasowo: menu przewijane poziomo wewnątrz paska, a w odtwarzaczu szkolenia
  tryb skupienia (`focusMode`) ukrywa pozycje menu na telefonie (zostaje logo, „Zgłoś” i avatar).
- Akceptacja: menu zwijane w przycisk „hamburger” na wąskich ekranach (dostępne z klawiatury i czytników, fokus w panelu, zamykanie Escape), test na
  390 px bez przewijania poziomego strony, aktualizacja `Topbar.test.tsx`; po wdrożeniu usunięcie obejścia `focusMode` albo zostawienie go jako opcji skupienia.

### B-078 Narracja elementów bloków eksploracyjnych (hotspot, odpowiedź w dialogu)
- Etykiety: `P2`, `feature`, `mod:web` · Źródło: PR 2 (commit 4), D-054
- Opis: schemat pozwala na osobną narrację dla punktu sceny (`hotspots[].narration`) i odpowiedzi postaci (`questions[].answerNarration`); komponenty
  bloków (`SceneHotspotsBlock`, `DialogueBlock`) na razie pokazują wyłącznie tekst, a nagranie całego bloku gra w dolnym pasku jak dotąd.
- Akceptacja: odtwarzanie nagrania po wybraniu elementu (z poszanowaniem przełącznika „Lektor”, jedno nagranie naraz, zatrzymanie przy zmianie
  elementu/bloku), napisy jak w `NarrationPlayer`, testy jednostkowe; dopiero po dostarczeniu plików audio (PR 3).

### B-081 Login CSRF i limity na publicznych trasach BFF
- Etykiety: `P2`, `security`, `mod:web` · Źródło: audyt tras BFF (fix/bff-same-origin), decyzja właściciela 2026-09-21; lista tras publicznych: `PUBLIC` w `apps/web/src/app/api/mutating-routes-csrf.test.ts`
- Opis: trasy bez sesji (`auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`, `auth/verify-email`, `auth/claim-registration`, `auth/resend-verification`, `demo-request`, `t/[token]/view|submit`) nie mają sesji do nadużycia przez CSRF, ale zostają: login CSRF (wymuszenie logowania na cudze konto), spam i limity (throttling po stronie API vs BFF), ocena, które trasy mają wymagać własnego `Origin`, a które muszą działać z zewnątrz (`t/*` to publiczne linki symulacji).
- Akceptacja: decyzja per trasa, testy, po pilocie. Uwaga z przeglądu: `auth/register`, `auth/forgot-password`, `auth/resend-verification` i `demo-request` można wykorzystać do wysyłania maili na cudzy adres (mail-bombing), więc limity w API są częścią tej oceny; `auth/login` podlega login CSRF. Ciasteczko sesji ma `SameSite=Lax` (`apps/web/src/lib/auth-cookies.ts`).

### B-082 Audio podpowiedzi przez API po odblokowaniu (podpisany URL)
- Etykiety: `P3`, `feature`, `security`, `mod:kursy` · Źródło: PR 3 (przegląd bezpieczeństwa commitu 4), decyzja właściciela 2026-09-22
- Opis: podpowiedzi (`hints[].narration`) to pola `secret`, a audio i napisy idą do PUBLICZNEGO magazynu (R2/`CONTENT_BASE_URL`), więc dziś podpowiedzi
  nie mają nagrań (zostają tekstowe; `scripts/content` odmawia audio dla pól `secret` i pilnuje tego testem wiążącym `NARRATION_PATHS` z `FIELD_CLASSIFICATION`).
- Akceptacja: nagrania podpowiedzi w prywatnym prefiksie/bucketcie, wydawane przez API dopiero po odblokowaniu podpowiedzi (podpisany URL o krótkiej
  ważności, z zachowaniem `maxAttempts`), test, że przed odblokowaniem żaden URL ani skrót nagrania nie jest znany klientowi; potem zdjęcie wyjątku TEXT_ONLY.

### B-083 Zapisy potoku audio nie są transakcyjne; maskowanie zakodowanych form sekretów
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: PR 3 (przegląd bezpieczeństwa commitu 4, N4 i N5)
- Opis: (1) kolejność zapisów `module.json` -> `audio.lock.json` -> manifest nie jest transakcją (przerwanie po pierwszym zapisie zostawia moduł bez locka;
  samonaprawialne kolejnym przebiegiem z cache, `--check` to wykrywa; zapisy pojedynczych plików są atomowe, bez fsync). (2) `redactSecrets` maskuje tylko
  dosłowne wartości sekretów (nie formy URL-encoded ani base64) i pomija wartości krótsze niż 6 znaków. (3) Przy niepełnej parze nagranie + sidecar (przerwany
  przebieg, odrzucony sidecar) potok nadpisuje nagranie pod tym samym, niemutowalnym kluczem (`immutable`), a MP3 z ElevenLabs nie jest deterministyczne:
  klient albo CDN ze starą kopią może mieć audio niezgodne z nowymi czasami napisów.
- Akceptacja: zapis pary module+lock jako jedna operacja (albo lock najpierw z oznaczeniem „w toku”), maskowanie także zakodowanych form; przy odrzuconym
  sidecarze nowy klucz (np. z licznikiem regeneracji w skrócie) zamiast nadpisania; test.

### B-084 Lint SVG (scripts/content) parserem XML zamiast regexów na surowym tekście
- Etykiety: `P3`, `tech-debt`, `security`, `mod:kursy` · Źródło: PR 3 (przegląd bezpieczeństwa commitu 5), decyzja właściciela 2026-09-22
- Opis: `svg-lint.ts` sprawdza SVG regexami na tekście (obrona w głąb - klient renderuje SVG wyłącznie przez `<img>`, silnik szkoleń pkt 4;
  druga linia to CSP/`X-Content-Type-Options` na `content.unfooly.com`, docs/content-pipeline.md). Regexy po przeglądzie łapią znane obejścia
  (prefiks przestrzeni nazw `<x:script>`, numeryczne encje `&#106;avascript:`, złe kodowanie UTF-16 zamiast UTF-8 - odrzucane osobno w
  `assets.ts` przed lintem), ale nie są parserem: komentarz XML rozcinający nazwę tagu, `CDATA`, UTF-7 bez BOM, animacja SMIL zmieniająca
  `href`/`xlink:href` w czasie (`<animate attributeName="href" to="...">`, `<set>`, `<animateMotion>` - `hrefsOf()` sprawdza tylko atrybuty
  statyczne na otwierającym tagu) i inne sztuczki XML mogą wciąż ominąć dopasowanie. Ryzyko dziś ograniczone: treść tworzy wyłącznie zaufany
  operator (D-058), a CSP `sandbox` na `content.unfooly.com` blokuje taki fetch niezależnie od tego, czy adres był statyczny czy z SMIL.
- Akceptacja: lint na drzewie XML (np. `fast-xml-parser` w trybie XML) sprawdzający local-name elementu/atrybutu po rozwiązaniu namespace,
  zamiast dopasowań tekstowych; przed rozszerzeniem autorstwa treści poza operatora (temat wraca też w D-058 pkt 5a).

### B-085 Lokalna replika CI dla e2e API nie działa (kontenery ci-pg/ci-redis bez publikacji portów)
- Etykiety: `P2`, `tech-debt`, `mod:kursy` · Źródło: PR 4, naprawa CI po commitcie schematu v4 (2026-09-22)
- Opis: `docker ps` na maszynie deweloperskiej pokazuje kontenery `ci-pg`/`ci-redis` (Postgres 16, Redis 7), ale bez opublikowanych
  portów na hosta (`5432/tcp`, `6379/tcp` bez `0.0.0.0:...->`), więc `npm run test:e2e --workspace=apps/api` z `.env.test`
  (`DATABASE_URL` na `localhost:5432`) nie może się połączyć. Efekt uboczny: po błędzie połączenia w `beforeAll` Jest wisiał
  ponad godzinę zamiast zakończyć się szybko (`--runInBand`, nieudane `app.listen`, brak `--forceExit`) - trzeba było ręcznie
  zabić proces `node`. CLAUDE.md reguła 9 opisuje replikę CI jako "kontener `node:20` z `--cpus=2`, Postgres 16 i Redis 7 w
  Dockerze" - dziś nie da się jej uruchomić z gotowych kontenerów bez ręcznej konfiguracji sieci/portów.
- Akceptacja: kontenery `ci-pg`/`ci-redis` publikują porty na hosta (albo dokumentacja/skrypt uruchamia `test:e2e` wewnątrz
  tej samej sieci Dockera co te kontenery, np. przez `docker compose run`), żeby pełny `npm run test:e2e --workspace=apps/api`
  dało się uruchomić lokalnie przed pushem, bez polegania wyłącznie na CI. Rozważyć też timeout/`--forceExit` w `test:e2e`,
  żeby błąd połączenia z bazą kończył się szybko, a nie wielogodzinnym zawieszeniem.
- **Podpunkt (2026-09-24, code review PR #36 `fix/hotspot-stacking-order`):** produkcyjny bug hotspotu "karteczka"
  przysłoniętego przez "monitor" (naprawiony w tym PR - `hotspotStackZIndex`, z-index odwrotnie proporcjonalny do
  powierzchni) to DOKŁADNIE ten rodzaj regresji, którego jsdom (testy jednostkowe) nie wykrywa - brak realnego
  layoutu/hit-testingu po współrzędnych. Prawdziwą przeglądarkę ma `scripts/e2e-module-01.mjs` (Playwright, którego
  domyślny `.click()` odrzuca klik na element zasłonięty innym - złapałby ten błąd), ale skryptu nie dało się dotąd
  uruchomić lokalnie z powodu tego zgłoszenia. Gdy B-085 się rozwiąże: dopisać do `e2e-module-01.mjs` (albo osobnego
  testu wizualnego) scenariusz kliknięcia w "karteczkę" na scenie ze scrollem pod lepkim dolnym paskiem
  "Wstecz/Dalej" (viewport mobilny) - regresja z-index/`isolate` (patrz `docs/decisions.md` D-073 pkt 5) inaczej
  może wrócić niezauważona.

### B-086 Media w hotspotach (audio/obraz/dokument) sceny z punktami - CZĘŚCIOWO ROZWIĄZANE (D-071, schemat)
- Etykiety: `P3`, `feature`, `mod:kursy` · Źródło: PR 4, decyzja właściciela 2026-09-22 (nie implementować teraz); podjęte:
  `feat/hotspot-media`, decyzja właściciela 2026-09-23 (D-071)
- Opis: dziś karta punktu sceny (`SCENE_HOTSPOTS`) ma tylko tekst (`hotspot.content`). Potrzebne rozszerzenie o
  `hotspots[].media: { kind: 'audio', audioUrl, transcript } | { kind: 'image', src, alt } | { kind: 'document', title, lines[] }`:
  audio jako karta z WŁASNYM odtwarzaczem (np. poczta głosowa atakującego, inny głos niż narrator), obraz/dokument jako
  podgląd na pełnym ekranie (wydruk, mail na ekranie monitora). Rozszerza mechanizm dowodów/notatnika z B-078 (ta sama
  karta, nowy typ zawartości). D-071 dorzuciła do zakresu (decyzja właściciela przy planowaniu tego PR): `action: 'next'`
  ("drzwi" - kończy blok jak "Dalej") i `media.kind: 'scene'` (zagnieżdżona mini-scena, max 1 poziom, dowody z niej LICZĄ
  SIĘ do bloku, id spłaszczone) - **`hotspot.nextScene` jako osobna nawigacja i `voiceId` per narracja świadomie
  ODRZUCONE** na rzecz prostszego kształtu (voiceId nie jest dziś potrzebny: zmiana głosu idzie przez
  `ELEVENLABS_VOICE_ID` + regenerację; audio hotspotu to zwykły plik `--assets`, nie przechodzi przez TTS).
- Akceptacja: ~~schemat (`packages/content`) z polem `media` sklasyfikowanym w `FIELD_CLASSIFICATION`~~ **ZROBIONE**
  (D-071, `feat/hotspot-media`: `hotspots[].media`, `hotspots[].action`, zagnieżdżona scena, `FIELD_CLASSIFICATION`,
  `V4_FEATURES`). ~~`apps/api`'s `evaluate.ts`/`client-view.ts` liczące spłaszczone id~~ **ZROBIONE** (`flattenHotspots`,
  dzielona z walidacją modułu - `evaluate.ts` waliduje `visited`/`noted` i "wymagane elementy" na spłaszczonej liście,
  `client-view.ts` liczy `evidenceSummary` i rozwiązuje notatki tak samo; `apps/api/test/course-engine.e2e-spec.ts`
  zaktualizowany ręcznie, bez lokalnego uruchomienia - B-085). WCIĄŻ DO ZROBIENIA (ta sama gałąź, kolejne commity):
  komponent `SceneHotspotsBlock` renderujący każdy wariant + nawigację "Dalej" dla `action:'next'`, `scripts/content
  --assets` dla mp3, treść modułu 1 (nowe grafiki od właściciela).

### B-087 ~~`subtitle`/`level`/`objectives` (metadane modułu) giną przy imporcie~~ - ROZWIĄZANE (D-065)
- Etykiety: `P3`, `feature`, `mod:kursy` · Źródło: PR 4 commit 3 (moduł „Sprawa: wyłudzone hasło”), D-061 pkt 1
- **Rozwiązane** hotfixem `fix/imported-course-visibility` (D-065, `Course.subtitle`/`level`/`objectives`, migracja
  `20260922180000_course_catalog`, `content-import.ts`'s `courseData` je teraz kopiuje) - powstało przy okazji katalogu
  kursów (`GET /courses/catalog`), który potrzebował tych pól do karty. Nadal NIE są pokazywane na `CourseCard.tsx`
  ani `SummaryBlock.tsx` (Biblioteka/SUMMARY) - tylko w nowym widoku Katalogu (`CourseCatalog.tsx`, tylko
  `subtitle`, bez `level`/`objectives` w UI). Ewentualne pokazanie ich też w Bibliotece/SUMMARY to osobne, mniejsze
  zadanie (dane już są w bazie i DTO, brakuje tylko renderu).

### B-089 Panel przypisań dla ORG_ADMIN - przypisz kurs wybranym osobom/działowi/całej organizacji
- Etykiety: `P1`, `feature`, `mod:kursy` · Źródło: D-065 (hotfix `fix/imported-course-visibility`), zgłoszone przez
  właściciela produktu przy tym samym hotfixie
- Opis: po D-065 pracownik może SAM dodać sobie nieobowiązkowy kurs z katalogu (`POST /courses/:id/self-assign`), ale
  wciąż nie ma żadnego sposobu, żeby `ORG_ADMIN` przypisał kurs komuś INNEMU - jedyny twórca `CourseAssignment` poza
  self-assign to `TrackingService.assignFollowUpCourse` (automatyczne, po symulacji phishingowej, jeden pracownik na
  raz). To jest funkcja SPRZEDAŻOWA (szkolenia obowiązkowe dla wybranych osób/działu/całej firmy), nie dodatek -
  priorytet P1, przed publicznym startem.
- Akceptacja: `ORG_ADMIN` wybiera kurs z katalogu i grupę odbiorców (osoba/dział/cała organizacja), ustawia
  `mandatory` (domyślnie z `course.mandatory` - D-065 pkt 4) i `dueDate`; endpoint tworzy `CourseAssignment` masowo w
  JEDNEJ organizacji (żaden nowy wyjątek od Zasady nr 1); test izolacji A/B; UI w panelu admina.

### B-090 `--check --remote` dla narracji (audio) - dziś tylko `--assets` ma prawdziwą weryfikację magazynu
- Etykiety: `P3`, `tech-debt`, `mod:import` · Źródło: D-068 (świadome zawężenie zakresu, "Mały PR"), code review
- Opis: D-068 dodał `--check --remote` (HEAD w prawdziwym magazynie, nie tylko porównanie lokalnego pliku z
  `assets.lock.json`) WYŁĄCZNIE dla `--assets`; `parseArguments` w `tts.ts` jawnie odrzuca `--remote` bez `--assets`
  błędem "dziś wspierane wyłącznie razem z --assets", żeby nie dawać fałszywego poczucia sprawdzenia magazynu.
  `runPipeline`'s `checkOffline` (`pipeline.ts`, narracja/audio) ma DOKŁADNIE tę samą lukę co `--assets --check` miało
  przed D-068 - `audio.lock.json` może "kłamać" (opisywać publikację, której magazyn faktycznie nie potwierdza) i
  `--check` narracji tego nie wykryje.
- Akceptacja: `checkOffline` w `pipeline.ts` dostaje ten sam parametr `store: ObjectStore | null` co `checkAssets`
  (HEAD każdego wpisu `audio.lock.json`/sidecara, gdy `store` nie jest `null`); `parseArguments` zdejmuje warunek
  "wyłącznie z --assets"; testy analogiczne do `assets.test.ts`'s `describe('--check --remote...')`.

### ~~B-091 "Rozpocznij od nowa" - powtórka własnego, ukończonego/nieobowiązkowego przypisania~~ - ROZWIĄZANE (D-069)
- Etykiety: `P2`, `feature`, `mod:kursy` · Źródło: zgłoszone przez właściciela produktu przy okazji ręcznego resetu
  przypisania modułu 1 (SQL na VPS), D-065
- Opis: dziś jedyny sposób przejść kurs jeszcze raz to ręczny `DELETE` przypisania w bazie - potrzebny przycisk na
  ekranie wyniku ukończonego kursu (WŁASNE przypisanie, tylko gdy `mandatory: false` LUB status `COMPLETED` - nie
  dla trwającego obowiązkowego, tego przypisania nie wolno przerwać w trakcie). Ma ARCHIWIZOWAĆ stare przypisanie
  (nie kasować - zostaje w historii do raportów compliance/dashboardu), nie tworzyć go od zera przez `DELETE`, i
  przypiąć NAJNOWSZĄ wersję kursu (kurs mógł się zmienić od pierwszego podejścia). Do zrobienia razem z B-089 (oba
  dotykają tworzenia `CourseAssignment` poza self-assign, sensowne zaprojektować wspólnie).
- **Uwaga projektowa (sprawdzone w kodzie przy okazji SQL-a wyżej):** `GamificationService.awardCourseCompletion`
  NIE wie nic o `courseId` - każde ukończenie kursu (w tym POWTÓRZONE) dolicza `COURSE_COMPLETION_XP` (+ ewentualny
  bonus za 100%) PONOWNIE do `User.xp`. Odznaki (`UserBadge`, `@@unique([userId, badgeId])`) są bezpieczne
  (`tryUnlockBadge` łapie naruszenie unikalności i cicho pomija - zero duplikatów, zero podwójnego XP z odznaki), ale
  sama flaga ukończenia kursu NIE jest odznaką i XP z samego ukończenia zawsze się dolicza. Decyzja do podjęcia razem
  z tym zadaniem: czy "Rozpocznij od nowa" ma dawać XP ponownie (jak dziś przy ręcznym resetowaniu w bazie), czy
  archiwizowane/powtórzone przypisanie ma być wykluczone z przyznawania XP (wymaga oznaczenia przypisania jako
  "powtórka" i sprawdzenia tego w `awardCourseCompletion`, którego dziś nie ma).
- Akceptacja: przycisk widoczny wyłącznie dla WŁASNEGO przypisania z `mandatory: false` lub status `COMPLETED`;
  stare przypisanie trafia do archiwum (nowe pole/status, nie `DELETE` - historia dla raportów zostaje); nowe
  przypisanie wskazuje NAJNOWSZĄ `CourseVersion` kursu; test izolacji A/B; jawna decyzja produktowa o XP (patrz
  uwaga projektowa wyżej) zapisana w `docs/decisions.md` przed implementacją.
- **Rozwiązane (D-069, gałąź `feat/course-restart`):** zakres zawężony przez właściciela produktu do WYŁĄCZNIE
  `status: COMPLETED` (bez wariantu "nieukończony, nieobowiązkowy" z opisu wyżej - trwającego przypisania, nawet
  nieobowiązkowego, restart nie przerywa). Decyzja o XP (uwaga projektowa wyżej): "jak dziś przy ręcznym
  resetowaniu w bazie" - restart NIE wyklucza powtórzonego ukończenia z przyznawania XP (żadne nowe oznaczenie
  "powtórka" w `awardCourseCompletion`); to świadomie zaakceptowany, udokumentowany w D-069 kompromis, nie
  przeoczenie.

### B-092 `scripts/content/src/tts.test.ts` - test "--assets --check --remote bez konfiguracji" kruchy względem lokalnego `.env.local`
- Etykiety: `P3`, `tech-debt`, `mod:import` · Źródło: code review PR `feat/player-polish` (D-070)
- Opis: test zakłada BRAK konfiguracji R2 (`R2_ENDPOINT` itd.) w środowisku, żeby dostać oczekiwany komunikat błędu z
  nazwami brakujących zmiennych; u developera z prawdziwym, skonfigurowanym `.env.local` (potrzebnym do realnych
  przebiegów `scripts/content` z ElevenLabs/R2) test dostaje inny błąd ("Brak pliku module.json") i failuje - nie z
  powodu regresji w kodzie, tylko dlatego że sekret akurat jest obecny lokalnie. Sieć w testach jest i tak
  zablokowana na poziomie `vitest.setup.ts` (D-060), więc nic realnie się nie łączy - to czysto kwestia tego, co
  test widzi jako "skonfigurowane".
- Akceptacja: test jawnie przesłania `R2_*` pustymi/nieprawidłowymi wartościami (albo w inny sposób symuluje "brak
  konfiguracji" niezależnie od realnego `.env.local` na dysku developera), zamiast polegać na nieobecności sekretu.
- **Podpunkt (2026-09-24, znalezione przy aktualizacji `scripts/e2e-module-01.mjs`/`screenshot-module.mjs`/
  `e2e-registration.mjs` po feedbacku z produkcji PR #32):** `scripts/e2e-registration.mjs` (linie ~526-568, blok
  SCENE_HOTSPOTS/DIALOGUE fixtury "śledztwo") klika/sprawdza przycisk `Kontynuuj` - wygląda na pozostałość sprzed
  D-070 ("jeden Dalej" w pasku powłoki zamiast osobnego przycisku ukończenia w bloku). Nie sprawdzone, czy skrypt
  faktycznie dziś przechodzi (lokalny Postgres/Redis nie działają - ten sam powód, dla którego żaden z tych trzech
  skryptów nie został uruchomiony przy tamtej aktualizacji), więc nie wiadomo, czy to martwy kod, czy realna regresja
  od D-070. Nie naprawione w tamtym PR - poza jego zakresem (feedback dotyczył wyłącznie SCENE_HOTSPOTS/EMAIL_ANALYSIS
  w module 1, nie tej fixtury).

### B-093 `--assets` może zdesynchronizować `module.json` i `assets.lock.json` (dwa osobne zapisy, nie jedna operacja)
- Etykiety: `P2`, `bug`, `mod:import` · Źródło: znalezione przy publikacji `biuro-anny.svg` (PR `feat/hotspot-media`,
  feedback z produkcji po PR #32) - `--assets --check` zgłosił `"biuro-anny#image: pole w module.json nie wskazuje
  na opublikowany zasob z assets.lock.json."` mimo że `assets.lock.json` miał poprawny, świeżo opublikowany wpis.
- Opis: `runAssetsPipeline` (`scripts/content/src/assets.ts`) na końcu przebiegu zapisuje `module.json` i
  `assets.lock.json` DWOMA OSOBNYMI `writeIfChanged` (`io.ts`), nie jedną operacją - mimo że mają reprezentować
  jeden spójny stan publikacji (D-068: `assets.lock.json` to źródło prawdy WYŁĄCZNIE po potwierdzonym zapisie w
  magazynie). Crash/przerwanie MIĘDZY tymi dwoma zapisami (albo ręczna edycja/cofnięcie jednego pliku bez drugiego -
  dokładnie tak powstał ten stan przy tej publikacji) zostawia je niespójne: lock ma NOWY klucz dla danego zasobu,
  ale pole w `module.json` wciąż wskazuje na STARY (zasób zmieniony, wcześniej opublikowany pod innym kluczem).
  Dzisiejszy `resolveOriginal()` nie wykrywa tej desynchronizacji jako takiej - niepasujące pole `module.json`
  traktuje jak NIEOPUBLIKOWANĄ nazwę pliku źródłowego (to normalna ścieżka dla nowego, jeszcze nieopublikowanego
  zasobu), więc `readSource` szuka pliku o nazwie literalnie równej starej, już zahaszowanej ścieżce (np.
  `assets/wyludzone-haslo/scenes/biuro-anny.0177a2e4.svg`) w katalogu `assets/` - taki plik nie istnieje (prawdziwe
  źródło to `scenes/biuro-anny.svg`), więc rzuca mylący błąd "Zasób ... nie istnieje w katalogu assets/ modułu.",
  łatwy do odczytania jako "brakuje pliku źródłowego SVG", podczas gdy prawdziwy problem to nieaktualne pole w
  `module.json`. Reprodukcja (test `scripts/content/src/assets.test.ts`, `it.fails('B-093: ...')`, dodany w tym PR
  jako dokumentacja błędu - dziś celowo nie przechodzi, `it.fails` utrzymuje CI zielone): dwie kolejne, normalne
  publikacje tego samego zasobu pod dwiema różnymi treściami dają spójne pary (module.json, lock) na hashA i potem
  hashB; ręczne cofnięcie WYŁĄCZNIE pola `module.json` do klucza hashA (lock zostaje na hashB) symuluje crash
  między zapisami; trzeci przebieg `--assets` (bez żadnej nowej zmiany pliku źródłowego) dziś rzuca błąd zamiast się
  z tego naprawić.
- Akceptacja: kolejny `--assets` po takiej desynchronizacji NIE rzuca mylącego błędu o brakującym zasobie źródłowym.
  Minimalny wariant: `resolveOriginal()`/`runAssetsPipeline` rozpoznaje ten przypadek (pole `module.json` nie zgadza
  się z `entry.key`, ale `ref.id` JEST w locku) i albo się samo naprawia (nadpisuje pole w `module.json` kluczem z
  locka, skoro lock jest źródłem prawdy - D-068), albo rzuca jasny, odróżnialny komunikat wskazujący na desynchronizację
  między `module.json` i `assets.lock.json`, nie na brakujący plik źródłowy. Rozważyć też: jeden atomowy zapis obu
  plików (np. tymczasowe pliki + rename obu przed potwierdzeniem sukcesu) zamiast dwóch niezależnych
  `writeIfChanged`, żeby crash między nimi był strukturalnie niemożliwy, nie tylko wykrywalny post factum. Test z
  tego PR-u (`it.fails`) zamieniony na zwykłą asercję (bez `.fails`) i przechodzi.
- **Pokrewne (2026-09-24, zgłoszenie produkcyjne "audio nie gra, 0:00/0:00" - `feat/scene-overlay-fix`):** sprawdzone
  w kodzie - `media-src` w CSP już zawiera `CONTENT_BASE_URL` (`security-headers.ts:62`, test
  `security-headers.test.ts:59`) i `runAssetsPipeline` już mapuje `mp3` → `audio/mpeg` na `PUT` (`assets.ts:44,239`,
  test `r2.test.ts:53-67`) - żadne z tych dwóch podejrzeń nie jest dziś błędem w kodzie. Realne ryzyko tej samej klasy
  co powyżej: `store.head(key)` (`assets.ts:236`) pomija `PUT` (a więc i `ContentType`) dla KAŻDEGO klucza, który już
  istnieje w magazynie - jeśli obiekt trafił do R2 pod danym kluczem przed poprawką/wdrożeniem `Content-Type` (albo
  wgrany poza tym skryptem), kolejne `--assets` nigdy nie naprawi jego metadanych, bo `HEAD` się powiedzie. Nie
  potwierdzone bez dostępu do produkcji - do sprawdzenia: rzeczywisty nagłówek `Content-Type` zwracany dziś przez
  `content.unfooly.com` dla `assets/wyludzone-haslo/audio/poczta-glosowa.513da5fc.mp3` (DevTools/`curl -I`) i czy
  `CONTENT_BASE_URL` był ustawiony w env `apps/web` w momencie obserwacji. Jeśli metadane są faktycznie złe: naprawa
  to ręczny re-upload tego jednego obiektu (albo rozszerzenie naprawy z akceptacji wyżej o wymuszony `PUT` metadanych
  przy niezgodności, nie tylko o pole `module.json`).

### B-094 Przypisania NOT_STARTED/IN_PROGRESS przy bloku 0 mają się automatycznie przepinać na najnowszą wersję kursu przy imporcie
- Etykiety: `P2`, `feature`, `mod:kursy` · Źródło: zgłoszone przez właściciela produktu
- Opis: dziś `content-import` (`apps/api/src/scripts/content-import.ts`) po utworzeniu nowego `CourseVersion` (linie
  ~102-105, `tx.courseVersion.createMany`) NIE dotyka istniejących `CourseAssignment` - przypisanie pina się do
  wersji dopiero przy pierwszym `/start` (`CourseAssignment.courseVersionId`, nullable - "Wersja treści, na której
  pracownik zaczął kurs (null = jeszcze nie przypięta: pierwszy /start przypina)", `schema.prisma:980`), więc
  przypisania `NOT_STARTED` z `courseVersionId: null` i tak dostają NAJNOWSZĄ wersję automatycznie przy pierwszym
  starcie - to już działa. Realny brakujący przypadek to `IN_PROGRESS` z `currentBlockIndex = 0` (użytkownik
  zawołał `/start`, `courseVersionId` jest już przypięte, ale nie zdążył ukończyć nawet pierwszego bloku, czyli
  praktycznie nic z treści starej wersji nie widział) - dla takich przypisań `content-import` powinien nadpisać
  `courseVersionId` na nowo utworzoną wersję. Przypisania dalej niż blok 0 (choćby jeden ukończony blok) i
  `COMPLETED` zostają na swojej wersji bez zmian - to jest już bieżące, zamierzone zachowanie
  (`CLAUDE.md`/"Silnik szkoleń": "Treść jest wersjonowana i niemutowalna... zmiana treści = nowa wersja, przypisanie
  zostaje na swojej [wersji]") i to zachowanie NIE ma się zmieniać dla tych przypadków.
- **Uwaga projektowa:** `CourseAssignment` ma RLS po `organizationId` (Zasada nr 1) - `courses`/`course_versions` są
  globalne bez RLS (komentarz w `content-import.ts:13`), ale sam `UPDATE` przypisań musi iść przez bezpieczny wzorzec
  wielotenantowy (np. pętla `runInOrgContext` po organizacjach, które mają aktywne przypisania tego kursu, albo nowy,
  jawnie opisany i uzasadniony wyjątek w `TenantPrismaService`, zgodnie z listą wyjątków w `CLAUDE.md`) - `content-
  import` dziś pisze wyłącznie do tabel globalnych, więc to będzie pierwszy zapis do danych klienckich w tym skrypcie
  i wymaga jawnej decyzji, nie automatycznego dopisania.
- Akceptacja: po imporcie nowej wersji kursu `UPDATE` obejmuje WYŁĄCZNIE przypisania `status IN (NOT_STARTED,
  IN_PROGRESS)` AND `currentBlockIndex = 0` (dla `IN_PROGRESS`; `NOT_STARTED` i tak ma `courseVersionId: null` -
  weryfikacja, czy w ogóle trzeba je dotykać, czy tylko potwierdzić że zostają `null`) tego konkretnego `courseId`;
  przypisania z `currentBlockIndex > 0` i `status = COMPLETED` niezmienione; test w `apps/api` (happy path + granica
  `currentBlockIndex = 0` vs `1` + test izolacji A/B, jeśli `UPDATE` dotyka więcej niż jednej organizacji na raz).

### B-095 `CoursePlayer.exploratory.test.tsx` - test "mail: odpowiedź { selected }..." raz nie przeszedł w CI (na tym samym commicie zielony lokalnie i po ponownym uruchomieniu CI)
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: CI PR #35 (`docs/backlog-course-version-repin` - PR WYŁĄCZNIE
  dokumentacyjny, `docs/backlog-issues.md`, zero zmian w kodzie - test nie ma nic wspólnego z treścią PR-a)
- Opis: `lint + testy` (job `apps/web`) padł na teście `CoursePlayer.exploratory.test.tsx > ... > mail: odpowiedź
  { selected }, wynik w bloku, notatki z serwera od razu w notatniku, a po "Wstecz" wybór gracza i rozstrzygnięcie`
  (1 z 1282 testów). Lokalnie (ten sam commit, w izolacji i w całym pliku) przechodzi za każdym razem; ponowne
  uruchomienie TEGO SAMEGO joba CI (`gh run rerun --failed`) też przeszło bez zmian w kodzie - jednorazowy flake,
  nie deterministyczna regresja. Podejrzany fragment (niepotwierdzony, tylko obserwacja z lektury testu): test robi
  dwa `fireEvent.click` pod rząd bez `await`/`waitFor` między nimi (klik "Dalej" -> od razu klik "Wstecz" -> odczyt
  `review-block`, linie ~448-451) - jeśli przejście bloku ma cokolwiek asynchronicznego w drodze (efekt, mikrotaska),
  różnica w harmonogramowaniu między lokalną maszyną a runnerem CI (mniej rdzeni - CLAUDE.md reguła 8) mogłaby to
  ujawnić sporadycznie. Nie zweryfikowane debugerem/wielokrotnym powtórzeniem w CI - może się już nie powtórzyć.
- Akceptacja: jeśli to się powtórzy - dodać `await waitFor(...)` (albo `act()`) między klikiem "Dalej" a "Wstecz" w
  tym teście i sprawdzić, czy problem znika; jeśli NIE powtórzy się w rozsądnym oknie (np. kilka kolejnych PR-ów), ten
  wpis można zamknąć jako jednorazowy szum infrastruktury CI.
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: D-051
- Opis: usunięcie kursu z przypisaniami jest już zablokowane (RESTRICT), ale nie ma sposobu na wycofanie kursu z katalogu bez usuwania.
- Akceptacja: pole/status archiwizacji, ukrycie zarchiwizowanych przy nowych przypisaniach, istniejące przypisania dokańczalne.
