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
- Każdy blok może mieć `title`, `narration { text, audioUrl, durationMs }`, `tip` (stała podpowiedź - sam tekst w dymku odtwarzacza,
  pole `client`, **publiczne od `/start` - nigdy odpowiedź ani wskazówka do niej**; nie mylić z sekretnymi `hints` zadania tekstowego;
  dozwolone w każdej `schemaVersion`) i `weight`. `mascot { pose, text }` i `pose` w `reactions` są
  przestarzałe (D-096): nadal przechodzą walidację (starsze wersje treści), import wypisuje ostrzeżenie, odtwarzacz czyta tylko tekst.
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
`NOTEPAD`, `EMAIL_ANALYSIS`, `TEXT_INPUT_GUIDED`, `ORDERING`, `TABS`, `NARRATIVE` (v4), `BRIEFING` (v5), `DOSSIER` (v5), `SUMMARY` (ostatni, co najwyżej
jeden). Pełny wzór każdego typu: `src/fixtures.ts` (`fullBlocks()`).

### schemaVersion 5: odprawa (`BRIEFING`) i zadania (D-081)

- `BRIEFING`: `steps[]` (1-8) zamkniętego typu `kind`: `typewriter { text, sub?, cta }`, `call { caller { name, role?, avatar? },
  text, cta }` (postać; bez maskotki), `caseFile { caseNo, title, fields[{ label, value }], stamp?, cta }`, `badge { cta }`,
  `start { text, cta }` (miejsce akcji na koniec odprawy). Każdy krok może mieć własne
  `narration` (TTS jak dziś; wpis w `audio.lock.json`: `<blockId>#steps.<N>.narration`). Nieoceniany, bez dowodów; zaliczany
  „Dalej” w dolnym pasku odtwarzacza, aktywnym na ostatnim kroku (po akcji na jego przedmiocie, jeśli go ma) albo po „Pomiń odprawę”
  (przeskok na ostatni krok) - D-106. Krok `badge` nie ma w treści żadnych danych gracza: imię, avatar i numer odznaki liczy
  wyłącznie klient z sesji (nigdy `module.json` ani `progress`).
- Grafika kroku (D-084, opcjonalna): `image` (scena, plik z `assets/`, potok `--assets`; animacje CSS w SVG zatrzymuje odtwarzacz
  fragmentem `#static` przy reduced-motion), `hotspot { id, x, y, w, h }` (przedmiot kroku - D-086: przejście do kolejnego kroku, przycisk
  z etykietą `cta`; na ostatnim kroku to akcja aktywująca „Dalej” w pasku, D-106; krok ze sceną bez `hotspot` ma przycisk cta pod
  sceną - poza ostatnim krokiem, który nie ma przycisku, więc jego `cta` bez `hotspot` nie jest wyświetlany), `slots { tasks?, name?, number?, photo? }`
  (prostokąty na HTML: `tasks` tylko w caseFile z `tasks`, reszta tylko w badge), w caseFile także `closedImage` (zamknięta teczka,
  wymaga `hotspot`, klik otwiera `image`) i `openHotspot { id, x, y, w, h }` (D-086: przedmiot otwartych akt = `cta`, wymaga
  `closedImage`). Prostokąty w % sceny, w jej granicach; każde z tych pól wymaga `image`. Krok bez `image`
  wygląda jak dotąd (karta na jasnym tle). W scenie nie są używane `caller.avatar` (postać jest w grafice) ani avatar gracza
  (w slocie `photo` są jego inicjały). Wariant pionowy (D-098, opcjonalny): `portrait { image, closedImage?, hotspot?, openHotspot?,
  slots? }` - te same pola w % pionowej sceny (9:16, telefon w pionie: kontener sceny o proporcjach < 0.8); musi mieć dokładnie te
  same przedmioty, fazy teczki i sloty co scena pozioma (inaczej w pionie zniknęłoby przejście dalej albo dane gracza). Bez `portrait` -
  scena 16:9 w pasach.
- Miniatura modułu (D-084, opcjonalna): `thumbnail` na poziomie modułu - obraz 16:9 z `assets/` (potok `--assets`, klucz locka
  `module#thumbnail`), zapisywany przez import w `courses.thumbnail` i pokazywany na kartach katalogu i „moich kursów”.
- Zadania sprawy: `caseFile.tasks[] { id, text, completeWhen: blockId[] }` - lista pod kartą sprawy w odprawie i sekcja „Zadania” w
  notatniku (czytana z bloku BRIEFING bieżącej wersji treści). Klient odhacza zadanie, gdy wszystkie bloki z `completeWhen` są
  ukończone (to nie ocena). `completeWhen` wskazuje istniejące bloki modułu, nigdy `BRIEFING` (pominięcie odprawy nie odhacza
  zadań). Cele szkoleniowe modułu (`objectives[]`) zostają listą tekstów (katalog kursów), jak w v4.
- `narration.voice` (D-082): rola głosu nagrania - `narrator` (domyślnie), `komisarz`, `bank`, `marek` (`VOICE_ROLES`); pole tylko dla
  skryptu TTS (nie idzie do klienta). Mapowanie rola -> voiceId: `scripts/content/voices.json` (`docs/content-pipeline.md`, „Głosy”).
- Media obrazu hotspotu (`kind: "image"`): opcjonalne `imagePortrait` (D-104) - wariant dla telefonu w pionie (np. okno maila z dużym,
  zawijanym tekstem; kompozytor `mailWindowPortrait`/`browserHistoryPortrait` + `crop-zooms`), wspólne `alt`.
- Media audio hotspotu: `audioUrl` + `transcript` (gotowy plik z `--assets`) ALBO `narration` (nagranie z potoku TTS, zwykle z
  `voice`; transkrypcją jest `narration.text`) - dokładnie jedno z nich.
- Easter egg (D-100): `media.kind: "popups"` (hotspot na zewnątrz albo w scenie zagnieżdżonej) - `items[]` (1-5) `{ title, body, button,
  behavior?: "dodge" | "none", countdown?: "GG:MM:SS" }`, `outro`, `badge? { id, label }`. Komiksowe okienka zamykane krzyżykiem, po
  nich `outro` i ukryte wyróżnienie w notatniku. To nie dowód: bez `evidence`/`note`, nigdy `required: true` i poza pulą wymaganych
  (także w domyślnym „wszystkie”). Serwer zapisuje przy ukończeniu bloku tylko flagę wyróżnienia (`progress.blocks[].easterEggs`, widok
  klienta `progress.distinctions`) - bez punktów, dowodów i XP. Wszystkie pola publiczne. `badge.id` unikalne w bloku, `requiredHotspots`
  nie może wskazać takiego hotspotu. `content` hotspotu z okienkami (wymagany w scenie zagnieżdżonej) nie jest wyświetlany.
- `DOSSIER` (D-083): teczka sprawy - `stamp?` (pieczątka), `documents[]` (1-6) `{ id, tab, org, title, meta?, columns[] (1-4),
  rows[] (1-30) { id, cells[] (tyle, ile kolumn), evidence?, note?, required? } }`. Wiersz-dowód (`evidence` + `note`) zakreśla się i
  trafia do notatnika, zwykła linijka pokazuje tylko „Ta linijka wygląda na zwykłą operację.”. Id dokumentów i wierszy unikalne w
  całym bloku (klucz notatki `<blockId>.<rowId>`), `note`/`required` tylko na dowodzie, najwyżej `MAX_DOSSIER_EVIDENCE` (50) dowodów.
  Nieoceniany (waga 0), wszystkie pola publiczne (bez klucza odpowiedzi, jak `evidence`/`note` scen). Odpowiedź
  `{ opened, noted }`: wszystkie dokumenty otwarte, wszystkie `required` zakreślone (sprawdza serwer, `evaluate.ts`).
- `SUMMARY` - zamknięcie sprawy (D-089, opcjonalne): `lessons[]` (1-5 zdań, ≤120 znaków; wnioski śledczego w raporcie) i
  `closing { image, stamp, note, slots { evidence, time, xp, lessons, signature, stamp, note } }` - raport 16:9, pieczęć i liścik z
  `assets/` (potok `--assets`), sloty `{ x, y, w, h }` w % raportu, w jego granicach. Wszystko publiczne (podsumowanie, nie klucz).
  Bez `closing` odtwarzacz pokazuje prosty ekran ukończenia. `closing.portrait { image, slots }` (D-098, opcjonalne): raport 9:16 dla
  telefonu w pionie z kompletem slotów (pieczęć i liścik te same pliki); bez niego telefon pokazuje panoramę raportu 16:9.

### Markdown w treści (TABS/SUMMARY/NARRATIVE `text`, TABS `tabs[].content`; teksty kroków BRIEFING to zwykły tekst)

Renderer po stronie klienta (`apps/web/src/app/courses/[courseId]/_components/simple-markdown.tsx`) obsługuje ZAMKNIĘTY,
wąski podzbiór: pogrubienie (`**tekst**`), kod (`` `tekst` ``), listy wypunktowane (`- `/`* `) i numerowane (`1. `, `2. `),
akapity (pusta linia). CELOWO bez HTML i bez linków (`<b>`, `[x](y)` wychodzą jako dosłowny tekst, nawet wewnątrz kodu -
`dangerouslySetInnerHTML` nigdy nie jest używane). Autor treści pisze WYŁĄCZNIE w tym podzbiorze - inny element markdown
(nagłówki `#`, cytaty `>`, tabele, zagnieżdżone listy) wyjdzie na ekranie dosłownie, nie jako sformatowany element.
Potrzeba nowego elementu to **pytanie do właściciela produktu** (rozszerzenie renderera, osobny mały commit z testem -
patrz `docs/decisions.md`), nie powód do improwizowania treści bez formatowania albo z inną składnią.

## Ocena i wynik

- Klient wysyła tylko swój wybór (indeks opcji, listę id, tekst). Poprawność i punkty (0-1) wylicza serwer (`apps/api/src/courses/scoring`).
- Wynik modułu = średnia ważona punktów bloków z wagą > 0. Domyślnie: `QUIZ`, `BRANCHING_SCENARIO`, `EMAIL_ANALYSIS`, `TEXT_INPUT_GUIDED`,
  `ORDERING` = 1; pozostałe (eksploracyjne) = 0 (wymagane do przejścia, poza wynikiem). Wagę można ustawić per blok.
- `EMAIL_ANALYSIS` i `ORDERING`: punkty częściowe (`scoring: "partial"`, domyślnie) albo wszystko-albo-nic (`"exact"`).
- `TEXT_INPUT_GUIDED`: `maxAttempts` (domyślnie 4), podpowiedzi po błędnych próbach (musi ich być mniej niż prób), punkty
  `max(floor, 1 - (próba - 1) * attemptPenalty)`; po wyczerpaniu prób 0 punktów i odsłonięcie `solution`. Opcjonalne
  `frame: "browser"` (D-094, pole `client`, czysto wizualne): pole jako pasek adresu w oknie przeglądarki, zła próba jako komunikat w
  oknie, po rozstrzygnięciu ostrzeżenie „Ta strona podszywa się pod bank” (stały tekst odtwarzacza, bez formularzy) - dla zadań „wpisz
  fałszywą domenę **banku**”. Innego scenariusza (np. fałszywe logowanie do poczty) nie oprawiaj tak bez B-118 (tekst ostrzeżenia z treści).
  Odpowiedź porównywana po normalizacji (`normalize.trim`, `normalize.collapseWhitespace`); wielkość liter ignorowana, chyba że
  `answer.caseSensitive: true`. `answer.regex`: zapisany jako `^...$`, max 200 znaków, dopasowywany silnikiem **RE2** (czas liniowy,
  D-052) do całej odpowiedzi (max 500 znaków). Składnia ograniczona do tego, co RE2 obsługuje: **bez backreferencji (`\1`) i lookahead/
  lookbehind (`(?=`, `(?!`, `(?<=`)** - walidacja odrzuca je z komunikatem. Wzorce, które w zwykłym silniku powodują ReDoS
  (`^(a+)+$`), są tu bezpieczne.
- `ORDERING`: co najmniej 3 elementy. Klient nie zna id z treści: dostaje nieprzejrzyste, inne w każdym przypisaniu (dotyczy też
  `criteria` w `EMAIL_ANALYSIS`), więc nazwy id w JSON-ie (`krok1`, `poprawne-1`) nie zdradzają klucza. Opcjonalnie (D-088, tablica
  śledcza) `start` i `end` `{ label, caption }` - „zdjęcia” na początku i końcu łańcucha (np. ofiara i strata); pola `client` -
  pamiętaj, że gracz je widzi: parafraza pierwszego/ostatniego kroku podpowiada jego pozycję.
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

## Katalog modułu (`packages/content/modules/<slug>/`)

Każdy moduł ma **dwa pliki, w tej kolejności powstawania**:

1. **`SCENARIUSZ.md`** - źródło prawdy o treści: fabuła, postaci, dialogi, treść maila, pytania, oceny, reakcje maskotki. Pisze go
   (albo dostarcza) właściciel produktu, PRZED `module.json`.
2. **`module.json`** - wierne odwzorowanie `SCENARIUSZ.md` na schemat silnika. Tam, gdzie schemat czegoś nie przewiduje (np. pole
   wymagane przez zod, którego scenariusz nie precyzuje wprost), agent ZGŁASZA rozjazd i pyta - nie improwizuje po cichu treści,
   której nie ma w scenariuszu.

Opcjonalnie `assets/` (surowe źródła obrazów/avatarów przed publikacją - `docs/content-pipeline.md`) i, po publikacji,
`assets.lock.json`/`audio.lock.json` (generowane przez `scripts/content`, nie edytować ręcznie).
