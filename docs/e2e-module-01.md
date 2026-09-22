# E2E: pełne przejście modułu 1 ("Sprawa: wyłudzone hasło", przeglądarka)

## Automatyczny scenariusz (Playwright)

`scripts/e2e-module-01.mjs` importuje PRAWDZIWY moduł (`packages/content/modules/wyludzone-haslo/module.json`) przez
PRAWDZIWY skrypt importu (`apps/api/dist/scripts/content-import.js`, ta sama ścieżka co produkcja - D-051 pkt 11), a
potem przechodzi w prawdziwej przeglądarce wszystkie 9 bloków, zbierając komplet dowodów i odpowiadając poprawnie:

1. NARRATIVE (otwarcie): pogrubienie w treści renderuje się jako `<strong>` (nie dosłowne `**`), poza spoczynkowa
   maskotki z treści bloku,
2. SCENE_HOTSPOTS (biuro Anny): `reactions.complete` po 4 wymaganych punktach, 5 dowodów w notatniku,
3. DIALOGUE (Anna): `character.opening` przed pierwszym pytaniem, `reactions.complete` po 3 wymaganych pytaniach,
4. EMAIL_ANALYSIS (waga 3): pole `email.to` ("Do:") w makiecie, 5 poprawnych kryteriów -> 100%, reakcja `cheer`,
5. TABS (akta sprawy): pogrubienie, `` `kod` `` (`<code>`) i lista wypunktowana w treści zakładek,
6. DIALOGUE (Marek): jak (3),
7. ORDERING (waga 2): pełna poprawna kolejność (klawiatura, przyciski góra/dół) -> reakcja `cheer`,
8. TEXT_INPUT_GUIDED (waga 1): poprawna odpowiedź za pierwszym razem -> reakcja `cheer`, pełne punkty,
9. SUMMARY: 15 z 15 dowodów, numerowana lista renderuje się jako `<ol>`, ukończenie kursu ze 100% wyniku
   (średnia ważona 3+2+1, wszystko poprawne).

Rejestracja/aktywacja organizacji NIE jest tu powtarzana (pełna ścieżka: `docs/e2e-registration.md`) - organizację
ACTIVE i pracownika skrypt tworzy wprost przez Prisma, żeby skupić się na odtwarzaczu i treści modułu.

Uruchomienie (lokalny Postgres z opublikowanym portem, migracje zastosowane - `npx prisma migrate deploy
--schema=apps/api/prisma/schema.prisma`):

```bash
npm run build --workspace=packages/content
npm run build --workspace=apps/api
npx dotenv -e .env -- node scripts/e2e-module-01.mjs
```

**Uwaga:** skrypt używa bazy z lokalnego `.env` i tworzy w niej dane (organizację, pracownika, zaimportowany kurs) -
uruchamiaj go wyłącznie na środowisku deweloperskim, nigdy z `.env` wskazującym produkcję. Sprząta po sobie w
`finally` (usuwa organizację i kurs po `id`).

Skrypt sam startuje API (`:3111`) i web (`:3110`, przez `next dev` - patrz „Znane ograniczenia” niżej), używa bazy
z `.env`. Porty zmienisz zmiennymi `E2E_API_PORT` / `E2E_WEB_PORT`.

## Znane ograniczenia

- **Web startuje przez `next dev`, nie `next start`.** `next start` twardo ustawia `NODE_ENV=production` wewnątrz
  CLI (nie da się tego nadpisać zmienną środowiskową procesu), więc cookies `access_token`/`refresh_token`
  (`apps/web/src/lib/auth-cookies.ts`) dostają `Secure` - przeglądarka je przechowuje, ale nigdy nie wysyła bez TLS,
  więc każde żądanie do BFF kończy się 401 mimo poprawnego zalogowania (zweryfikowane empirycznie przy pisaniu tego
  skryptu). `next dev` nie ma tego problemu i dodatkowo kompiluje z `apps/web/src` na bieżąco (bez wymogu
  wcześniejszego `next build`), więc skrypt zawsze testuje najnowszy kod. Skutek uboczny (CSP z `unsafe-eval`/
  WebSocket, D-053 pkt 5) nie ma znaczenia: ten skrypt nie sprawdza nagłówków CSP - to robi
  `scripts/e2e-registration.mjs` (uruchamiany przez `next start`, jak w produkcji).
- Nie sprawdza publikacji zasobów do R2 ani prawdziwego audio (narracja) - tylko lokalny import treści do bazy i
  odtwarzacz. Assety (`scenes/`, `avatars/`) muszą być już opublikowane lokalnie (`npm run tts --prefix
  scripts/content -- wyludzone-haslo --assets --storage local`, patrz `docs/content-pipeline.md`) - w tym repo są
  już częścią `apps/web/public/content` (commit z modułem 1).
