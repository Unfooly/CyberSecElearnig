# Playbook modułu szkoleniowego

Jak zbudować moduł-śledztwo od zera, na wzór modułu 1 („Wyłudzone hasło”, `packages/content/modules/wyludzone-haslo`). Ten plik
to przewodnik i lista kontrolna; szczegóły formatu są w `packages/content/README.md`, potok nagrań i zasobów w `docs/content-pipeline.md`,
klocki i kompozytor scen w `scripts/content/scenes/README.md`, zachowanie odtwarzacza w `docs/course-player.md`, a uzasadnienia w
`docs/decisions.md` (tu tylko odnośniki D-xxx - nie powtarzamy decyzji). Reguły treści z tego pliku (dowody, nazwy, zakazy) to D-108.

Zasady z tego pliku obowiązują każdy nowy moduł i każdą zmianę treści albo grafik istniejącego.

> **Narzędzia weryfikacji przyjmują slug modułu** (B-128): źródła scen w `scripts/content/scenes/examples/<slug>/` (test scen obejmuje
> nowy katalog sam), harness odtwarzacza i katalogu `?module=<slug>` (zasoby `/dev/module-assets/<slug>/…`), layout-check
> `LAYOUT_CHECK_MODULE=<slug>` (sekcja `module`: każdy blok na 4 rozdzielczościach + pion), e2e smoke `node scripts/e2e-module.mjs <slug>`
> (import → logowanie → katalog → pierwszy ekran odtwarzacza). Pełne przejście treści to osobny skrypt modułu na wzór `e2e-module-01.mjs`.
> Kolejność: najpierw szkielet `module.json` (test scen wymaga go dla każdego katalogu `scenes/examples/<slug>/`), potem sceny.

## 1. Kolejność pracy

1. **Scenariusz** (`SCENARIUSZ.md`) - fabuła, postaci, oś czasu, teksty, dowody, pytania i oceny. Pisze go (albo zatwierdza) właściciel
   produktu, PRZED `module.json` (README treści, „Katalog modułu”).
2. **Mapowanie na schemat** (`module.json`) - wierne odwzorowanie scenariusza. Czego schemat nie przewiduje, to się zgłasza, a nie
   improwizuje.
3. **Grafiki** - sceny z kompozytora (rozdział 6), publikacja `--assets`.
4. **Nagrania** - lektor i role (rozdział 7), publikacja `tts`.
5. **Weryfikacja** - walidacja modułu, testy, layout-check, e2e (rozdział 10), PR.

## 2. Struktura katalogu

```
packages/content/modules/<slug>/
  SCENARIUSZ.md          źródło prawdy o treści (oś czasu, dialogi, dowody, oceny)
  module.json            treść dla silnika (walidowana: zod + semantics.ts)
  assets/
    scenes/              sceny SVG z kompozytora (wynik build - nie edytuj ręcznie); *.hotspots.json tylko dla scen z --module
    avatars/             avatary postaci (SVG)
    miniatura-<slug>.svg miniatura modułu (pole `thumbnail`)
  assets.lock.json       generowany przez --assets (nie edytuj ręcznie)
  audio.lock.json        generowany przez tts (nie edytuj ręcznie)
scripts/content/scenes/examples/<slug>/   źródła scen modułu (<scena>.json) i kanoniczne <scena>.hotspots.json (achievements/ - trofea)
```

`module.json` przechowuje w polach grafik i nagrań klucze opublikowanych plików (`assets/<slug>/scenes/<nazwa>.<skrót>.svg`); przy nowym
zasobie wpisz ścieżkę źródłową (`scenes/<nazwa>.svg`) - `--assets` podmieni ją na klucz i dopisze wpis w `assets.lock.json`. Potok zna pola
z plikami z RĘCZNEJ listy `ASSET_PATHS` (`scripts/content/src/assets.ts`) - nowe pole schematu z plikiem trzeba tam dopisać (z testem w
`assets.test.ts`). `steps[].caller.avatar` (avatar dzwoniącego w odprawie) jest na liście od B-128; moduł 1 go nie używa (inicjały).

Metadane modułu (v5): `slug`, `title`, `subtitle`, `category`, `level`, `durationMinutes`, `mandatory`, `objectives[]`, `thumbnail`.
`objectives` to cele szkoleniowe w katalogu kursów - co innego niż zadania sprawy (`caseFile.tasks` w odprawie, D-081).

## 3. Oś czasu jest źródłem prawdy

Wszystko, co gracz może porównać - godziny w mailu, logach, historii przeglądarki, wydruku, kalendarzu i w rozmowach - wynika z JEDNEJ
osi czasu zapisanej w metadanych `SCENARIUSZ.md` (moduł 1: mail 8:47 → hasło 8:58 → SMS logowania 9:02 → logowanie oszusta 9:03 → nowy
odbiorca 9:04 → telefon „informatyka” 9:05 → SMS autoryzacji 9:06 → przelew 9:12; śledztwo 9:40 / 10:05; D-095).

- Najpierw oś czasu, potem teksty. Zmiana godziny = zmiana w scenariuszu i we WSZYSTKICH miejscach, które ją pokazują (grafiki też -
  przebudowa sceny i ponowna publikacja).
- Wpis, którego fabuła nie dopuszcza (np. aktywność ofiary po tym, jak wyszła od biurka), to błąd - przykład poprawki w D-094.
- Ślady na tablicy śledczej (ORDERING) są w treści bez godzin (D-108): scenariusz może je podawać autorowi, ale z godzinami na kartach
  rekonstrukcja byłaby odczytem zegara.

## 4. Schemat v5 i typy bloków

Moduł-śledztwo ma `schemaVersion: 5`. Wspólne dla bloków: `id` (kebab-case, stały po publikacji - postęp jest kluczowany id), `title`,
`tip` (stała podpowiedź w dymku, bez maskotki - D-093, D-096), `reactions` (`complete` dla eksploracyjnych, `result` dla ocenianych;
sam `text` - D-061, D-096), `narration` (rozdział 7), `weight` (> 0 tylko w blokach ocenianych). Odpowiedzi ocenia wyłącznie serwer, a
klucz odpowiedzi nigdy nie trafia do klienta (`FIELD_CLASSIFICATION`, CLAUDE.md „Silnik szkoleń”) - każde nowe pole schematu musi być
sklasyfikowane jako `client` albo `secret`.

**Nawigacja:** jedynym przejściem dalej jest „Dalej” w dolnym pasku odtwarzacza (D-106). Bloki nie mają przycisków dalej - akcje w bloku
(sprawdzenie, drzwi, przedmiot ostatniego kroku odprawy) tylko zgłaszają gotowość. Nie projektuj treści, która wymaga przycisku dalej.

| Blok | Do czego | Najważniejsze pola | Decyzje |
|---|---|---|---|
| `BRIEFING` | odprawa na start: telefon, rozmowa, teczka z zadaniami, legitymacja gracza, ekran startu | `steps[]` (`typewriter`, `call` z `caller`, `caseFile` z `tasks[]` i `completeWhen`, `badge`, `start`); krok może mieć `image`, `hotspot` (przedmiot kroku), `slots`, w `caseFile` dwie fazy `closedImage` + `openHotspot`, oraz `portrait` (wariant 9:16) | D-081, D-084, D-086, D-098, D-106 |
| `SCENE_HOTSPOTS` | scena z przedmiotami; klik = zbliżenie z „Zabierz”/„Odłóż” | `image`, `hotspots[]` (`required`, `evidence`, `note`, `media`: `image` / `audio` / `document` / `scene` - pulpit w monitorze / `popups` - easter egg), `action: "next"` (drzwi) | D-071, D-086, D-100–D-104, D-106 |
| `DOSSIER` | teczka sprawy: przekładki z dokumentami, zakreślanie wierszy-dowodów | `documents[]` (`tab`, `org`, `title`, `meta`, `columns[]`, `rows[]` z `cells[]`); wiersz-dowód: `evidence`, `note`, `required`; zwykły wiersz może mieć własny `message`; najwyżej 50 wierszy-dowodów (`MAX_DOSSIER_EVIDENCE`) | D-083 |
| `DIALOGUE` | rozmowa jak w komunikatorze (pytania-chipy, „pisze…”) | `character`, `character.opening`, `questions[]` (`required`, `evidence`, `lines[]`) | D-079, D-087, D-097 |
| `EMAIL_ANALYSIS` | makieta maila, gracz zaznacza oznaki phishingu (oceniany) | `email` (nadawca, `to`, data, temat, załącznik, treść), `criteria[]` (`target` - fragment w mailu, `correct`, `explanation`; dowód tylko przy `correct`) | D-056, D-057 |
| `ORDERING` | tablica śledcza: ślady na pola w kolejności (oceniany) | `items[]` (bez godzin), `start`/`end` (zdjęcia początku i końca łańcucha) | D-088, D-105 |
| `TEXT_INPUT_GUIDED` | zadanie z wpisaniem odpowiedzi, podpowiedzi po złych próbach (oceniany) | `answer.accept[]` / `answer.regex` (sekret, RE2 - D-052), `hints`, `maxAttempts`, `solution`, `frame: "browser"` (okno przeglądarki z paskiem adresu) | D-052, D-094 |
| `SUMMARY` | rozwiązanie sprawy i ekran zamknięcia | `text`, `lessons[]`, `closing` (raport, pieczęć, liścik, `slots`, `portrait`) | D-089, D-098, D-107 |
| `NARRATIVE` | krótki tekst narracyjny między scenami | `title`, `text` | D-061 |

Okienka easter egga (`media.kind: "popups"`) nie są dowodem ani warunkiem ukończenia i nie zmieniają XP (D-100). Zbliżenia i okna z
drobnym tekstem mają wariant pionowy `imagePortrait` (rozdział 6).

## 5. Dowody (D-108)

- Dowód to element z `evidence: true` (przedmiot sceny, pytanie rozmowy, kryterium maila, wiersz teczki). Każdy dowód MUSI mieć `note`
  z `kind` (ikona w notatniku) - walidacja (`semantics.ts`).
- **N (liczba dowodów) liczy serwer z treści** - nie wpisuje się jej nigdzie ręcznie. Wypisz w scenariuszu, ile dowodów jest w każdym
  bloku i łącznie (moduł 1: 23), bo ta liczba pojawia się w licznikach, na rozwiązaniu sprawy i w raporcie zamknięcia.
- **Wymagane a opcjonalne:** `required` wyznacza ukończenie bloku, nie dowód. Dowód może być opcjonalny (tablica w korytarzu, historia
  przeglądarki - D-094), a przedmiot wymagany nie musi być dowodem.
- **Bez duplikatów:** jeden fakt = jeden dowód w całym module. Ten sam trop pokazany w dwóch miejscach to dwa RÓŻNE dowody tylko wtedy,
  gdy wnoszą inną informację (mail: nadawca; historia przeglądarki: o 8:58 wejście na stronę) - inaczej jeden z nich jest zwykłym
  elementem albo ma własny komunikat (`message`, jak wiersz przelewu 9:12 w teczce).
- Przedmiot ze sceną zagnieżdżoną (`media.kind: "scene"`) nie jest dowodem - dowody są w jego scenie. Kryterium maila może być dowodem
  tylko, gdy jest poprawne.
- Worki z dowodami na raporcie zamknięcia to etykiety grafiki raportu - przygotuj je razem z listą dowodów (D-107).

## 6. Grafiki

Wszystkie sceny powstają w kompozytorze (`scripts/content/scenes`) z klocków w płaskim stylu Unfooly - bez ręcznego rysowania i bez
cudzych grafik. Klocek = funkcja w `props.ts` / `props-odprawa.ts`, wpis w `PROPS` i wiersz w README kompozytora.

- **Rozmiary:** sceny z przedmiotami 1600×1000, odprawa i raport 1600×900, warianty pionowe 900×1600, miniatura 1600×900 (16:9).
  Zbliżenia i ekrany (po `crop-zooms` / `wrap-in-monitor`) mają rozmiar z kadru (np. pulpit 1332×1022) - nie wymuszaj 1600×1000.
- **Build:** `npx tsx scenes/cli.ts build scenes/examples/<slug>/<scena>.json --out <katalog>` zapisuje SVG i `<scena>.hotspots.json` do
  katalogu `--out`. Kanoniczny `hotspots.json` leży w `scenes/examples/<slug>/` (z nim porównuje `odprawa.test.ts`) - po zmianie sceny skopiuj
  go tam. Hotspoty SCENE_HOTSPOTS może przepisać `--module` (`--block`, `--nested`); sloty i prostokąty BRIEFING/SUMMARY przepisuje się do
  `module.json` ręcznie (`odprawa.test.ts` pilnuje dziś slotów odprawy i `closing.portrait.slots` modułu 1 - poziomych `closing.slots`
  nie sprawdza).
- **Miniatura:** źródło `examples/<slug>/miniatura-<slug>.json`, build z `scripts/content` z `--out ../../packages/content/modules/<slug>/assets`
  (nie `assets/scenes`), pole `thumbnail` w `module.json`. Podgląd PNG nie trafia do repo (`.gitignore` go nie obejmuje - dodawaj pliki
  do commitu jawnie, po ścieżkach).
- **Animacje:** tylko CSS w SVG (klasy `a-*`), zatrzymywane przez `prefers-reduced-motion` i fragment `#static`, który odtwarzacz dopisuje
  przy reduced-motion (README kompozytora, „Animacje”).
- **Warianty pionowe (telefon):** odprawa i zamknięcie mają sceny 900×1600 (`*-pion.json`, `portrait` w treści - D-098, D-107); okna
  z drobnym tekstem - `imagePortrait` (niżej).
- **Publikacja:** `npm run tts --prefix scripts/content -- <slug> --assets --storage r2 --yes`, potem `--assets --check` (i
  `--assets --check --remote` - obecność plików w magazynie, D-068) - zawsze z gałęzi PR (CLAUDE.md, reguła 13).

### Grafiki otwierane kliknięciem mają przezroczyste tło (D-101)

Każda grafika otwierana kliknięciem (zbliżenie przedmiotu, dokument, okno, ekran) ma przezroczyste tło:

- **przedmioty, dokumenty, okna** → `scripts/content/scenes/crop-zooms.ts` (`wall: 'none'`, ciasny kadr wokół jedynego elementu sceny);
- **ekrany komputera** (pulpit, okno aplikacji na monitorze) → `scripts/content/scenes/wrap-in-monitor.ts` (ramka monitora `screenFrame`,
  tapeta = dawny kolor tła, tło wokół przezroczyste).

Jak odtwarzacz je pokazuje (rozmiar, cień, przyciemnienie sceny, okna na ekranie bez ruchu kamery): D-101, D-102, D-104.

### Wariant pionowy okna (`imagePortrait`, D-104)

Okno z drobnym tekstem (mail, historia przeglądarki) na telefonie w pionie (widok sceny < 0.8) byłoby nieczytelne w poziomym kadrze.
Dodaj wtedy `media.imagePortrait` obok `media.src` (na obu poziomach: przedmiot sceny i przedmiot pulpitu): osobna scena `<scena>-pion.json`
z klockiem pionowym (`mailWindowPortrait`, `browserHistoryPortrait` - duży zawijany tekst), przepuszczona przez `crop-zooms.ts`. Pole jest
już w `ASSET_PATHS` - nic nie trzeba dopisywać. Bez `imagePortrait` odtwarzacz pokazuje `src` także w pionie. Klocki pionowe zawijają tekst
po liczbie znaków, nie po szerokości - po zmianie treści obejrzyj podgląd (`--preview`) i skróć za długie tytuły/adresy.

Kolejność pracy dla nowej albo zmienionej grafiki:

```
cd scripts/content
npx tsx scenes/crop-zooms.ts scenes/examples/<slug> <scena> [...]        # albo wrap-in-monitor.ts dla ekranów
npx tsx scenes/cli.ts build scenes/examples/<slug>/<scena>.json --out ../../packages/content/modules/<slug>/assets/scenes
# <scena>.hotspots.json z katalogu --out -> scenes/examples/<slug>/ (kanoniczny); współrzędne do module.json (--module albo ręcznie)
npm run tts -- <slug> --assets --storage r2 --yes                  # publikacja z gałęzi PR
npm run tts -- <slug> --assets --check
```

Obie komendy kompozytora zmieniają wyłącznie tło, kadr i przesunięcia - treść sceny zostaje nietknięta; są idempotentne.

**Test w CI** (`scripts/content/scenes/transparent-zooms.test.ts`): każdy plik z `media.src` (image), `media.imagePortrait` (D-104),
`media.image` (zbliżenie nad nagraniem) i `media.scene.image` - także w scenie zagnieżdżonej - we WSZYSTKICH modułach jest SVG bez prostokąta tła na całą scenę
albo jest owinięty ramką monitora.

## 7. Nagrania (TTS)

- **Role, nie głosy:** każda narracja (także nagranie w zbliżeniu, `media.narration`) ma `voice` z listy ról schematu (`VOICE_ROLES`:
  `narrator` - domyślny, `komisarz`, `bank`, `marek`); rola -> głos ElevenLabs w commitowanym `scripts/content/voices.json`. Nowa postać
  mówiąca = nowa rola w schemacie i w `voices.json` (D-082). Klucz API tylko w `scripts/content/.env.local` (D-060).
- **`text` a `spokenText`:** `text` to napis na ekranie i w transkrypcji; `spokenText` (opcjonalny, niewysyłany do klienta) to to, co
  czyta głos. Używaj go zawsze, gdy zapis różni się od wymowy: **liczby i godziny słownie** („9:40” → „dziewiąta czterdzieści”,
  „14 000 zł” → „czternaście tysięcy złotych”), domeny i adresy tak, jak się je mówi, skróty rozwinięte. Przypadek zależy od zdania:
  „o 8:47” → „o ósmej czterdzieści siedem”, samodzielnie „ósma czterdzieści siedem”, „przypomnij sobie … 8:47” → „ósmą czterdzieści
  siedem”. **Reguła (D-109):** tekst czytany przez głos (`spokenText`, a bez niego `text`) żadnej NAGRYWANEJ narracji (`NARRATION_PATHS`
  potoku: bloki, kroki odprawy, hotspoty, media, sceny zagnieżdżone, kwestie i odpowiedzi rozmowy) nie ma cyfr - pilnuje tego walidacja
  modułu (`parseModule`) i test w CI (`scripts/content/src/spoken-digits.test.ts`). Podpowiedzi (`hints`) są tylko tekstem - bez tej
  reguły. Narracja ze `spokenText` nie ma `cues` - napisy dzieli odtwarzacz (zdania z `text`).
- **Głos lektora:** spokojnie, jak narrator kryminału, bez żartów; opowiada w trzeciej osobie o postaciach, a do gracza zwraca się per
  „ty” („Zacznij od jej biura”). Podpowiedzi (`tip`, reakcje) mówią do gracza per „ty” i są tylko tekstem, bez nagrań.
- **Publikacja:** `npm run tts --prefix scripts/content -- <slug> --storage r2` (tylko brakujące nagrania; bez `--storage r2` pliki
  trafiają lokalnie do `apps/web/public/content`), `--check` w PR; `audio.lock.json` commitowany (`docs/content-pipeline.md`).

## 8. Nazwy i fikcja (D-108)

- Firma ofiary w module 1 to **Unfooly Sp. z o.o.** z domeną **`unfooly.com`** (poczta, intranet, kalendarz) - to własna domena produktu,
  więc bezpieczna w fabule. Kolejne moduły też używają domen produktu (albo `.example`), nigdy wymyślonej domeny, która może należeć do
  kogoś innego. Postaci są fikcyjne; nie używamy nazwisk prawdziwych osób.
- **Banki, firmy i domeny spoza produktu - wyłącznie fikcyjne i sprawdzone:** przed użyciem nazwy banku i każdej domeny (tej „prawdziwej”
  w fabule i fałszywej) sprawdź, że nie należy do istniejącej instytucji albo marki (wyszukiwarka, WHOIS, rejestr banków), i **dopisz ją do
  rejestru niżej** (każdy nowy moduł dopisuje swoje nazwy w tym samym PR co treść).
- Kwoty, numery spraw i kont - wymyślone, bez prawdziwych numerów rachunków czy telefonów.
- Cudze marki w nazwach (np. gier, aplikacji) tylko za decyzją właściciela, zapisaną w decyzji modułu - wzorzec: „GTA6_PL.exe” w module 1
  (D-100).

### Rejestr nazw fikcyjnych

Jedno miejsce dla wszystkich modułów: nazwa, rodzaj, moduł, status sprawdzenia. Domeny `.pl` sprawdza właściciel w rejestrze NASK
(dns.pl) i wpisuje wynik z datą; do tego czasu status „do sprawdzenia”, a moduł nie idzie na produkcję z nową nazwą bez tego wpisu.

| Nazwa | Rodzaj | Moduł | Status sprawdzenia |
|---|---|---|---|
| Unfooly Sp. z o.o., `unfooly.com` | firma ofiary, domena | 1 `wyludzone-haslo` | własna marka i domena produktu - bezpieczne |
| Bank Wektor | bank (fikcyjny) | 1 `wyludzone-haslo` | fikcyjna; do sprawdzenia przez właściciela (rejestr banków KNF, wyszukiwarka) |
| Wektor Rozliczenia Sp. z o.o. | firma (fikcyjna) | 1 `wyludzone-haslo` | fikcyjna; do sprawdzenia przez właściciela (KRS, wyszukiwarka) |
| `bankwektor.pl` | domena „prawdziwego” banku w fabule | 1 `wyludzone-haslo` | fikcyjna; status rejestracji domeny do sprawdzenia przez właściciela (dns.pl) |
| `bankwektor-weryfikacja.pl` | domena fałszywa (phishing) | 1 `wyludzone-haslo` | fikcyjna; status rejestracji domeny do sprawdzenia przez właściciela (dns.pl) |
| „GTA6_PL.exe” | nazwa pliku gry (easter egg) | 1 `wyludzone-haslo` | nawiązanie do cudzej marki - zostaje, decyzja właściciela (D-100): świadome ryzyko, ikona własna, bez logo |

## 9. Zakazy (D-108)

- **Żadnych realistycznych formularzy logowania** ani pól na dane uwierzytelniające - fałszywa strona istnieje w module tylko jako wpis
  historii, adres w pasku i ostrzeżenie „Ta strona podszywa się pod bank” (D-094). Symulacje phishingowe to osobny moduł platformy.
- **Żadnych cudzych logotypów ani grafik marek** (banki, aplikacje, gry) - ikony i grafiki tylko z kompozytora, w stylu Unfooly (np. własna
  ikona gry w easter eggu, D-100). Nazwy cudzych marek w tekście (także nazwy plików na pulpicie) - tylko za decyzją właściciela; moduł 1
  ma „GTA6_PL.exe” - zostaje, decyzja właściciela (D-100, rejestr nazw w rozdziale 8).
- Klucz odpowiedzi, podpowiedzi i rozwiązania nigdy w polach `client`; SVG tylko przez `<img>`; `EMBEDDED_HTML` tylko w `<iframe sandbox>`
  (CLAUDE.md „Silnik szkoleń”).
- Bez przycisków dalej w treści i scenach (D-106) i bez tekstu, który na telefonie miałby mniej niż 15 px (D-103).

## 10. Lista kontrolna przed PR

- [ ] `SCENARIUSZ.md` zatwierdzony; oś czasu spójna we wszystkich blokach i grafikach; nazwy i domeny w rejestrze nazw (rozdział 8).
- [ ] Moduł przechodzi walidację: `npm run tts --prefix scripts/content -- <slug> --check` i `--assets --check` (`parseModule` na
      `module.json`), a na lokalnej bazie `content-import` (także ostrzeżenia `moduleWarnings`). Testy pakietu (`npm run test
      --workspace=packages/content`) sprawdzają schemat na fixturach - nowe pole schematu wymaga też fixtury i klasyfikacji.
- [ ] Dowody: każdy z `note` i `kind`, N zgodne ze scenariuszem, bez duplikatów, wymagane przedmioty ustawione świadomie.
- [ ] Grafiki z kompozytora; zbliżenia z przezroczystym tłem (`crop-zooms` / `wrap-in-monitor`); warianty pionowe tam, gdzie tekst jest
      drobny; źródła i kanoniczne `*.hotspots.json` w `scenes/examples/<slug>/`; `npm test` w `scripts/content` zielone (sceny, zasoby).
- [ ] Zasoby i nagrania opublikowane z gałęzi PR (`--storage r2`), `--assets --check` (+ `--remote`) i `tts --check` zielone.
- [ ] Nagrania: role z `VOICE_ROLES`, `spokenText` przy liczbach, godzinach i domenach (słownie, w dobrym przypadku;
      `spoken-digits.test.ts` zielony).
- [ ] Nazwy fikcyjne i sprawdzone, dopisane do rejestru nazw (rozdział 8); brak formularzy logowania i cudzych logotypów.
- [ ] layout-check zielony i wklejony do PR (CLAUDE.md, reguła 12): dla nowego modułu `LAYOUT_CHECK_MODULE=<slug> node
      scripts/layout-check.mjs` (sekcja `module`) plus sekcje z elementami specyficznymi dla modułu, jeśli je dodasz.
- [ ] e2e: smoke `node scripts/e2e-module.mjs <slug>` i pełne przejście modułu (wzór: `scripts/e2e-module-01.mjs`, przejście wyłącznie
      dolnym „Dalej”) zielone lokalnie; w opisie PR linia „DEPLOY: <co weszło> — content-import: tak”.
- [ ] Decyzje zmieniające zachowanie w `docs/decisions.md`, odłożone uwagi w `docs/backlog-issues.md`.
