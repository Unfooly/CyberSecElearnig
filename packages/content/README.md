# @cyberszkolo/content

Silnik interaktywnych szkoleń ("scen"): format modułu (JSON), walidacja (zod) i projekcja treści do klienta. Cel: kolejne moduły
szkoleniowe to wyłącznie treść (JSON + ilustracje + nagrania), bez kodu. Decyzje: `docs/decisions.md` D-051.

Część izomorficzna (`@cyberszkolo/content`, bez modułów Node) jest bezpieczna do importu w `apps/web`. Rzeczy wymagające Node
(`parseModule` i walidacja semantyczna, dopasowanie RE2 `compileAnswerRegex`, skrót treści `hashContent`) są w
`@cyberszkolo/content/dist/node` - NIE importować ich w `apps/web` (natywny moduł `re2`). Fixtury testowe: `@cyberszkolo/content/dist/fixtures`.

## Format modułu

```json
{
  "schemaVersion": 2,
  "slug": "sprawa-testowa",
  "title": "Sprawa testowa",
  "category": "EMAIL_SECURITY",
  "durationMinutes": 10,
  "mandatory": false,
  "blocks": [ { "id": "wideo", "type": "VIDEO", "url": "https://..." } ]
}
```

- `blocks[].id` jest stały i unikalny w module (klucz w postępie pracownika, notatkach i wersjach). Litery, cyfry, `-`, `_`; bez nazw z
  `Object.prototype` i `__proto__`.
- Każdy blok może mieć `title`, `narration { text, audioUrl, durationMs }`, `mascot { pose, text }` i `weight`.
- Ścieżki zasobów (`image`, `character.avatar`, `narration.audioUrl`) są WZGLĘDNE względem `CONTENT_BASE_URL`: bez schematu, hosta, `..` i
  ścieżki bezwzględnej (walidacja odrzuca `https://`, `//`, `javascript:`). `audioUrl` i `durationMs` występują razem, a `image`/`avatar`
  jest wersjonowaną nazwą (`nazwa.<hash8>.ext`) - oba wpisuje skrypt `scripts/content` (`npm run tts`, `--assets`), NIE autor ręcznie po
  pierwszej publikacji; autor podaje tylko oryginalną nazwę pliku (audio: tekst narracji; zasoby: nazwę w `assets/`). Pełny opis potoku,
  layout katalogów i lint SVG: `docs/content-pipeline.md` (D-060). Podpowiedzi (`hints[].narration`, pole `secret`) NIE dostają audio -
  zostają tekstowe (B-082).
- Schematy są `.strict()`: literówka w nazwie pola to błąd walidacji.
- **Ilustracje SVG wolno ładować WYŁĄCZNIE przez `<img>`** - nigdy inline, przez `<object>`/`<iframe>`, nawigację ani
  `dangerouslySetInnerHTML` (SVG może zawierać skrypty; w `<img>` się nie wykonują).
- `EMBEDDED_HTML` wykonuje dowolny JS: tylko w `<iframe sandbox>` BEZ `allow-same-origin` (dziś `allow-scripts allow-downloads`)
  i przy obowiązującym CSP; sprawdzenie tego to warunek PR 2 (odtwarzacz).

Typy bloków: dotychczasowe `VIDEO`, `QUIZ`, `BRANCHING_SCENARIO`, `DRAG_AND_DROP`, `EMBEDDED_HTML` oraz `SCENE_HOTSPOTS`, `DIALOGUE`,
`NOTEPAD`, `EMAIL_ANALYSIS`, `TEXT_INPUT_GUIDED`, `ORDERING`, `TABS`, `SUMMARY` (ostatni, co najwyżej jeden). Pełny wzór każdego typu:
`src/fixtures.ts` (`fullBlocks()`).

## Ocena i wynik

- Klient wysyła tylko swój wybór (indeks opcji, listę id, tekst). Poprawność i punkty (0-1) wylicza serwer (`apps/api/src/courses/scoring`).
- Wynik modułu = średnia ważona punktów bloków z wagą > 0. Domyślnie: `QUIZ`, `BRANCHING_SCENARIO`, `EMAIL_ANALYSIS`, `TEXT_INPUT_GUIDED`,
  `ORDERING` = 1; pozostałe (eksploracyjne) = 0 (wymagane do przejścia, poza wynikiem). Wagę można ustawić per blok.
- `EMAIL_ANALYSIS` i `ORDERING`: punkty częściowe (`scoring: "partial"`, domyślnie) albo wszystko-albo-nic (`"exact"`).
- `TEXT_INPUT_GUIDED`: `maxAttempts` (domyślnie 4), podpowiedzi po błędnych próbach (musi ich być mniej niż prób), punkty
  `max(floor, 1 - (próba - 1) * attemptPenalty)`; po wyczerpaniu prób 0 punktów i odsłonięcie `solution`.
  Odpowiedź porównywana po normalizacji (`normalize.trim`, `normalize.collapseWhitespace`); wielkość liter ignorowana, chyba że
  `answer.caseSensitive: true`. `answer.regex`: zapisany jako `^...$`, max 200 znaków, dopasowywany silnikiem **RE2** (czas liniowy,
  D-052) do całej odpowiedzi (max 500 znaków). Składnia ograniczona do tego, co RE2 obsługuje: **bez backreferencji (`\1`) i lookahead/
  lookbehind (`(?=`, `(?!`, `(?<=`)** - walidacja odrzuca je z komunikatem. Wzorce, które w zwykłym silniku powodują ReDoS
  (`^(a+)+$`), są tu bezpieczne.
- `ORDERING`: co najmniej 3 elementy. Klient nie zna id z treści: dostaje nieprzejrzyste, inne w każdym przypisaniu (dotyczy też
  `criteria` w `EMAIL_ANALYSIS`), więc nazwy id w JSON-ie (`krok1`, `poprawne-1`) nie zdradzają klucza.
- Bloki eksploracyjne (hotspoty, dialog, zakładki) wymagają odwiedzenia wskazanych elementów; to bramka UX (serwer sprawdza zgodność zgłoszonych
  id z treścią, nie faktyczne kliknięcia).

## Klucz odpowiedzi nie trafia do klienta (biała lista)

Do przeglądarki idzie wyłącznie wynik `toClientBlock`. Każde pole schematu bloku musi być w `FIELD_CLASSIFICATION` (`src/blocks.ts`) jako
`client` albo `secret`; test `classification.spec.ts` porównuje klasyfikację ze schematem, więc **nowe pole bez decyzji wywala CI**. Pole
sklasyfikowane jako `secret` (albo niesklasyfikowane) nigdy nie wychodzi. Dodatkowo: podpowiedzi zadania tekstowego zastępuje `hintCount`,
a kolejność `ORDERING`/`EMAIL_ANALYSIS` jest tasowana (seed z HMAC z kluczem serwera, patrz `apps/api/src/courses/client-view.ts`).

### Dodawanie nowego typu bloku

1. Schemat `.strict()` w `src/blocks.ts` (+ wpis w `BLOCK_SCHEMAS`, `blockSchema`, `DEFAULT_WEIGHT`).
2. `FIELD_CLASSIFICATION`: każde pole liściowe jako `client` albo `secret` (klucz odpowiedzi, podpowiedzi i rozwiązania to `secret`).
3. Walidacja relacji między polami w `validateBlockSemantics` (`src/semantics.ts`, tylko Node).
4. Fixtura w `src/fixtures.ts` wypełniająca WSZYSTKIE pola (test wycieku sprawdza po ścieżkach).
5. Ocena w `apps/api/src/courses/scoring/evaluate.ts` (+ testy) i, jeśli trzeba, transformacja w `toClientBlock`.

## Wersje treści

Zmiana treści kursu to NOWA wersja (`course_versions`, niemutowalna); przypisanie zostaje na wersji, na której zaczęło. Wersja 1
(`schemaVersion` 1) to treść sprzed silnika: bloki bez `id` dostają `b<indeks>`.

Import treści (PR 4) musi dla kursu BEZ wersji najpierw utworzyć wersję 1 z jego obecnej treści, dopiero potem dodać nową: rozpoczęte,
nieprzypięte przypisania rozwiązują się do najniższej wersji, więc bez wersji 1 trafiłyby na nową treść.
