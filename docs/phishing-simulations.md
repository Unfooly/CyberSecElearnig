# Symulacje phishingowe - kampanie i wysyłka

Dokument opisuje moduł `apps/api/src/phishing/`. Rozdziały o śledzeniu kliknięć i wynikach dochodzą w kolejnych
etapach (commity 4 i 5); tu: szablony, transport, kampanie, planowanie i semantyka wysyłki.

## Przepływ kampanii (jednorazowej)

1. `POST /phishing/campaigns` (tylko `ORG_ADMIN`, organizacja `ACTIVE`): nazwa, szablon, grono (wszyscy / działy /
   wskazane osoby), okno wysyłki, potwierdzenie ostrzeżenia z kreatora (`acknowledged: true`).
2. Serwis w jednej transakcji tworzy kampanię z **kopią (snapshotem) szablonu** i wiersze odbiorców. Momenty wysyłki
   są jednostajnie losowe w oknie (`planSendTimes`), a przed przypisaniem odbiorcom **tasowane kryptograficznie**
   (`shuffled`) - kolejność wysyłki nie wynika z kolejności założenia kont. Odbiorcy to **aktywni** pracownicy
   organizacji (zaproszeni, którzy nie ustawili hasła, nie są odbiorcami). Limit: 5000 odbiorców i 10 aktywnych kampanii.
   Tworzenie jest serializowane blokadą doradczą organizacji (limit nie do obejścia równoległymi żądaniami), a
   identyczna kampania (nazwa, szablon, grono, okno) utworzona w ciągu 2 min jest odrzucana (`DUPLICATE_CAMPAIGN`) -
   podwójne kliknięcie nie wyśle drugiego phishingu. Endpoint ma limit 20 żądań/min.
3. Po zatwierdzeniu transakcji do BullMQ trafia jedno **opóźnione zadanie na odbiorcę** (`jobId = phishing-send_<id>`,
   `addBulk` po 500).
4. Worker wywołuje `CampaignSenderService.sendOne`. Zadanie uzgadniające (co 5 min) odtwarza zgubione zadania i domyka
   wiszące zajęcia.
5. `POST /phishing/campaigns/:id/cancel` zatrzymuje kampanię (patrz niżej).

Stany kampanii: `SCHEDULED` -> `RUNNING` (pierwsza zajęta wiadomość) -> `COMPLETED` (nikt nie czeka na wynik) albo
`CANCELLED`.

## Semantyka wysyłki: "co najwyżej raz"

Duplikat maila phishingowego jest gorszy niż brak maila, dlatego wysyłka jednego odbiorcy działa tak:

1. **Zajęcie (atomowe).** Transakcja blokuje wiersz kampanii (`FOR NO KEY UPDATE`), potem `updateMany` z warunkiem
   `claimedAt IS NULL AND sentAt IS NULL AND failedAt IS NULL`, statusem kampanii `SCHEDULED/RUNNING`, oknem oraz
   `scheduledAt <= teraz + 1 min` ustawia `claimedAt` i `tokenHash`. Tylko jeden wykonawca dostaje `count = 1`;
   równoległe i powtórne zadania nic nie wysyłają, a zadanie uruchomione za wcześnie (błędne opóźnienie, ingerencja w
   Redisa) niczego nie wyśle - odbiorcę odtworzy zadanie uzgadniające po terminie. Zajęcie i anulowanie kampanii
   serializuje blokada wiersza kampanii: wygrywa to, co zatwierdzi się pierwsze. Odbiorca musi być nadal `ACTIVE`
   (inaczej `RECIPIENT_REMOVED`). Tuż przed wysyłką status kampanii jest sprawdzany jeszcze raz.
2. **Wysyłka** poza transakcją bazy, przez `PhishingMailTransport` (osobny od poczty transakcyjnej).
3. **Wynik:** `sentAt` (dostawca przyjął wiadomość) albo `failedAt` + `failureCode`. Baza wymusza (CHECK), że wynik jest
   jeden, że `failedAt` idzie z `failureCode` i że wysłana wiadomość była wcześniej zajęta.

### Co jest ponawiane, a co nie

Ponawiamy (maks. 3 próby, backoff BullMQ 60 s) **wyłącznie błędy, przy których wiadomo, że wysyłka nie nastąpiła**:
błąd połączenia przed wysłaniem (DNS, odmowa połączenia, TLS, uwierzytelnienie, SMTP `ECONNECTION` tylko w fazie
łączenia: komendy CONN/EHLO/STARTTLS/AUTH) oraz HTTP 429 (limit - dostawca odrzucił żądanie). Wtedy zajęcie jest
zwalniane, a błąd oddawany BullMQ.

**Timeout NIE jest ponawiany.** Dostawca mógł już przyjąć wiadomość, więc odbiorca dostaje `failedAt` z kodem
`TIMEOUT_UNKNOWN`. To samo dotyczy zerwanego połączenia po wysłaniu (w tym SMTP `ECONNECTION` po DATA) i
nieoczekiwanych błędów (`RESULT_UNKNOWN`), zajęcia bez wyniku po awarii procesu (`INTERRUPTED_UNKNOWN`, domykane przez
zadanie uzgadniające po 10 min) oraz **każdej odpowiedzi HTTP 5xx** dostawcy (`HTTP_5xx`): bramka mogła zwrócić 502/504
po przekazaniu wiadomości, więc 5xx nie dowodzi, że nic nie wyszło.

W szczegółach kampanii takie wpisy są liczone osobno jako **niepewne** (`counts.uncertain`; w `failures` z flagą
`uncertain: true`). Pozostałe nieudane (odrzucony adres `HTTP_422`, `CANCELLED`, `WINDOW_EXPIRED`, `RECIPIENT_REMOVED`,
`COMPOSE_FAILED`) to pewne porażki - nic nie wyszło. Kody nie zawierają danych osobowych.

Konsekwencja dla wyników: "niepewne" mogły dostać wiadomość, ale nie mamy tokenu potwierdzonego wysyłką - w
raportach traktujemy je osobno, nie jako wysłane.

## Koniec okna i anulowanie

- Zadanie może ruszyć do 15 min po końcu okna (opóźnienie workera); później odbiorca dostaje `WINDOW_EXPIRED` i nie
  dostaje maila.
- Anulowanie: kampania -> `CANCELLED`, niezajęci odbiorcy -> `failedAt = CANCELLED`, zadania usuwane z kolejki.
  Wiadomość zajęta PRZED zatwierdzeniem anulowania dokończy się (nie da się jej cofnąć); zajęcie po anulowaniu jest
  niemożliwe (blokada wiersza kampanii + warunek statusu), a sprawdzenie tuż przed wysyłką zatrzymuje także wiadomości
  zajęte tuż przed anulowaniem, jeśli jeszcze nie wyszły.
- Usunięcie pracownika: wiersz wyniku zostaje (`userId` zerowane, nazwa działu to snapshot). Adresu e-mail w wynikach
  nie kopiujemy - wysyłka czyta go z konta w chwili wysyłki (usunięty pracownik: `RECIPIENT_REMOVED`).

## Zadanie uzgadniające (`phishing-campaign-reconcile`, co 5 min, UTC)

Siatka bezpieczeństwa, gdy Redis został wyczyszczony albo był niedostępny przy starcie kampanii:

- odbiorca po terminie (> 2 min) bez zajęcia dostaje zadanie; dodanie jest deduplikowane po `jobId`, ale
  zakończone/nieudane zadanie tego odbiorcy (BullMQ je przechowuje) jest przed dodaniem usuwane (`replaceFinished`),
  inaczej dedup po cichu blokowałby odtworzenie,
- zajęcie bez wyniku starsze niż 10 min -> `INTERRUPTED_UNKNOWN` (bez ponawiania),
- po końcu okna + 15 min niewysłani -> `WINDOW_EXPIRED`,
- kampania bez oczekujących -> `COMPLETED`,
- kampanie anulowane w ostatnich 7 dniach: wiszący odbiorcy (zwolnione claimy po ponowieniu) -> `CANCELLED`, stare
  zajęcia -> `INTERRUPTED_UNKNOWN` (licznik "oczekuje" schodzi do zera).

Lista kampanii do uzgodnienia (wszystkich organizacji, stronami po id) to jedyne zapytanie międzyorganizacyjne: bypass RLS
w polityce SELECT `phishing_campaigns`, wyłącznie przez `TenantPrismaService.listCampaignsToReconcile` (wynik to tylko id i
organizationId). Wynik uzgadniania danej kampanii zapisuje się już w kontekście jej organizacji.

## Odbiorcy: podstawa i zabezpieczenie przed nadużyciem

**Decyzja:** NIE ograniczamy adresów odbiorców do zweryfikowanej domeny organizacji - firmy mają kontraktorów i
współpracowników na zewnętrznych adresach (np. Gmail).

**Podstawa zabezpieczenia:** odbiorcą jest wyłącznie konto w stanie `ACTIVE`, czyli takie, które użytkownik sam aktywował
linkiem z maila (ustawienie hasła). Aktywacja potwierdza, że osoba jest świadomym członkiem tej organizacji; admin nie może
więc "wyphishować" osoby trzeciej z naszej domeny samym dodaniem jej adresu (konto `INVITED` nie jest odbiorcą, a
`sendOne` sprawdza `ACTIVE` w chwili wysyłki). Ryzyko szczątkowe: admin kontroluje adres, który sam aktywował.

## Dobowy limit wysyłek

Globalny limit organizacji: **2 x `seatsLimit` wysyłek na DOWOLNE kroczące 24 h** (`DAILY_SEND_LIMIT_FACTOR`), liczony po
**zaplanowanych momentach wysyłki** (`scheduledAt`), nie po dacie utworzenia: kampanie tworzone w różne dni z tym samym
oknem wysyłki sumują się w dniu wysyłki. Przy uruchamianiu kampanii, w transakcji pod blokadą organizacji, sprawdzamy
(okno przesuwne, `peakInAnyWindow`), czy po dołożeniu momentów nowej kampanii jakiekolwiek 24 h zawiera więcej wysyłek niż
limit; inaczej `409 DAILY_SEND_LIMIT` z komunikatem (limit, szczyt po dołożeniu, już zaplanowane). Odbiorcy anulowani
przed wysyłką nie zużywają limitu; świeżo anulowana kampania zużywa go do domknięcia odbiorców (konserwatywnie).
Dopracowane limity - backlog.

## Śledzenie kliknięć i strona lądowania

Link w mailu prowadzi do `<PHISHING_LANDING_BASE_URL>/t/<token>` (strona w `apps/web`, publiczna, bez cookie, `noindex`,
bez marek). Token to 32 losowe bajty (base64url, 43 znaki); w bazie jest tylko jego SHA-256.

- **`GET /t/<token>` (strona) niczego nie zalicza** i nie woła API - pobierają go skanery linków w skrzynkach. Wynik nie
  zależy od tokenu (każda wartość daje tę samą stronę).
- **`POST /api/t/<token>/view`** (BFF -> `POST /t/:token/view` w API) wywołuje JS strony po 2,5 s widoczności albo przy
  pierwszej interakcji. Zapisuje `clickedAt` (raz) i przypisuje kurs uzupełniający. To ograniczenie, nie gwarancja:
  skaner z pełnym JS i oczekiwaniem może to obejść; wyniki są szacunkiem.
- **`POST .../submit`** zapisuje `submittedAt` (i `clickedAt`, gdy brakowało). **Ciało żądania jest ignorowane**: strona
  nie wysyła wartości pól, BFF ich nie czyta, API nie deklaruje `@Body`, a nic w tej ścieżce nie loguje. Miarą jest
  wyłącznie fakt wysłania formularza. Także przy bezpośrednim wywołaniu API z uszkodzonym ciałem: parser ciała jest
  własny (`common/body-parsing.ts`, aplikacja tworzona z `bodyParser: false`) z middleware błędów, który odpowiada
  stałym `Nieprawidłowe żądanie.` - domyślna obsługa zwracałaby i logowała `error.message` z `JSON.parse` zawierający
  FRAGMENT ciała. Limit ciała: 100 kB.
- **Odpowiedź publiczna** to zawsze `200 { lessonHtml }` - treść lekcji kampanii dla tokenu ważnego, lekcja domyślna dla
  nieznanego, źle sformatowanego, wygasłego (90 dni od zajęcia) i niezajętego. Bez danych osobowych, nazwy kampanii i
  organizacji. Przy 256 bitach entropii i limicie 120 żądań/min na adres (osobno dla `view` i `submit`; IPv6 liczone po
  prefiksie /64) zgadywanie tokenów jest nierealne; różnica czasu odpowiedzi nie daje przewagi. Limit jest wyższy niż
  typowy, bo pracownicy jednej firmy często wychodzą przez wspólny adres NAT i otwierają pocztę o tej samej porze; przekroczenie
  daje 429, a strona pokazuje wtedy lekcję domyślną BEZ zapisu kliknięcia (zaniżony wynik, bez sygnału dla operatora).
  Twardy limit na brzegu (WAF Cloudflare) i `TRUST_PROXY=true` są warunkami startu (`docs/deploy-test.md`).
- **Token w adresie URL** trafia jawnie do logów dostępowych infrastruktury (Cloudflare, reverse proxy) i historii
  przeglądarki: ktoś z dostępem do tych logów może zaliczyć cudze kliknięcie przez 90 dni. Logi dostępowe traktujemy jako
  dane wrażliwe. Baza trzyma tylko hash, strona nie ładuje zasobów zewnętrznych, a `Referrer-Policy: no-referrer`, `no-store`
  i `noindex` są ustawione w `next.config.mjs`.
- Token działa także po anulowaniu kampanii i dla odbiorców "niepewnych" (kliknięcie dowodzi, że mail dotarł).
- Lekcja ("To była symulacja") pochodzi ze snapshotu kampanii, jest sanityzowana na wyjściu i pokazywana w `iframe
  sandbox=""`. Wyświetla się po wysłaniu formularza lub kliknięciu "Anuluj".
- **Kurs uzupełniający:** najstarszy kurs z kategorii `PHISHING_SOCIAL_ENGINEERING`, termin 14 dni, idempotentnie (unikat
  `userId + courseId`, istniejące przypisanie zostaje). Użytkownik musi należeć do organizacji odbiorcy (jawny warunek +
  złożone FK `course_assignments -> users(organizationId, id)`). Brak takiego kursu w katalogu = brak przypisania.
- **Wyjątek od Zasady nr 1:** lookup odbiorcy po hashu tokenu (`TenantPrismaService.runTrackingTokenLookup`, wąski select,
  własny sentinel `app.bypass_tracking_lookup` tylko w SELECT - `runCrossOrgQuery` odbiorców nie widzi). Pełna lista
  wyjątków: `CLAUDE.md`.
- Token jest ważny 90 dni od **zajęcia** (`claimedAt`, chwila wysyłki). Kurs uzupełniający dostają tylko konta `ACTIVE`.

## Wyniki i raporty

Trzy poziomy dostępu, egzekwowane w serwisie `PhishingResultsService` (kontroler i UI to tylko pierwsza linia):

1. **Agregaty per dział** (zawsze dostępne): `GET /phishing/results/overview` (90 dni), `.../campaigns/:id/departments` i
   `.../departments.csv`. `ORG_ADMIN` widzi całą organizację, **`DEPARTMENT_MANAGER` wyłącznie własny dział** (dział
   czytany z bazy na każde żądanie, nie z tokenu) jako jeden wiersz, bez sumy organizacji i bez innych działów.
   Wejście agregatora to fakty bez identyfikatorów osób, więc odpowiedź nie może zawierać danych osobowych.
2. **Wyniki osobowe** (kto kliknął): `.../people` i `.../people.csv` - wyłącznie `ORG_ADMIN` i wyłącznie przy włączonej
   fladze organizacji (`phishing_result_settings.personalResultsEnabled`, domyślnie **wyłączona**). **Rola, status (`ACTIVE`) i
   dział wywołującego są czytane z bazy na każde żądanie, nie z tokenu** (zdegradowany albo zdezaktywowany admin traci dostęp od
   razu). Flaga jest czytana z bazy w tej samej transakcji co dane, pod blokadą wiersza (`FOR SHARE`), a jej zmiana bierze
   blokadę doradczą organizacji (równoległe przełączenia się serializują: jedno wygrywa, reszta 409): wyłączenie działa od
   następnego żądania, a żądanie w toku dokończy się z widokiem sprzed zmiany. Wglądy mają limit 30/min (dziennik nie do
   zalania). Bez flagi: `403
   PERSONAL_RESULTS_DISABLED`, bez odczytu danych i bez wpisu audytu. `DEPARTMENT_MANAGER` nigdy ich nie dostaje, także przy
   włączonej fladze. Filtry: wszyscy, nieudani i niepewni (`PROBLEMS`), kliknęli, wysłali formularz, zgłosili wiadomość (`REPORTED`).
3. **Ustawienie flagi i audyt**: `POST /phishing/results/settings/personal-results` (tylko `ORG_ADMIN`). Włączenie wymaga
   uzasadnienia (min. 20 znaków; egzekwuje serwis **i CHECK w bazie**), ustawienie i wpis audytu w jednej transakcji, ta sama
   wartość = 409 (bez dubli). Dziennik `phishing_result_visibility_audit` jest **append-only** dla roli aplikacji
   (`REVOKE UPDATE, DELETE, TRUNCATE`) i zapisuje: `ENABLED`/`DISABLED` (z uzasadnieniem), **każdy wgląd** (`VIEWED`) i **każdy
   eksport CSV** (`EXPORTED`) wraz z kampanią, **zakresem (filtr) i liczbą zwróconych osób** oraz e-mailem aktora (kopia;
   `actorUserId` zerowane po usunięciu konta). Wpis powstaje w tej samej transakcji co odczyt, a dane opuszczają serwis dopiero po
   jej zatwierdzeniu - nie da się ich dostać bez śladu. Endpoint audytu zwraca 200 najnowszych wpisów (bez paginacji).
   `DEPARTMENT_MANAGER` nie dostaje też metadanych całej organizacji: liczba kampanii to `null`, a kampania, w której jego dział
   nie uczestniczył, jest dla niego "nieistniejąca" (404).

### Próg minimalnej liczebności

Wynik grupy z mniej niż **3 osobami z dostarczoną wiadomością** nie jest pokazywany (`MIN_GROUP_SIZE`). Sam próg nie wystarcza
(przy jednej ukrytej grupie jej wartości wynikałyby z różnicy "razem minus reszta"), dlatego grupy poniżej progu są **łączone w
jeden wiersz "Pozostałe działy"**, a gdy i on jest za mały, dokładany jest do niego najmniejszy widoczny dział, aż liczebność
osiągnie próg. W obrębie JEDNEGO widoku każdy opublikowany wiersz dotyczy >= 3 osób, więc żadnej małej grupy nie da się odjąć
od sumy (test losowy w `results-aggregation.spec.ts`). Gdy cała organizacja ma mniej niż 3 dostarczone wiadomości: "za mało
danych", bez liczb (dotyczy też KPI). Manager małego działu widzi "za mało danych".

**Znane, nieusunięte ograniczenie (atak różnicowy między kampaniami).** Ochrona działa per widok. `ORG_ADMIN`, który sam
dobiera odbiorców kampanii, może porównać wyniki kampanii różniących się o małą grupę (np. kampania A = duży dział, kampania B =
duży dział + dział 2-osobowy: różnica sum daje wynik 2 osób), także przez `overview`, KPI i CSV, bez włączania wyników osobowych i
bez wpisu w dzienniku. Wielu kampanii z nakładającymi się zbiorami nie da się wyczerpująco zabezpieczyć samym progiem (kombinacje
liniowe wyników), a reguła "zbiory odbiorców różnią się o 0 albo >= 3 osoby" blokowałaby zwykłe użycie (nowy pracownik między
kampaniami). Ryzyko jest ograniczone, bo: (1) dotyczy wyłącznie `ORG_ADMIN` - `DEPARTMENT_MANAGER` nie tworzy kampanii i widzi tylko
własny dział; (2) ten sam administrator może włączyć wyniki osobowe z uzasadnieniem i audytem, więc atak omija głównie ślad
audytu, nie ujawnia danych, do których nie miałby dostępu; (3) każda kampania zapisuje autora (`createdByEmail`).

**Decyzja (2026-09-20): ryzyko rezydualne ZAAKCEPTOWANE.** Różnicowanie wyników przez własnego administratora organizacji, który i
tak ma audytowaną ścieżkę do danych osobowych, jest przyjętym ryzykiem; próg minimalnej liczebności zostaje na 3. Wymagany wpis w
DPIA (`docs/legal/privacy-policy-checklist.md`, sekcja 8). Dokumenty nie twierdzą, że małej grupy "nie da się odjąć" poza pojedynczym
widokiem. Alternatywy rozważone i odrzucone na teraz: ograniczenie audiencji do "cała organizacja" i całych działów >= 3 osób
(kosztem elastyczności), próg 5 lub zaokrąglanie do przedziałów.

**Backlog (tanie ograniczenie na przyszłość): alert audytowy różnicowania.** Gdy w ciągu 7 dni powstają kampanie tej samej
organizacji o zbiorach odbiorców różniących się o mniej niż 3 osoby (i więcej niż 0), zapisać wpis w dzienniku audytu i pokazać go
w ustawieniach oraz operatorowi (SUPER_ADMIN). Sama różnica 1-2 osób (np. nowy pracownik) jest zwykła, więc alert informuje, a nie blokuje.

Inne kanały, o których warto wiedzieć: przy progu 3 wynik 0% albo 100% w grupie ujawnia zachowanie każdej osoby (dział 3-osobowy
zna własny wynik); liczba dostarczonych w wierszu zależy od nieudanych/niepewnych wysyłek. Rozważany wyższy próg (5) albo
zaokrąglanie do przedziałów.

Definicje: **dostarczono** = przyjęte przez dostawcę (`sentAt`) albo kliknięte albo zgłoszone (kliknięcie i zgłoszenie dowodzą
dostarczenia, także dla odbiorców "niepewnych"); **podatność** = kliknęło / dostarczono; **zgłaszalność** = zgłosiło /
dostarczono; **zgłosiło po kliknięciu** = kliknęło, a `reportedAt` jest późniejsze niż `clickedAt` (zgłoszenie przed
kliknięciem jest zgłoszeniem, ale nie "po kliknięciu"); nieudane i niepewne bez kliknięcia nie wchodzą do mianownika.

### Zgłoszenia w wynikach (moduł zgłoszeń, commit 2/5)

Metryki **"zgłosiło"**, **"w tym po kliknięciu"** i **% zgłosiło** to kolejne liczby TEGO SAMEGO wiersza (te same grupy, ten sam
próg 3 i łączenie małych grup): nie mają własnego progu, a wiersz poniżej progu ukrywa wszystkie metryki naraz. Źródłem jest
wyłącznie `phishing_campaign_recipients.reportedAt` (jedno zgłoszenie na odbiorcę, ustawiane raz), a nie liczba wierszy
`threat_reports` - ponowne zgłoszenie tej samej wiadomości nie zawyża wyniku. Zgłoszenie to **wynik osobowy**: widok osobowy
(`reportedAt`, "po kliknięciu", filtr `REPORTED`) i CSV podlegają tej samej fladze, tej samej roli i temu samemu audytowi co
kliknięcia. Agregaty per dział, CSV agregatów i KPI `phishingReportRate` (dashboard, 90 dni) liczą je tak samo.

**Zgłoszenia a atak różnicowy (K1) i próg 3.** Zgłoszenia nie tworzą nowych granic grup, więc nie pogarszają ochrony per widok
(test losowy sprawdza, że suma opublikowanych wierszy = suma organizacji także dla zgłoszeń). Ryzyko K1 (różnicowanie kampanii
przez ORG_ADMIN) rozciąga się na trzecią metrykę tak samo jak na kliknięcia - jest objęte tą samą zaakceptowaną decyzją. Nowy
kanał, który warto znać: **różnicowanie w czasie**. Zgłoszenia napływają po zakończeniu kampanii (ścieżka po tokenie: bez
ograniczenia w czasie, po nadawcy i temacie: do 30 dni), więc wynik tej samej kampanii zmienia się między dwoma wglądami; wzrost
"zgłosiło" o 1 w grupie >= 3 osób oznacza, że jedna osoba zgłosiła w międzyczasie, a administrator, który wie, kto właśnie zgłosił
(zgłoszenia bywają ogłaszane w zespole), może to przypisać. Dotyczy to też kliknięć, ale zgłoszenia są zwykle dobrowolne, jawne i
opóźnione, więc kanał jest tu szerszy. Bez zmiany progu; ryzyko ograniczone tym, że dotyczy wyłącznie roli, która ma audytowaną
ścieżkę do wyników osobowych. Backlog: ten sam alert audytowy co dla K1 może obejmować gwałtowne różnice między wglądami.

### KPI i eksporty

- **KPI "Podatność na phishing" i "Zgłaszalność phishingowa"** w dashboardzie (`GET /dashboard/overview`): `phishingClickRate`,
  `phishingSubmitRate` i `phishingReportRate` z ostatnich 90 dni dla całej organizacji, z progiem liczebności (`null` = brak
  kampanii albo za mało danych; 0 to wartość, nie brak danych).
- **Eksport dashboardu** (`GET /dashboard/export`) nie zawiera żadnych wyników symulacji - test e2e pilnuje, że przy
  wyłączonej i włączonej fladze plik jest identyczny.
- **CSV**: RFC 4180 z BOM UTF-8, ochrona przed wstrzyknięciem formuł (komórki zaczynające się od `= + - @` tab CR dostają
  apostrof), `Cache-Control: no-store`. Nagłówki pliku są ustawiane dopiero po udanym wygenerowaniu - błąd (np. 403) jest
  zawsze odpowiedzią JSON, nigdy pobieralnym plikiem. BFF w `apps/web` przekazuje błąd API jako JSON.
- **Szczegóły kampanii** (`/dashboard/phishing/campaigns/:id`): agregaty per dział, liczniki nieudanych i "niepewnych"; z
  włączoną flagą także lista osób (ładowana dopiero po jawnym kliknięciu, bo każdy wgląd jest audytowany).

### Zakres UI

Interfejs w `apps/web` obejmuje `ORG_ADMIN` (`/dashboard` wymaga tej roli). Zakres `DEPARTMENT_MANAGER` jest zaimplementowany i
przetestowany w API; osobny ekran kierownika działu to backlog (v2).

## Zgłaszanie podejrzanych wiadomości (moduł zgłoszeń, commit 1/5)

Kod: `apps/api/src/threat-reports/`, tabela `threat_reports` (RLS, `reportedAt` na odbiorcy kampanii), ekran `/report`
(przycisk „Zgłoś podejrzany mail” w Topbarze, każda rola). `POST /threat-reports`: nadawca, temat (wymagane), treść, nagłówki,
komentarz (opcjonalne); czysty tekst (bez znaków sterujących i formatujących Unicode), limity 320/300/20 000/20 000/1000 znaków.
Limit per użytkownik liczony w bazie: **5 zgłoszeń na godzinę i 20 na dobę** (429 `REPORT_RATE_LIMIT`), atomowo wobec żądań
równoległych (kolejka w procesie + blokada doradcza). Organizacja PENDING dostaje 403.

**Dopasowanie do symulacji** - wyłącznie wśród wierszy odbiorców ZGŁASZAJĄCEGO (cudza symulacja nie zmienia niczyjego wyniku):

1. `TOKEN` (jednoznaczne): w wklejonym tekście jest link `/t/<43 znaki>`, którego hash należy do własnego wiersza odbiorcy.
2. `SENDER_SUBJECT`: dokładny adres nadawcy (część lokalna kampanii + `PHISHING_EMAIL_DOMAIN`) **oraz** znormalizowany temat kampanii
   (bez `Re:`/`Fwd:`/`Odp:`/`PD:`, wielkość liter, białe znaki, NFKC) - kampania RUNNING/COMPLETED, wiadomość przyjęta przez dostawcę
   w ostatnich 30 dniach. Sam nadawca albo sam temat **nie** wystarcza; nadawcy bez adresu (samo imię) nie zgadujemy.

Możliwe fałszywe dopasowanie: prawdziwy phishing podszywający się dokładnie pod nasz adres nadawcy (domena chroniona SPF/DKIM/DMARC)
i temat kampanii, którą pracownik faktycznie dostał w ostatnich 30 dniach, zostanie uznany za symulację (brak wpisu w skrzynce
zgłoszeń). Ryzyko małe, dlatego wymagamy obu cech. Fałszywy brak dopasowania (np. pracownik przepisał temat z literówką) daje
zgłoszenie „prawdziwe” - trafi do skrzynki, bez szkody dla wyników (kliknięcia i tak zliczają się osobno).

**Dane:** zgłoszenie dopasowane **nie zapisuje** treści, nagłówków ani komentarza (zostaje temat, nadawca i powiązanie z odbiorcą;
CHECK w bazie). Zgłoszenie prawdziwe: treść, nagłówki, komentarz, nadawca i temat są czyszczone po **90 dniach** (job
`threat-report-retention`, 03:30 UTC); zostaje `senderDomain` (statystyki „najczęstsze domeny”), status i daty. Linki śledzące `/t/<token>` są maskowane w każdym polu przed zapisem (token cudzego odbiorcy nie może wyciec do
skrzynki zgłoszeń), także w wersjach zakodowanych przez bramki poczty (`%2Ft%2F`, `&#47;`, `\/`, pełnoszerokie `／`, łamanie
quoted-printable); podwójne kodowanie (`%252F`) nie jest obsługiwane - znane ograniczenie. `reportedAt` na odbiorcy jest ustawiane **raz** (atomowo, `IS NULL`).

Kolejne commity modułu: wyniki (metryka „zgłosiło”, po kliknięciu, agregaty z progiem 3, widok osobowy, CSV, KPI), panel
zgłoszeń dla ORG_ADMIN i kierownika działu z powiadomieniem, import pracowników z CSV.

### Agregaty odświeżane co godzinę (commit 3/5)

Jedno tanie ograniczenie kanału różnicowania w czasie (decyzja właściciela produktu 2026-09-20): **agregaty per dział (widok
przeglądu i kampanii, CSV agregatów, KPI dashboardu) są liczone z migawki odświeżanej nie częściej niż raz na godzinę**
(`ResultsSnapshotCache`), żeby "wzrost o 1 zaraz po tym, jak ktoś powiedział, że zgłosił" nie był obserwowalny w czasie
rzeczywistym. Szczegóły:

- Migawka to **same liczby per dział** (dostarczono, kliknęło, zgłosiło...), bez identyfikatorów osób. Klucz zawiera
  `organizationId` z JWT; Redis (wspólny dla instancji API) z rezerwą w pamięci procesu. TTL jest **stały od chwili policzenia**
  (odczyty go nie przedłużają); równoległe żądania dzielą jedno przeliczenie. Odpowiedź ma `dataAsOf`, UI pokazuje "Agregaty z ...".
- **Autoryzacja nie jest cache'owana**: rola, status `ACTIVE`, dział i istnienie kampanii są czytane z bazy na każde żądanie
  PRZED odczytem migawki (test: degradacja/dezaktywacja działa od razu przy rozgrzanym cache; kampania innej organizacji to 404).
- **Widok osobowy (audytowany) i jego CSV nie używają migawki** - są aktualne bez opóźnienia.
- Kompromis: nowa kampania, anulowanie, zgłoszenie czy kliknięcie pojawia się w agregatach z opóźnieniem do godziny (metadane
  kampanii - nazwa, status - są świeże). Konfiguracja: `RESULTS_CACHE_TTL_SECONDS` (domyślnie 3600; `0` wyłącza; w `NODE_ENV=test`
  domyślnie `0`, żeby testy nie zależały od czasu). To ograniczenie, nie eliminacja: kto porówna dwa odczyty dzielone godziną,
  nadal zobaczy różnicę - ale nie "na żywo".

## Skrzynka zgłoszeń i powiadomienia (moduł zgłoszeń, commit 3/5)

Kod: `apps/api/src/threat-reports/`, ekrany `/reports` (lista) i `/reports/:id` (szczegóły, tylko ORG_ADMIN).

**Zakresy** (rola, status i dział z bazy na każde żądanie - nie z tokenu; zgłoszenia symulacyjne nie trafiają do skrzynki):

| Rola | Co widzi / może |
|---|---|
| `ORG_ADMIN` | lista prawdziwych zgłoszeń (temat, nadawca, status, filtr i stronicowanie; **bez treści i bez zgłaszającego** - lista nie zostawia śladu w audycie), szczegóły (treść, nagłówki, komentarz, **zgłaszający**, dział, dziennik; **każdy wgląd audytowany**), zmiana statusu (`NEW` / `IN_REVIEW` / `THREAT` / `SAFE`) i notatki (odpowiedź tych dwóch operacji to wyłącznie status i historia zdarzeń - nie są drogą do odczytu treści z pominięciem audytu) |
| `DEPARTMENT_MANAGER` | `GET /threat-reports/department`: zgłoszenia **własnego działu** jako sama informacja o zdarzeniu - **data, status, DOMENA nadawcy, powiązanie z symulacją (tak/nie)**; widzi też zgłoszenia symulacyjne (jako "tak", bez statusu). **Bez tematu i pełnego nadawcy (dane osób trzecich, a kierownik nie obsługuje zgłoszeń), bez zgłaszającego, treści, nagłówków, komentarza i notatek, bez zmian statusu** (decyzja właściciela produktu 2026-09-20). Dwa zabezpieczenia dodane ponad decyzję 1 (uwagi z przeglądu bezpieczeństwa), żeby zgłoszenie nie identyfikowało zgłaszającego: (1) dział z mniej niż 3 **innymi** aktywnymi osobami (kierownik nie liczy się do progu - wie, czy sam zgłaszał): "za mało danych", bez listy; (2) zgłoszenia pojawiają się w tym widoku **dopiero po godzinie** (to samo opóźnienie co agregaty, `RESULTS_CACHE_TTL_SECONDS`), żeby nie było ich widać "na żywo" zaraz po tym, jak ktoś powiedział, że zgłosił; `total` liczy tylko widoczne |
| `EMPLOYEE` | tylko zgłaszanie (`/report`) |

Ograniczenia zasobów: lista admina czyta wąski zestaw kolumn (bez treści), `pageSize` <= 100 i `page` <= 500, historia zgłoszenia ma
maksymalnie 200 wpisów (409 `EVENT_LIMIT`; dziennik jest append-only, więc rośnie tylko do tego limitu).

**Dziennik zdarzeń** (`threat_report_events`): każda zmiana statusu (z jakiego na jaki) i każda notatka ma autora (kopia e-maila,
`actorUserId` zerowane po usunięciu konta) i czas. Zmiana statusu jest **warunkowa** (status musi być nadal taki, jaki widział admin) i
zapisywana z wpisem dziennika w jednej transakcji: równoległa zmiana daje 409 `STATUS_CONFLICT`, nie cichą utratę. Dziennik jest
append-only dla roli aplikacji (`REVOKE UPDATE, DELETE`); jedyny wyjątek to `GRANT UPDATE ("note")` - **retencja czyści treść notatek
po 90 dniach razem z treścią zgłoszenia** (zdarzenie, autor, czas i zmiany statusu zostają).

**Audyt wglądów** (`threat_report_views`, decyzja właściciela produktu 2026-09-20): **każdy wgląd ORG_ADMIN w szczegóły zgłoszenia**
(`GET /threat-reports/inbox/:id` - treść, nagłówki, komentarz, zgłaszający) zapisuje wpis: kto (kopia e-maila, `actorUserId` zerowane po
usunięciu konta), kiedy i które zgłoszenie - tak jak wgląd w wyniki osobowe. Wpis powstaje w **tej samej transakcji** co odczyt (błąd zapisu
cofa odczyt; odmowa 403/404 nie zostawia wpisu), tabela jest append-only dla roli aplikacji (`REVOKE UPDATE, DELETE`), wgląd ma limit 30/min.
Lista, zmiana statusu i notatki nie dokładają wpisu wglądu (te ostatnie mają własny wpis w dzienniku zdarzeń). Ostatnie 50 wglądów oraz **podsumowanie per admin** (liczba wglądów, pierwszy i ostatni) widać w
szczegółach zgłoszenia - podsumowania nie da się "zakopać" wieloma odświeżeniami. Wpisy zostają do usunięcia organizacji (jak inne audyty
modułu). Znane: tabela rośnie o jeden wiersz na wgląd (limit 30/min na adres, nie na użytkownika), więc rekordowy insider mógłby dopisać
dziesiątki tysięcy wierszy dziennie; indeks utrzymuje wydajność, alert/limit per użytkownik to backlog. Widok kierownika nie pokazuje domeny
nadawcy dla zgłoszeń symulacyjnych (nasza domena kampanii zdradzałaby trwającą kampanię).

**Powiadomienia mailowe** (`ThreatReportNotificationService`, job co 5 minut UTC): do wszystkich aktywnych `ORG_ADMIN` organizacji, **zbiorczo -
jeden mail na organizację w oknie 15 minut** (okno liczone od ostatniego wysłanego maila, stan w `threat_report_notification_state`),
z liczbą nowych zgłoszeń i linkiem do `/reports`. **Mail nie zawiera treści zgłoszeń, nadawców ani danych zgłaszających** (idzie zewnętrznym
dostawcą; szablon `threat-report-notification`). Idzie przez transakcyjny `EmailService`, nigdy przez transport symulacji. Zgłoszenia zajmowane atomowo
(`notifiedAt IS NULL`), organizacja serializowana blokadą doradczą (równoległe biegi/instancje = jedna runda), zgłoszenia w oknie czekają na
następny mail; gdy nikt nie dostał maila, zajęcie i okno są cofane (następny bieg ponawia). Awaria procesu między zajęciem a wysyłką gubi jeden
mail (at-most-once; zgłoszenia zostają w skrzynce). Opóźnienie pierwszego maila to do 5 minut. Zgłoszenia sprzed migracji uznano za
powiadomione. Zadanie iteruje po organizacjach (tabela globalna, bez furtki RLS) - przy tysiącach organizacji rozważyć zamianę na kolejkę
opóźnioną per organizacja (backlog). Kierownicy działu nie dostają maili.

## Znane ograniczenia i backlog (świadomie poza tym commitem)

- **Alert dla SUPER_ADMIN:** organizacja, w której >20% odbiorców kampanii to adresy spoza zweryfikowanej domeny
  organizacji (sygnał nadużycia - wysyłka z naszej domeny do osób trzecich).
- Dopracowane limity wysyłki (per kampania, per godzinę, reputacja domeny) poza limitem dobowym.
- Redis musi być chroniony (hasło, sieć wewnętrzna): kolejka steruje wysyłką, a zadania niosą tylko identyfikatory.
- **Powiadomienia o zgłoszeniach - kolejka per organizacja** (decyzja 2026-09-20: zgoda na backlog): zamiast pętli co 5 minut po
  wszystkich organizacjach, kolejka opóźniona uruchamiana przy zgłoszeniu (wzorzec `phishing/campaigns`); skraca opóźnienie maila i
  usuwa koszt skanowania organizacji bez zgłoszeń. Dziś: do 5 minut opóźnienia i krótka transakcja na organizację.
- **Backfill `notifiedAt` w migracji `20260920160000_threat_report_inbox` bez testu** (decyzja 2026-09-20: zgoda): dane migracji nie są
  osiągalne w e2e. Zmiana odblokowuje FORCE RLS na czas jednego UPDATE, żeby zadziałał także dla roli bez BYPASSRLS. Do ręcznego
  sprawdzenia przy pierwszym wdrożeniu na bazie z istniejącymi zgłoszeniami: `SELECT count(*) FROM threat_reports WHERE kind='REAL' AND "notifiedAt" IS NULL` = 0.
- **CI/testy: sporadyczne "Jest did not exit one second after the test run has completed"** (decyzja 2026-09-20: nie blokuje; wracamy,
  jeśli CI zacznie na tym padać). Ustalone: w replice CI (kontener `node:20`, 2 CPU, Postgres 16, Redis 7) pojawiło się w 3 z ok. 8
  pełnych przebiegów e2e, zawsze w PIERWSZYM przebiegu po świeżym starcie kontenerów, przy wszystkich testach zielonych; `--detectOpenHandles`
  (pełny przebieg i wybrane specyfikacje z Redisem: jobs, registration-mail-limiter, throttle-client-ip, sessions) niczego nie wykazał.
  Źródła nie ustalono; komunikat był też w logu CI z czasów sprzed modułu zgłoszeń, więc prawdopodobnie istniał wcześniej (niepotwierdzone).
  Podejrzenie: klient Redis/BullMQ z ponawianiem połączenia (w tym test z celowo niedostępnym Redisem `127.0.0.1:1`) przy zimnym starcie.

Bez działającego Redisa/workera (`BACKGROUND_JOBS_ENABLED=false`) kampanie nie wysyłają - status API pokazuje
konfigurację transportu (`GET /phishing/config`), ale nie stan kolejki.

## Transport i konfiguracja

Patrz `docs/deploy-test.md` sekcja 9 (warunki blokujące startu: domena nadawcy z SPF/DKIM/DMARC, własny token,
osobna domena strony lądowania) oraz `.env.example`. Wysyłka symulacji nigdy nie idzie przez `EmailService`;
pilnuje tego `transport-separation.spec.ts`.

## Testowanie

- `send-planner.spec.ts`: rozkład i granice planera z wstrzykiwanym generatorem (bez czekania).
- `test/phishing-campaigns.e2e-spec.ts`: API, `sendOne` (w tym równoległe wywołania, ponowienia, timeout, koniec okna,
  usunięty pracownik), `reconcile`, izolacja organizacji A/B, RLS i ograniczenia w bazie. Kolejka i transport to atrapy.
- `test/phishing-tracking.e2e-spec.ts`: publiczne `view`/`submit` (idempotencja, równoległość, ciało niezapisywane i
  nielogowane, odpowiedź neutralna, limit żądań), przypisanie kursu, izolacja A/B, RLS lookupu, CHECK-i.
- Web: `tracking-routes.test.ts` (BFF: brak ciała, stała ścieżka, neutralność), `LandingClient.test.tsx` (GET nie liczy,
  opóźnienie/interakcja, brak wartości pól).
- `results-aggregation.spec.ts`: progi, łączenie małych grup, test losowy "nie da się odjąć", CSV. `test/phishing-results.e2e-spec.ts`:
  agregaty (ORG_ADMIN i manager), flaga wyników osobowych z audytem, CSV, KPI i eksport dashboardu, role, PENDING, izolacja A/B, RLS,
  CHECK-i i append-only dziennika.
- `test/phishing-campaigns-queue.e2e-spec.ts`: jeden test z prawdziwym BullMQ/Redisem (własny `JOBS_QUEUE_PREFIX`,
  opóźnienie ~300 ms, deduplikacja, usuwanie zadań).
