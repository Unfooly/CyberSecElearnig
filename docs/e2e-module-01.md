# E2E: pełne przejście modułu 1 („Zabawa w phishing”, scenariusz „Webinar”; przeglądarka)

## Automatyczny scenariusz (Playwright)

`scripts/e2e-module-01.mjs` importuje PRAWDZIWY moduł (`packages/content/modules/wyludzone-haslo/module.json`) przez
PRAWDZIWY skrypt importu (`apps/api/dist/scripts/content-import.js`, ta sama ścieżka co produkcja - D-051 pkt 11), a
potem przechodzi w prawdziwej przeglądarce cały moduł, odpowiadając poprawnie. Treść kart, zakładek, czatu, pytań i
odpowiedzi czyta z `module.json`. Na sztywno ma etykiety interfejsu (np. „Dalej”, „Odłóż”) i nazwy osiągnięć. Zmiana id
bloków lub hotspotów, ich kolejności albo mechaniki bloku wymaga poprawki skryptu.

1. **Katalog i ekran startu** (D-163, D-171): karta z miniaturą, „Sprawa 1”, uwaga o wymaganym module w czerwonej ramce,
   „Start”. Na komputerze za ramką odtwarzacza widać rozmyte tło modułu (`cover.backdrop`); na telefonie tła nie ma.
2. **Teczka** (TABS, teczka na biurku, pieczątka „ŚCIŚLE TAJNE”): „Dalej” dopiero po wszystkich zakładkach.
3. **Biuro Pawła:** jedyne drzwi to komputer (podpowiedź „Kliknij „Komputer”, żeby iść dalej.”). Karty smartfona i
   Pawła są nieobowiązkowe.
4. **Wznowienie:** X i od razu „Kontynuuj naukę” bez przeładowania strony. Odtwarzacz wraca na pulpit, nie na teczkę
   ani na ekran startu. Lista kursów jest pobierana raz (D-142).
5. **Pulpit:** Internet (karta), easter egg „GTA6_PL.exe” (trzy okienka, outro z osiągnięciem; tylko komputer),
   Poczta = drzwi.
6. **Mail w monitorze** (EMAIL_ANALYSIS, waga 2): zaznaczona tylko „niespodziewana oferta”, wynik 100% i reakcja z treści.
7. **Biuro z ✓ komputera:** „Wstecz” przeglądarki po kolejnym zapisie pokazuje to biuro, nie pulpit. Smartfon = drzwi.
8. **Ekran telefonu** (karta Kalendarz, Komunikator = drzwi) i **czat w ramce telefonu** (DOSSIER layout chat):
   - zwykła wiadomość pokazuje komunikat bez zaznaczenia;
   - trzy wymagane wiadomości są zaznaczane.
9. **Domena** (TEXT_INPUT_GUIDED, waga 2) i **Tak/Nie** (QUIZ, waga 1): poprawnie za pierwszym razem.
10. **Biuro z dwoma ✓** (Paweł = drzwi), **rozmowa z Pawłem** (DIALOGUE: najpierw kwestia otwierająca, potem
    wszystkie pytania), **tablica** (ORDERING, waga 2; układana klawiaturą).
11. **Raport w teczce „SPRAWA ZAMKNIĘTA”**, potem **gazeta** (wymagany artykuł).
12. **Koniec:** podsumowanie zapisuje się samo, bez ekranu (D-169). Kurs jest ukończony ze 100% wyniku.
    Osiągnięcia przyznane na żywo to „Pierwsza sprawa zamknięta” i „Sprawa bez skazy”.
13. **Ekran końca** (D-165):
    - pieczątka „Sprawa zamknięta”;
    - kafelki: 100%, czas w minutach, +XP;
    - pasek poziomu i nowe osiągnięcia;
    - trzy zasady na wynos (`lessons` z treści);
    - „Wróć do biblioteki” i „Zagraj jeszcze raz”.

    Po odświeżeniu ekran końca pojawia się od razu, bez ekranu startu.
14. **Profil osiągnięć i ranking:**
    - trzy osiągnięcia (na telefonie dwa, bez easter egga);
    - rewers z datą;
    - przypięcie dwóch osiągnięć;
    - ich miniatury przy moim nazwisku w rankingu.
15. **Na całym przebiegu** brak błędów strony i odpowiedzi 5xx. Odpowiedź `/attempt` po dobrej pierwszej próbie domeny
    nie zawiera rozwiązania ani podpowiedzi. Treść bloków przychodzi w HTML strony (`/start` woła serwer Next), więc klucza
    odpowiedzi w treści skrypt nie sprawdza. Pilnują tego `classification.spec.ts` w `packages/content` i e2e API.

Rejestracja i aktywacja organizacji NIE są tu powtarzane (pełna ścieżka: `docs/e2e-registration.md`). Organizację
ACTIVE i pracownika skrypt tworzy wprost przez Prisma, żeby skupić się na odtwarzaczu i treści modułu.

Uruchomienie: lokalny Postgres z opublikowanym portem, migracje zastosowane (`npx prisma migrate deploy
--schema=apps/api/prisma/schema.prisma`). Grafiki i nagrania modułu są tylko na R2, więc web dostaje `CONTENT_BASE_URL`:

```bash
npm run build --workspace=packages/content
npm run build --workspace=apps/api
CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/e2e-module-01.mjs
```

Opcje:
- `E2E_VIEWPORT=390x844`: telefon w pionie z dotykiem. Bez easter egga pulpitu, bo kaskada okienek na telefonie to
  inny przebieg. Domyślnie 1366x768.
- `E2E_WEB_MODE=start`: build produkcyjny (`next start`, wymaga `next build`, D-142).
- `E2E_SHOTS_DIR=<katalog>`: zrzut każdego bloku do przeglądu graficznego. Zrzuty obu rozdzielczości do
  `docs/brand/screens/<slug>/` robi `scripts/screenshot-module.mjs`, który uruchamia ten skrypt.

Te same kroki ekranu startu i końca mają skrypty modułów 2–4 (`scripts/e2e-module-0N.mjs`, wspólny helper
`scripts/lib/module-screens.mjs`).

**Uwaga:** skrypt używa bazy z lokalnego `.env` i tworzy w niej dane (organizację, pracownika, zaimportowany kurs).
Uruchamiaj go wyłącznie na środowisku deweloperskim. Strażnik `scripts/lib/local-db-guard.mjs` odmawia przy bazie
innej niż lokalna. Skrypt sprząta po sobie w `finally`: usuwa organizację, a kurs tylko wtedy, gdy stworzył go ten
przebieg.

Skrypt sam startuje API (`:3111`) i web (`:3110`, przez `next dev` - patrz „Znane ograniczenia” niżej). Porty
zmienisz zmiennymi `E2E_API_PORT` / `E2E_WEB_PORT`.

## Znane ograniczenia

- **Web domyślnie startuje przez `next dev`, nie `next start`.** `next start` twardo ustawia `NODE_ENV=production`
  wewnątrz CLI i nie da się tego nadpisać zmienną środowiskową procesu. Cookies `access_token`/`refresh_token`
  (`apps/web/src/lib/auth-cookies.ts`) dostają wtedy `Secure`: przeglądarka je przechowuje, ale bez TLS nigdy ich nie
  wysyła, więc każde żądanie do BFF kończy się 401 mimo poprawnego zalogowania. `next dev` nie ma tego problemu i
  kompiluje z `apps/web/src` na bieżąco, więc skrypt zawsze testuje najnowszy kod. Ten skrypt nie sprawdza nagłówków
  CSP; robi to `scripts/e2e-registration.mjs`.
- **Nie sprawdza publikacji zasobów do R2 ani dźwięku narracji.** Sprawdza tylko lokalny import treści do bazy i
  odtwarzacz z grafikami z `CONTENT_BASE_URL`.
- **Pięć scen przejścia nie ma jeszcze narracji (B-171).** Skrypt nie sprawdza nagrań, więc się na tym nie zatrzymuje.
