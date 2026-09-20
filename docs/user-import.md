# Import pracowników z CSV

Import jest dwuetapowy: **krok 1 (podgląd)** rozbiera i waliduje cały plik, niczego nie zapisując w `users`; **krok 2
(potwierdzenie)** tworzy konta `INVITED`, a zaproszenia idą w kolejce z tempem (job w tle), z postępem i raportem CSV.
Dawny jednoetapowy `POST /users/import-csv` został usunięty.

Kod: `apps/api/src/users/import/` (parser `csv-import.ts`, serwis importu, kolejka zaproszeń `user-import-invite.service.ts`, tempo
`invite-pace.ts`, kontroler, sprzątanie), limit miejsc `apps/api/src/users/seats.ts`, tabele `user_import_batches` i `user_import_rows`
(RLS FORCE, złożone FK). UI: `apps/web/src/app/dashboard/users/_components/ImportUsersModal.tsx` (BFF: `app/api/users/import/*`).

## Format pliku

| Zasada | Wartość |
|---|---|
| Kodowanie | **UTF-8** (z BOM albo bez). UTF-16, XLSX/ZIP, dane binarne i tekst niebędący UTF-8 (np. Windows-1250 z polskiego Excela „CSV”) są odrzucane z instrukcją „Zapisz jako CSV UTF-8” - nie zgadujemy kodowania, bo popsułoby polskie znaki w imionach, które trafiają do maili z zaproszeniem |
| Separator | wykrywany z nagłówka **poza cudzysłowami**: `,` `;` albo tabulator (wygrywa najczęstszy, remis = przecinek) |
| Kolumny | `email`, `firstName`, `lastName` wymagane; `departmentName` opcjonalna. Nagłówki **po polsku lub angielsku**, w dowolnej kolejności: `E-mail`/`email`/`Mail`/`Adres e-mail`, `Imię`/`firstName`/`First name`, `Nazwisko`/`lastName`/`Last name`, `Dział`/`departmentName`/`Department` (bez względu na wielkość liter i polskie znaki). Dwie kolumny o tym samym znaczeniu = błąd pliku; nieznane kolumny są ignorowane i zgłaszane (`ignoredColumns`) |
| Limity | **5000 wierszy danych i 1 MB** (limit rozmiaru egzekwuje Multer przed parserem: 413; wierszy parser: 400). Pojedyncze pole > 1000 znaków = błąd pliku (nieuciekany cudzysłów) |
| Puste wiersze | pomijane po cichu (`skippedEmpty`), numeracja linii zgodna z arkuszem (1 = nagłówek) |

## Walidacja per wiersz

Błąd jednego wiersza **nie zatrzymuje** pozostałych; zły wiersz dostaje powód i nie zostanie zapisany. Reguły: poprawny format e-maila
(małymi literami, max 254), imię i nazwisko z allowlisty znaków (litery Unicode, spacja, kropka, apostrof, myślnik - bez cyfr i
znaczników; chroni przed frazą phishingową w „imieniu”, które trafiłoby do maila z zaproszeniem), max 100 znaków, nazwa działu bez
znaków sterujących/formatujących i **bez znaku formuły na początku** (`= + - @ |`; wstrzyknięcie formuły przy otwarciu raportu w Excelu),
duplikat e-maila w pliku (pierwszy wiersz zostaje, kolejne mają błąd ze wskazaniem pierwszego), białe znaki przycinane i zwijane.
Błędy strukturalne (kodowanie, niesparowany cudzysłów, brak wymaganych kolumn, >5000 wierszy) odrzucają cały plik.

## Podgląd (`POST /users/import/preview`, tylko ORG_ADMIN)

`multipart/form-data`, pole `file`; limit 3 żądania/min. Odpowiedź: `id` partii, `totalRows`, `validCount`, `existingCount`, `errorCount`,
`skippedEmpty`, `ignoredColumns`, `delimiter`, `expiresAt`, `seats`, pierwsze **200 błędów** (`errors`, `errorsTruncated`) i próbka 20 poprawnych
wierszy. Resztę wierszy pobiera `GET /users/import/:id/rows?status=ERROR|EXISTING|VALID&page&pageSize` (max 100). `GET /users/import/:id` zwraca
podsumowanie ze **świeżym stanem miejsc**; `DELETE /users/import/:id` anuluje podgląd (204).

- **Istniejące konta:** adres z kontem **w tej organizacji** (bez względu na wielkość liter) dostaje status `EXISTING`: pomijany, **nic nie
  nadpisujemy**, nie zużywa miejsca. Adresów z **innych organizacji** w podglądzie NIE sprawdzamy: wiersz jest poprawny, a jego dalszy los
  opisuje sekcja „Adres zajęty w innej organizacji” (administrator niczego nie dowiaduje się o kontach na platformie).
- **Jedna aktywna partia na organizację:** nowy podgląd zastępuje poprzedni (ogranicza ilość przechowywanych danych osobowych).
- **Ważność 24 h:** wygasły podgląd jest „nieistniejący” (404); job `user-import-retention` (co godzinę, UTC) kasuje wygasłe partie razem
  z wierszami, więc dane z pliku zostają w bazie najwyżej ok. 25 h.
- **Numer wiersza (`line`)** liczy rekordy CSV, nie linie fizyczne: przy polach w cudzysłowie zawierających nowe linie może się rozjechać z arkuszem.
- **Multipart:** żadnych pól tekstowych i najwyżej 2 części (ochrona pamięci); limit 1 MB na plik.
- **Raporty:** adres e-mail może zaczynać się od `+`/`-` (poprawny adres), więc eksport CSV escapuje komórki (prefiks `'` przed
  `= + - @`, wspólne `toCsv` z BOM), jak w wynikach symulacji.
- **Uprawnienia:** rola (`ORG_ADMIN`) i status (`ACTIVE`) czytane z bazy na każde żądanie; organizacja PENDING = 403.

## Limit licencji (`Organization.seatsLimit`)

Miejsca = liczba kont w organizacji (każdy status i rola, także `INVITED`). Egzekwowane w: **pojedynczym zaproszeniu** (`POST /users/invite`),
potwierdzeniu importu - blokada doradcza w tej samej transakcji co zapis konta, więc równoległe
zaproszenia nie przekroczą limitu. Odpowiedź `409 SEAT_LIMIT`: `seatsLimit`, `seatsUsed`, `seatsAvailable`, `seatsRequired`, `seatsMissing` i
`settingsPath` (`/dashboard/settings` - zmiana planu; Stripe później); komunikat mówi, ile miejsc zostało. **Podgląd nie odrzuca pliku ponad
limit** - pokazuje `seats.missing` i `seats.ok = false` PRZED zapisem; odrzucenie (bez zapisu jakiegokolwiek konta) następuje przy
potwierdzeniu.

## Potwierdzenie (`POST /users/import/:id/confirm`, tylko ORG_ADMIN)

W JEDNEJ transakcji, po sprawdzeniu miejsc pod blokadą doradczą: tworzy konta `INVITED` dla wierszy `VALID` (z jednym zastępczym hashem
hasła na partię; hasło ustawia dopiero użytkownik z maila), tworzy brakujące działy i zapisuje wynik per wiersz (`accountResult`
`CREATED`). Partia przechodzi w `PROCESSING`. Brak miejsc = `409 SEAT_LIMIT` bez zapisu jakiegokolwiek konta. Ponowne potwierdzenie tej
samej partii jest idempotentne; limit 3 żądania/min.

**Limit importu nowych kont na dobę:** `2 x seatsLimit` na kroczące 24 h (jak wysyłki symulacji; `IMPORT_DAILY_ACCOUNTS_FACTOR`), liczony po
wszystkich wierszach przyjętych do utworzenia - także tych, dla których konta nie utworzono (adres zajęty). Przekroczenie = `429
IMPORT_DAILY_LIMIT` bez zapisu. Ogranicza skalę sondowania adresów nawet przy ukrytym wyniku.

## Adres zajęty w innej organizacji (brak sondy istnienia kont)

`users.email` jest unikalny globalnie, więc adres może mieć konto w INNEJ organizacji. Administrator **nie może się tego dowiedzieć**
(ani z importu, ani z pojedynczego zaproszenia `POST /users/invite`):

- Import: wiersz zostaje „utworzony” (`accountResult = CREATED`, zaproszenie w kolejce), liczniki i raport CSV nie rozróżniają go od
  pozostałych; wewnętrzny znacznik `addressTaken` nigdy nie trafia do API ani raportu. Konta w organizacji administratora nie ma.
  Kolejka zamiast zaproszenia wysyła **właścicielowi adresu** wiadomość „Ktoś próbował dodać Cię do organizacji <nazwa>” (bez linków;
  szablon `invite-address-taken`, jak przy próbie rejestracji na istniejący adres) i oznacza wiersz jako „wysłano”. Jedna wiadomość na
  skrzynkę na 10 minut (ochrona właściciela); każda próba trafia do dziennika `invite_notices` i liczy się do **dobowego limitu
  zaproszeń (300)** razem z prawdziwymi zaproszeniami.
- Pojedyncze zaproszenie: odpowiedź `201` ma ten sam kształt co dla nowego adresu (`status: INVITED`, `inviteEmailSent: true`, id w
  formacie zwykłego id); konta nie ma. Adres z kontem w TEJ organizacji nadal daje ogólny `400` (administrator widzi swoją listę).
- **Rezydualny kanał:** administrator zobaczy, że osoby nie ma na liście użytkowników organizacji; tego nie da się ukryć bez ukrywania
  własnej listy. Realnie sondowanie ogranicza limit dobowy importu i zaproszeń.

**Pierwszeństwo do adresu (squatting).** Konto `INVITED`, które nie zostało aktywowane, nie blokuje adresu:

1. zaproszenie/import z organizacji ze **zweryfikowaną domeną DNS** tego adresu przejmuje adres: cudze nieaktywowane zaproszenie jest
   usuwane, a konto powstaje normalnie (przy imporcie w kolejce, tuż przed wysyłką zaproszenia);
2. **rejestracja** nowej organizacji na adres z nieaktywowanym zaproszeniem w obcej organizacji, która NIE ma zweryfikowanej domeny tego
   adresu (zaprosiła cudzy adres bez praw do domeny), zwalnia adres i przebiega jak dla nowego adresu. Zaproszenie od organizacji ze
   zweryfikowaną domeną adresu jest chronione (właściciel dostaje link aktywacyjny jak dotąd);
3. konto aktywowane i konto `ORG_ADMIN` nie są przejmowane.

Administrator organizacji, której zaproszenie wygasło w wyniku przejęcia, widzi w raporcie importu status „Wygasło” z ogólnym powodem
(nie ujawniamy, kto przejął adres). Dopasowanie domeny jest dokładne (bez subdomen).

**Wygasanie:** job `invite-expiry` (raz na dobę, 04:20 UTC) usuwa konta `INVITED` (poza `ORG_ADMIN`) nieaktywowane od **30 dni** od
utworzenia; wiersze importu dostają status „Wygasło”.

## Kolejka zaproszeń z tempem

Zaproszenia NIE idą w jednej serii: job `user-import-invites` (co 5 min, UTC) wysyła je partiami. Tempo (`invite-pace.ts`): najwyżej
**20 na bieg** (okno `claimedRecently` chroni przed równoległymi biegami) i w granicach **dobowego limitu 300 na organizację**
(`INVITE_DAILY_LIMIT_PER_ORG`, wspólnego z zaproszeniami ręcznymi; liczonego z tokenów zaproszeń i powiadomień „ktoś próbował Cię dodać” z ostatnich 24 h). Limit 300 zostaje limitem
antyspamowym - import 5000 osób rozkłada się na kolejne doby.

**Wysyłka jednego zaproszenia jest „co najwyżej raz”, tak samo jak w kampaniach phishingowych** (`docs/phishing-simulations.md`):

1. **Rezerwacja pojemności** (pod blokadą doradczą organizacji): wiersze wybrane do biegu dostają tylko znacznik `inviteClaimedAt`
   (= `now` biegu) i zostają `PENDING` - liczą się do tempa, ale nikt nie zaczął ich wysyłać. Rezerwacja po awarii po prostu wygasa,
   a wiersz wraca do kolejki (nic nie wyszło).
2. **Zajęcie tuż przed wysyłką KAŻDEGO zaproszenia**: atomowe `updateMany` `PENDING` → `SENDING` z `inviteSendingAt` = początek TEJ
   wysyłki; tylko jeden wykonawca dostaje `count = 1`. Wiek zajęcia to czas jednej wysyłki, nie czas oczekiwania w biegu - wolny
   dostawca ani długi bieg nie zamieniają żywej wysyłki w „niepewną”. **Nie ma progu „10 minut = niepewne” dla żywych wysyłek.**
3. **Wynik** (ten sam podział co `PhishingMailTransport`): `SENT` (dostawca przyjął), `FAILED` (PEWNE niepowodzenie: HTTP 4xx, brak
   połączenia z dostawcą, awaria wystawienia tokenu; nic nie wyszło) albo `UNCERTAIN` (**timeout dostawcy** `TIMEOUT_UNKNOWN`,
   HTTP 5xx i 408, zerwane połączenie `RESULT_UNKNOWN`: wiadomość mogła dotrzeć). Klasyfikuje `EmailService.send(options, outcome)`. Konto aktywowane albo usunięte w międzyczasie = `SKIPPED`.
4. **Niepewne nie są ponawiane**, mają osobny licznik i status „Niepewne” w raporcie, a **„Wyślij zaproszenie ponownie” jest dla nich
   zablokowane** (`409 INVITE_RESULT_UNKNOWN`) - ponowna wysyłka dałaby duplikat i unieważniła link, który osoba już ma. Konto
   nieaktywowane i tak wygasa po 30 dniach; administrator może też usunąć konto i dodać je ponownie. Ta sama blokada (`409
   INVITE_QUEUED`) obejmuje zaproszenie, które czeka w kolejce importu albo właśnie jest wysyłane (ręczna wysyłka dałaby duplikat
   poza mechanizmem „co najwyżej raz”); po zatrzymaniu wysyłki importu wiersze są pomijane i ręczna wysyłka jest znów możliwa.
5. **Awaria procesu w trakcie wysyłki** (`SENDING` starsze niż `INVITE_STALE_CLAIM_MS` = 10 min, liczone od początku tej wysyłki, a
   wysyłka ma timeout dostawcy 10 s) jest domykana przy następnym biegu jako `UNCERTAIN` (`INTERRUPTED_UNKNOWN`) - jak zajęcia bez wyniku w kampaniach.

Powody wierszy nie odsyłają do „Wyślij ponownie” (dla wiersza z zajętym adresem konta nie ma, więc taka wskazówka byłaby sondą). Dane
zadania to same identyfikatory.

## Postęp, zatrzymanie i raport

- `GET /users/import/latest` - trwająca albo niedawno zakończona partia (UI wznawia widok po zamknięciu okna).
- `GET /users/import/:id` - `progress`: `accountsCreated`, `invites{pending,sent,failed,skipped}`, `invitesSent`/`invitesTotal`, `remaining`,
  `dailyLimit`, `dailyRemaining`, `restTomorrow` i `estimatedCompletionAt`. UI: „wysłano X z Y, reszta jutro” i szacowana data. **Data to
  szacunek** (zakłada stały limit i brak innych zaproszeń w organizacji), nie obietnica.
- `POST /users/import/:id/stop` - zatrzymuje wysyłkę (konta zostają, oczekujące zaproszenia → `SKIPPED`), partia `COMPLETED`.
- `GET /users/import/:id/report.csv` - raport per wiersz (walidacja, konto, zaproszenie), komórki escapowane, błąd to zawsze JSON.
- Partia `COMPLETED` po wysłaniu/pominięciu wszystkich zaproszeń.

## Dane w bazie i prywatność

Partie podglądu zawierają adresy e-mail, imiona i nazwiska oraz nazwy działów z pliku - **przez maksymalnie ok. 25 h** (ważność 24 h + godzinne sprzątanie; potem kasowane;
patrz `docs/legal/privacy-policy-checklist.md`). Partie **potwierdzone** (dane potrzebne do postępu i raportu) są kasowane **30 dni po
zakończeniu**, a zawieszone w przetwarzaniu najpóźniej **60 dni** po potwierdzeniu (job `user-import-retention`). Autor partii: kopia
e-maila (`createdByEmail`, `confirmedByEmail`) przeżywa usunięcie konta, `createdByUserId` jest zerowane.

## Znane ograniczenia

- Szacowana data zakończenia jest przybliżeniem (patrz wyżej); zaproszenia o niepewnym wyniku wysyłki (`UNCERTAIN`) nie są
  ponawiane automatycznie ani ręcznie.
- Numer wiersza w raporcie liczy rekordy CSV, nie linie fizyczne (patrz uwaga przy podglądzie).
