# E2E: samoobsługowa rejestracja firmy (przeglądarka)

## Automatyczny scenariusz (Playwright)

`scripts/e2e-registration.mjs` przechodzi w prawdziwej przeglądarce całą ścieżkę:

1. formularz rejestracji (brak pól hasła, dane firmy, NIP, zgody) -> „Sprawdź skrzynkę e-mail”,
2. mail aktywacyjny (link z logu API - tryb deweloperski, bez prawdziwej wysyłki; sprawdza nazwę firmy w mailu),
3. ustawienie hasła z linku -> logowanie,
4. organizacja PENDING: logowanie kieruje na `/onboarding`, a `/dashboard` i `/dashboard/users` wracają na `/onboarding`,
5. ekran pokazuje rekord TXT (`_unfooly-verify.<domena>` = `unfooly-verify=<token>`),
6. „Sprawdź teraz” bez rekordu -> jeden komunikat porażki,
7. ustawienia przed weryfikacją: przełącznik `selfJoinEnabled` zablokowany,
8. rekord „wpisany w DNS” -> „Sprawdź teraz” -> organizacja odblokowana, `/dashboard`,
9. `/onboarding` dla organizacji ACTIVE odsyła do panelu; przełącznik `selfJoinEnabled` działa i zapisuje się w bazie.

Uruchomienie (lokalny Postgres i Redis z `docker compose up -d`, migracje zastosowane):

```bash
npm run build --workspace=packages/shared
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npx dotenv -e .env -- node scripts/e2e-registration.mjs
```

**Uwaga:** skrypt używa bazy z lokalnego `.env` i tworzy w niej dane - uruchamiaj go wyłącznie na środowisku
deweloperskim, nigdy z `.env` wskazującym produkcję.

Skrypt sam startuje API (`:3101`) i web (`:3100`), używa bazy z `.env` i po sobie usuwa utworzoną organizację.
Porty zmienisz zmiennymi `E2E_API_PORT` / `E2E_WEB_PORT`.

**Czego skrypt NIE sprawdza (ograniczenia):**
- DNS jest podmieniony preloadem `scripts/e2e/dns-stub.cjs` tylko w procesie API skryptu (prawdziwy
  `NodeDnsTxtResolver` działa dalej, ale zamiast sieci dostaje rekord z pliku). Prawdziwe zapytanie DNS
  sprawdza scenariusz ręczny poniżej.
- Mail nie jest wysyłany (brak `MAILERSEND_API_TOKEN` w środowisku skryptu) - dostarczenie i wygląd maila
  w skrzynce sprawdza scenariusz ręczny.

## Scenariusz ręczny (przed wdrożeniem na VPS, na środowisku z prawdziwym MailerSend i DNS)

Wymaga prawdziwej domeny, do której masz dostęp do panelu DNS, i skrzynki w tej domenie.

1. Wejdź na `/register`, wypełnij formularz adresem ze skrzynki w tej domenie, zaznacz obie zgody.
   Sprawdź: w formularzu nie ma haseł; linki „Regulamin” i „Polityka prywatności” otwierają strony z noindex.
2. Sprawdź skrzynkę: mail „Potwierdź adres e-mail i ustaw hasło” z nazwą firmy, przycisk działa, link ważny 24 h.
   (Adres z Gmaila/WP ma zostać odrzucony komunikatem o domenie firmowej.)
3. Kliknij link, ustaw hasło, zaloguj się -> ekran „Zweryfikuj domenę firmy”.
4. Skopiuj rekord (przyciski „Kopiuj”) i dodaj w DNS: typ `TXT`, nazwa `_unfooly-verify.<domena>`,
   wartość `unfooly-verify=<token>`.
5. Kliknij „Sprawdź teraz”: przed propagacją komunikat porażki; ponowne kliknięcie w ciągu 10 s -> „zbyt często”.
6. Po propagacji „Sprawdź teraz” odblokowuje panel. Sprawdź `/dashboard/settings` (dane firmy, przełącznik).
7. Sprzątanie: zarejestruj drugą organizację, nie weryfikuj domeny - po 7 dniach mail z przypomnieniem, po 14 dniach
   organizacja znika (do szybkiego sprawdzenia przesuń `createdAt` w bazie i uruchom job).
