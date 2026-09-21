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
- Etykiety: `P2`, `security`, `feature`, `decision-needed`, `mod:web` · Źródło: D-053 (CSP), decyzja właściciela 2026-09-21
- Opis: awatar z dowolnego adresu `https` (`<img src={avatarUrl}>`) nie mieści się w `img-src 'self' data: <CONTENT_BASE_URL>` (CSP z D-053), więc obrazek
  się nie załaduje; do czasu decyzji UI pokazuje inicjały (fallback przy błędzie ładowania). Nie poszerzamy `img-src` o `https:`.
- Akceptacja: decyzja (tylko presety albo własny upload do zasobów z `CONTENT_BASE_URL`), walidacja w API (odrzucenie zewnętrznych URL-i), migracja
  istniejących awatarów z URL-a (na preset/inicjały), test A/B, zaktualizowany `AvatarPickerModal`.

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
- Etykiety: `P2`, `security`, `mod:web` · Źródło: audyt B-080, decyzja właściciela 2026-09-21
- Opis: trasy bez sesji (`auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`, `auth/verify-email`, `auth/claim-registration`, `auth/resend-verification`, `demo-request`, `t/[token]/view|submit`) nie mają sesji do nadużycia przez CSRF, ale zostają: login CSRF (wymuszenie logowania na cudze konto), spam i limity (throttling po stronie API vs BFF), ocena, które trasy mają wymagać własnego `Origin`, a które muszą działać z zewnątrz (`t/*` to publiczne linki symulacji).
- Akceptacja: decyzja per trasa, testy, po pilocie. Ciasteczko sesji ma `SameSite=Lax` (`apps/web/src/lib/auth-cookies.ts`).

### B-080 Kontrola same-origin w pozostałych trasach BFF zmieniających stan
- Etykiety: `P1`, `security`, `mod:web` · Źródło: przegląd bezpieczeństwa PR 2 (trasa `/attempt`), decyzja właściciela 2026-09-21
- Opis: `proxyAuthenticated` (`apps/web/src/lib/bff.ts`) odrzuca żądania zmieniające stan bez własnego `Origin` / `Sec-Fetch-Site: same-origin` (obrona przed CSRF także z sąsiedniej subdomeny, gdzie `SameSite=Lax` nie chroni). W PR 2 objęto trasy kursów (`/api/courses/[courseId]/progress`, `.../blocks/[blockId]/attempt`). Audyt tras `POST/PATCH/DELETE` w `apps/web/src/app/api` pokazał trasy UWIERZYTELNIONE bez tej kontroli (własne `fetch` z ciasteczkiem):
  `users` (POST), `users/[id]` (PATCH/DELETE), `users/[id]/resend-invite`, `users/import/preview`, `users/import/[id]` (DELETE), `users/import/[id]/confirm`, `users/import/[id]/stop`, `users/me/avatar`, `users/me/preferences`, `threat-reports/inbox/[id]/notes`, `threat-reports/inbox/[id]/status`.
  Trasy publiczne bez sesji (`auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`, `auth/verify-email`, `auth/claim-registration`, `auth/resend-verification`, `demo-request`, `t/[token]/view|submit`) nie mają sesji do nadużycia; ich ochrona to osobny temat (login CSRF, spam), do oceny osobno.
- Akceptacja: każda trasa z listy przez `proxyAuthenticated` (albo z `isSameOriginRequest()`), ciało z allowlisty, test „Origin obcego hosta → 403” i „bez Origin i Sec-Fetch-Site → 403, z `Sec-Fetch-Site: same-origin` → przechodzi” (ta sama reguła co w pozostałych trasach, bez drugiej).

### B-071 Archiwizacja kursów zamiast usuwania (dokończenie B-032)
- Etykiety: `P3`, `tech-debt`, `mod:kursy` · Źródło: D-051
- Opis: usunięcie kursu z przypisaniami jest już zablokowane (RESTRICT), ale nie ma sposobu na wycofanie kursu z katalogu bez usuwania.
- Akceptacja: pole/status archiwizacji, ukrycie zarchiwizowanych przy nowych przypisaniach, istniejące przypisania dokańczalne.
