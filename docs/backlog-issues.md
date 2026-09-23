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
  `V4_FEATURES`). WCIĄŻ DO ZROBIENIA (ta sama gałąź, kolejne commity): komponent `SceneHotspotsBlock` renderujący każdy
  wariant + nawigację "Dalej" dla `action:'next'`, `scripts/content --assets` dla mp3, `apps/api`'s `evaluate.ts`/
  `client-view.ts` liczące spłaszczone id (dziś widzą TYLKO zewnętrzne hotspoty - zagnieżdżone dowody nie są jeszcze
  liczone po stronie serwera, mimo że schemat już je dopuszcza), treść modułu 1 (nowe grafiki od właściciela).

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
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: D-051
- Opis: usunięcie kursu z przypisaniami jest już zablokowane (RESTRICT), ale nie ma sposobu na wycofanie kursu z katalogu bez usuwania.
- Akceptacja: pole/status archiwizacji, ukrycie zarchiwizowanych przy nowych przypisaniach, istniejące przypisania dokańczalne.
