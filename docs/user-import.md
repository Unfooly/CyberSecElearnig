# Import pracowników z CSV

Import jest dwuetapowy: **krok 1 (podgląd)** rozbiera i waliduje cały plik, niczego nie zapisując w `users`; **krok 2
(potwierdzenie, zaproszenia w kolejce, raport)** dochodzi w commicie 5/5 modułu. Dziś działa krok 1 oraz dotychczasowy
jednoetapowy `POST /users/import-csv` (do zastąpienia w commicie 5/5), który też respektuje limit licencji.

Kod: `apps/api/src/users/import/` (parser `csv-import.ts`, serwis podglądu, kontroler, sprzątanie), limit miejsc `apps/api/src/users/seats.ts`,
tabele `user_import_batches` i `user_import_rows` (RLS FORCE, złożone FK).

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
  nadpisujemy**, nie zużywa miejsca. Adresów z **innych organizacji** celowo NIE sprawdzamy (wymagałoby furtki omijającej RLS i pozwalało
  sprawdzać, kto ma konto na platformie): taki wiersz jest w podglądzie poprawny, a przy potwierdzeniu wyjdzie jako ogólny błąd „Nie można
  użyć tego adresu e-mail” i nie zużyje licencji.
- **Jedna aktywna partia na organizację:** nowy podgląd zastępuje poprzedni (ogranicza ilość przechowywanych danych osobowych).
- **Ważność 24 h:** wygasły podgląd jest „nieistniejący” (404); job `user-import-retention` (co godzinę, UTC) kasuje wygasłe partie razem
  z wierszami, więc dane z pliku zostają w bazie najwyżej ok. 25 h.
- **Numer wiersza (`line`)** liczy rekordy CSV, nie linie fizyczne: przy polach w cudzysłowie zawierających nowe linie może się rozjechać z arkuszem.
- **Multipart:** żadnych pól tekstowych i najwyżej 2 części (ochrona pamięci); limit 1 MB na plik.
- **Raporty (commit 5/5):** adres e-mail może zaczynać się od `+`/`-` (poprawny adres), więc każdy eksport CSV musi escapować komórki
  (prefiks `'` przed `= + - @`), jak `escapeCsvField` w wynikach symulacji.
- **Uprawnienia:** rola (`ORG_ADMIN`) i status (`ACTIVE`) czytane z bazy na każde żądanie; organizacja PENDING = 403.

## Limit licencji (`Organization.seatsLimit`)

Miejsca = liczba kont w organizacji (każdy status i rola, także `INVITED`). Egzekwowane w: **pojedynczym zaproszeniu** (`POST /users/invite`),
starym imporcie jednoetapowym i (commit 5/5) potwierdzeniu importu - blokada doradcza w tej samej transakcji co zapis konta, więc równoległe
zaproszenia nie przekroczą limitu. Odpowiedź `409 SEAT_LIMIT`: `seatsLimit`, `seatsUsed`, `seatsAvailable`, `seatsRequired`, `seatsMissing` i
`settingsPath` (`/dashboard/settings` - zmiana planu; Stripe później); komunikat mówi, ile miejsc zostało. **Podgląd nie odrzuca pliku ponad
limit** - pokazuje `seats.missing` i `seats.ok = false` PRZED zapisem; odrzucenie (bez zapisu jakiegokolwiek konta) następuje przy
potwierdzeniu.

## Dane w bazie i prywatność

Partie podglądu zawierają adresy e-mail, imiona i nazwiska oraz nazwy działów z pliku - **przez maksymalnie ok. 25 h** (ważność 24 h + godzinne sprzątanie; potem kasowane;
patrz `docs/legal/privacy-policy-checklist.md`). Autor partii: kopia e-maila (`createdByEmail`) przeżywa usunięcie konta, `createdByUserId` jest zerowane.

## Znane ograniczenia (do commitu 5/5)

- Kroku potwierdzenia jeszcze nie ma: podgląd niczego nie tworzy. Zaproszenia mają dobowy limit 300 wysyłek na organizację
  (`INVITE_DAILY_LIMIT_PER_ORG`), więc import 5000 osób w jednej dobie wymaga w commicie 5/5 decyzji: rozłożenia zaproszeń w czasie
  (kolejka z tempem) albo podniesienia limitu dla importu.
- UI podglądu (wybór pliku, tabela błędów, stan miejsc) dochodzi w commicie 5/5 razem z potwierdzeniem; do tego czasu działa stary modal.
