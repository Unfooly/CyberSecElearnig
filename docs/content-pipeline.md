# Potok treści (audio narracji i zasoby modułów) - `scripts/content`

Narzędzie autora treści: generuje audio narracji (ElevenLabs, z timestampami) i publikuje zasoby modułów (obrazy scen, avatary
postaci) do magazynu obiektów (lokalny katalog do developmentu, Cloudflare R2 na produkcji). Decyzja: D-060.

**Kto uruchamia:** wyłącznie autor treści, na swojej maszynie. Klucze (ElevenLabs, R2) są TYLKO w `scripts/content/.env.local`
(poza gitem) - nigdy w repo, CI ani kontenerach. Aplikacja (`apps/api`, `apps/web`) nie zna żadnego z tych kluczy, zna wyłącznie
publiczny `CONTENT_BASE_URL` (origin magazynu; `.env.prod.example`, D-053).

`scripts/content` jest **osobnym projektem npm** (własny `package.json`, `package-lock.json`), NIE częścią workspace'ów
(`apps/*`, `packages/*`). Dzięki temu SDK Cloudflare R2 (`@aws-sdk/client-s3`) i klucze nigdy nie trafiają do lockfile'a
aplikacji ani do obrazów Docker. CI (`.github/workflows/build-images.yml`, krok „Testy scripts/content”) buduje
`packages/content`, potem `npm ci --prefix scripts/content`, typecheck i testy - **zero wywołań ElevenLabs/S3 w testach i w
CI**: oba klienty sieciowe są za interfejsami (`TtsProvider`, `ObjectStore`) i w testach zastąpione fake'ami; `vitest.setup.ts`
dodatkowo blokuje `fetch` i gniazda TCP, więc próba prawdziwego połączenia w teście kończy się czytelnym błędem, nie cichym
zawieszeniem.

## Instalacja i konfiguracja

```bash
npm ci --prefix scripts/content
cp scripts/content/.env.local.example scripts/content/.env.local
# wypełnij scripts/content/.env.local (poza gitem): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID i, dla --storage r2, R2_*
```

Tryby, które potrzebują kluczy i sieci (generowanie audio, `--storage r2`, `--assets` bez `--check`/`--dry-run`), **odmawiają
startu, gdy `CI` jest ustawione** (`assertNotCi`) - klucze nie mogą trafić na serwer CI nawet przez pomyłkę w konfiguracji.
`--check` i `--dry-run` są w pełni offline (nie czytają `.env.local`, nie tworzą klientów sieciowych) i działają wszędzie.

## Audio narracji (`npm run tts`)

```bash
npm run tts --prefix scripts/content -- <slug> [opcje]
```

| Opcja | Znaczenie |
|---|---|
| `--storage local\|r2` | Gdzie zapisać (domyślnie `local`: `apps/web/public/content`, serwowane przez Next). |
| `--version <v>` | Wersja partii audio w kluczu pliku (domyślnie `v1`); ostrzeżenie, gdy moduł ma już audio w innej wersji. |
| `--only <id,id>` | Tylko wskazane bloki (wymaga tych samych parametrów partii co istniejący `audio.lock.json`). |
| `--max-chars <n>` | Limit znaków do wygenerowania w jednym przebiegu (domyślnie 20 000). |
| `--yes` | Bez pytania o potwierdzenie. |
| `--dry-run` | Tylko plan (liczba narracji, znaki, szacowany czas) - bez sieci, kluczy i zapisów. |
| `--check` | Offline: czy nagrania odpowiadają aktualnym tekstom - bez kluczy i sieci (nadaje się do CI/pre-commit). |

**Co robi** (`scripts/content/src/pipeline.ts`): zbiera narracje modułu (`packages/content/modules/<slug>/module.json`),
liczy skrót wejścia (tekst, model, język, głos), sprawdza magazyn (HEAD) i generuje TYLKO to, czego brakuje. Kolejność jest
stałym kontraktem: **walidacja modułu -> plan -> limit znaków -> potwierdzenie -> dopiero wtedy pierwsze wywołanie
ElevenLabs.** Wynik (`audioUrl`, `durationMs`, `cues` z timestampów ElevenLabs, `eleven_multilingual_v2`, język `pl`) trafia do
`module.json` (walidowany schematem przed zapisem), a `audio.lock.json` obok (w repo, commitowany) pamięta skróty, głos i
wersję partii - dzięki temu `--check` działa offline i wykrywa narrację, której tekst zmieniono bez ponownego generowania.

Plik audio i sidecar (`<hash>.json`: `cues`, `durationMs`) są **niemutowalne** (nazwa zawiera skrót treści): zmiana tekstu
narracji publikuje nowy plik, stary zostaje w magazynie (starsze wersje kursu mogą na niego wskazywać, D-051). Sidecar z
magazynu jest danymi z zewnątrz - jego napisy muszą być dokładnym wynikiem lokalnego podziału na zdania (`splitSentences`,
ta sama funkcja co w odtwarzaczu, `apps/web/src/lib/narration-captions.ts`), inaczej cache jest odrzucany i narracja
generowana od nowa: to jedyna ochrona przed podmianą napisów przez kogoś z prawem zapisu do magazynu.

**Audio tylko dla pól `client`.** Podpowiedzi zadania tekstowego (`hints[].narration`) są polem `secret`
(`FIELD_CLASSIFICATION`, `packages/content/src/blocks.ts`) i celowo NIE dostają audio - trafiłyby do publicznego magazynu
razem z pełnym tekstem, z pominięciem `maxAttempts` i stopniowego ujawniania w API. `assertNarrationPathsClassified` wiąże
listę pól z audio z klasyfikacją przy każdym uruchomieniu (fail-closed: nowe pole narracji w schemacie bez decyzji tutaj to
błąd, nie ciche audio). Backlog B-082: audio podpowiedzi przez API po odblokowaniu (podpisany URL).

Manifest partii (`audio/<slug>/<wersja>/manifest.json`, publiczny, mutowalny) zawiera WYŁĄCZNIE listę kluczy plików - żadnych
ścieżek pól (mapowanie narracja -> plik trzyma tylko `module.json` i `audio.lock.json` w repo).

## Zasoby modułu (`npm run tts -- <slug> --assets`)

```bash
npm run tts --prefix scripts/content -- <slug> --assets [--storage local|r2] [--only id,id] [--dry-run] [--check]
```

Nie wymaga kluczy ElevenLabs. Publikuje obrazy scen (`image`) i avatary postaci (`character.avatar`) -
jedyne dwa pola-ścieżki zasobów w schemacie treści, oba `client` (`assertAssetPathsClassified` pilnuje tego samo tak, jak
`assertNarrationPathsClassified` dla audio).

**Układ katalogów:** autor trzyma pliki źródłowe w `packages/content/modules/<slug>/assets/<nazwa>.<ext>` (dozwolone
rozszerzenia: `png`, `jpg`, `jpeg`, `webp`, `avif`, `svg`, jak w schemacie treści), a pole w `module.json` wskazuje tę nazwę
(np. `"image": "office.svg"`). Skrypt liczy skrót TREŚCI pliku (8 znaków hex), publikuje pod wersjonowaną, niemutowalną
nazwą `assets/<slug>/<ścieżka>/<nazwa>.<hash8>.<ext>` i **podmienia pole w `module.json` na ten klucz**; `assets.lock.json`
obok pamięta oryginalną nazwę źródłową, więc kolejne przebiegi nadal znajdują plik w `assets/` (autor nigdy go nie
przenosi ani nie zmienia ręcznie po pierwszej publikacji). Zmiana treści pliku pod tą samą nazwą publikuje nowy klucz - stary
zostaje w magazynie (jak audio).

**Lint SVG** (`svg-lint.ts`) przed publikacją każdego pliku `.svg`: zakaz `<script>`, atrybutów `on...=`, `<foreignObject>`,
adresu `javascript:` (także ukrytego numeryczną encją znaku, np. `&#106;avascript:`, i pod prefiksem przestrzeni nazw, np.
`<x:script>`), oraz `<use href>`/`<image href>` wskazujących na zewnętrzny host (dozwolone: fragment w tym samym pliku,
`data:` URI). Plik musi być ścisłym UTF-8 (odrzucany m.in. plik zakodowany jako UTF-16 z BOM, który czytany bajt-po-bajcie
jako UTF-8 rozbiłby wzorce regexów). To trzecia linia obrony (klient renderuje SVG WYŁĄCZNIE przez `<img>`, silnik szkoleń
pkt 4 w CLAUDE.md - `<img>` nie wykonuje `<script>` ani `on*=`); druga linia to nagłówki na `content.unfooly.com` (patrz niżej).
Lint sprawdza wzorce na tekście, nie jest parserem XML - ograniczenia i pełne zamknięcie: backlog B-084 (P3, D-058).

## Cloudflare R2 (`--storage r2`)

Bucket `unfooly-content` (region EEUR), publiczna domena `content.unfooly.com`, S3 endpoint
`https://<account-id>.r2.cloudflarestorage.com`. Token dostępu: **Object Read & Write ograniczony do jednego bucketa**
(nigdy klucz kontowy). `R2Store` (`stores/r2.ts`) używa wyłącznie `HeadObject`/`GetObject`/`PutObject` - nigdy `DeleteObject`
(usuwanie starych plików to świadoma, osobna decyzja operatora, nie efekt uboczny skryptu).

**Wdrożenie (jednorazowo, w panelu Cloudflare):**

1. Utwórz bucket `unfooly-content` (region EEUR) i włącz publiczną domenę `content.unfooly.com` (R2 → bucket → Settings →
   Public access → Custom domain).
2. Utwórz token API R2: **Object Read & Write**, ograniczony do bucketa `unfooly-content`. Wpisz `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=unfooly-content`, `R2_ENDPOINT` do `scripts/content/.env.local`
   autora treści (poza gitem) - **nigdzie indziej**.
3. **Response Header Transform Rule** dla `content.unfooly.com` (Rules → Transform Rules → Modify Response Header), dla
   WSZYSTKICH odpowiedzi: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` oraz
   `X-Content-Type-Options: nosniff`. To WŁAŚCIWA druga linia obrony lintu SVG: nawet gdyby ktoś otworzył klucz R2 wprost
   jako dokument najwyższego poziomu (nie przez `<img>`), `sandbox` w CSP i `nosniff` uniemożliwiają wykonanie skryptu i
   wymuszają zadeklarowany `Content-Type` (ustawiany przez skrypt przy publikacji, patrz niżej).
4. Ustaw `CONTENT_BASE_URL=https://content.unfooly.com` w `.env.prod` (aplikacja; `.env.prod.example`, D-053) - to jedyne,
   co serwer wie o R2.

**Nagłówki obiektów** (ustawiane przez skrypt przy `PutObject`, nie w Cloudflare): pliki z hashem w nazwie (audio, sidecary,
zasoby) - `Cache-Control: public, max-age=31536000, immutable`; manifest - `Cache-Control: no-cache`. `Content-Type`:
`audio/mpeg` (audio), `application/json` (sidecar, manifest), `image/svg+xml` / `image/png` / `image/jpeg` / `image/webp` /
`image/avif` (zasoby, wg rozszerzenia pliku źródłowego).

## Znane ograniczenia

- Retry po timeout ElevenLabs (co najwyżej jedno ponowienie) nie jest wliczane w `--max-chars`: bardzo rzadko realny koszt
  może nieznacznie przekroczyć limit z podsumowania.
- `language_code` nie jest wysyłany do ElevenLabs dla `eleven_multilingual_v2` (model sam rozpoznaje język z tekstu).
- Lint SVG to regexy na tekście, nie parser XML - zakres i plan zamknięcia: B-084.
