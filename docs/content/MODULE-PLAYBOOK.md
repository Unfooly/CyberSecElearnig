# Playbook modułu szkoleniowego

Jak zbudować moduł-śledztwo od zera, na wzór modułu 1 („Sprawa: wyłudzone hasło”, `packages/content/modules/wyludzone-haslo`). Ten plik
to przewodnik i lista kontrolna; szczegóły formatu są w `packages/content/README.md`, potok nagrań i zasobów w `docs/content-pipeline.md`,
klocki i kompozytor scen w `scripts/content/scenes/README.md`, zachowanie odtwarzacza w `docs/course-player.md`, a uzasadnienia w
`docs/decisions.md` (tu tylko odnośniki D-xxx - nie powtarzamy decyzji).

Zasady z tego pliku obowiązują każdy nowy moduł i każdą zmianę treści albo grafik istniejącego.

## 1. Kolejność pracy

1. **Scenariusz** (`SCENARIUSZ.md`) - fabuła, postaci, oś czasu, teksty, dowody, pytania i oceny. Pisze go (albo zatwierdza) właściciel
   produktu, PRZED `module.json` (README treści, „Katalog modułu”).
2. **Mapowanie na schemat** (`module.json`) - wierne odwzorowanie scenariusza. Czego schemat nie przewiduje, to się zgłasza, a nie
   improwizuje.
3. **Grafiki** - sceny z kompozytora (rozdział 6), publikacja `--assets`.
4. **Nagrania** - lektor i role (rozdział 5), publikacja `tts`.
5. **Weryfikacja** - testy treści, layout-check, e2e (rozdział 10), PR.

## 2. Struktura katalogu

```
packages/content/modules/<slug>/
  SCENARIUSZ.md        źródło prawdy o treści (oś czasu, dialogi, dowody, oceny)
  module.json          treść dla silnika (walidowana zod + semantics.ts)
  assets/
    scenes/            sceny SVG z kompozytora (wynik build - nie edytuj ręcznie)
    avatars/           avatary postaci (SVG)
    miniatura-<slug>.svg   miniatura modułu w katalogu kursów (też z kompozytora)
  assets.lock.json     generowany przez --assets (nie edytuj ręcznie)
  audio.lock.json      generowany przez tts (nie edytuj ręcznie)
scripts/content/scenes/examples/<scena>.json    źródła scen (+ <scena>.hotspots.json, gdy scena ma hotspoty/sloty)
```

`module.json` przechowuje w polach grafik i nagrań klucze opublikowanych plików (`assets/<slug>/scenes/<nazwa>.<skrót>.svg`); przy nowym
zasobie wpisz ścieżkę źródłową (`scenes/<nazwa>.svg`) - `--assets` podmieni ją na klucz i dopisze wpis w `assets.lock.json`. Pola z
plikami zna potok przez `ASSET_PATHS` (`scripts/content/src/assets.ts`) - nowe pole schematu z plikiem trzeba tam dopisać.

## 3. Oś czasu jest źródłem prawdy

Wszystko, co gracz może porównać - godziny w mailu, logach, historii przeglądarki, wydruku, kalendarzu, na tablicy śledczej i w rozmowach
- wynika z JEDNEJ osi czasu zapisanej w metadanych `SCENARIUSZ.md` (moduł 1: mail 8:47 → hasło 8:58 → SMS logowania 9:02 → logowanie
oszusta 9:03 → nowy odbiorca 9:04 → telefon „informatyka” 9:05 → SMS autoryzacji 9:06 → przelew 9:12; śledztwo 9:40 / 10:05; D-095).

- Najpierw oś czasu, potem teksty. Zmiana godziny = zmiana w scenariuszu i we WSZYSTKICH miejscach, które ją pokazują (grafiki też -
  przebudowa sceny i ponowna publikacja).
- Wpis, którego fabuła nie dopuszcza (np. aktywność ofiary po momencie, gdy wyszła od biurka), to błąd - D-094 pokazuje przykład
  poprawki.
- Ślady na tablicy śledczej (ORDERING) nie mają godzin - inaczej rekonstrukcja byłaby odczytem zegara (D-088).

## 4. Schemat v5 i typy bloków

Moduł-śledztwo ma `schemaVersion: 5`. Wspólne dla bloków: `id` (kebab-case, stały po publikacji - postęp jest kluczowany id),
`tip` (stała podpowiedź w dymku, bez maskotki - D-093, D-096), `reactions` (`complete` dla eksploracyjnych, `result` dla ocenianych; sam
`text` - D-061, D-096), `narration` (rozdział 5), `weight` (> 0 tylko w blokach ocenianych). Odpowiedzi ocenia wyłącznie serwer, a klucz
odpowiedzi nigdy nie trafia do klienta (`FIELD_CLASSIFICATION`, CLAUDE.md „Silnik szkoleń”) - każde nowe pole schematu musi być
sklasyfikowane jako `client` albo `secret`.

**Nawigacja:** jedynym przejściem dalej jest „Dalej” w dolnym pasku odtwarzacza (D-106). Bloki nie mają przycisków dalej - akcje w bloku
(sprawdzenie, drzwi, ostatni krok odprawy) tylko zgłaszają gotowość. Nie projektuj treści, która wymaga przycisku dalej w scenie.

| Blok | Do czego | Najważniejsze pola | Decyzje |
|---|---|---|---|
| `BRIEFING` | odprawa na start: telefon, rozmowa, teczka z zadaniami, legitymacja gracza, ekran startu | `steps[]` (`typewriter`, `call`, `caseFile` z `tasks[]` i `completeWhen`, `badge`, `start`), każdy krok może mieć `image`, `hotspot` (przedmiot kroku = przejście do kolejnego), `slots`, `portrait` (wariant 9:16) | D-081, D-084, D-086, D-098, D-106 |
| `SCENE_HOTSPOTS` | scena z przedmiotami; klik = zbliżenie z „Zabierz”/„Odłóż” | `image`, `hotspots[]` (`required`, `evidence`, `note`, `media`: `image` / `audio` / `document` / `scene` - pulpit w monitorze / `popups` - easter egg), `action: "next"` (drzwi) | D-071, D-086, D-100–D-104, D-106 |
| `DOSSIER` | teczka sprawy: przekładki z dokumentami, zakreślanie wierszy-dowodów | `tabs[]` z wierszami; wiersz-dowód z `note`, zwykły wiersz może mieć własny `message` | D-083 |
| `DIALOGUE` | rozmowa jak w komunikatorze (pytania-chipy, „pisze…”) | `character`, `character.opening`, `questions[]` (`required`, `evidence`, `lines[]`) | D-079, D-087, D-097 |
| `EMAIL_ANALYSIS` | makieta maila, gracz zaznacza oznaki phishingu (oceniany) | `email` (nadawca, `to`, data, temat, załącznik, treść), `criteria[]` (`target` - fragment w mailu, `correct`, `explanation`, dowód tylko przy `correct`) | D-056, D-057 |
| `ORDERING` | tablica śledcza: ślady na pola w kolejności (oceniany) | `items[]` (bez godzin), `start`/`end` (zdjęcia początku i końca łańcucha) | D-088, D-105 |
| `TEXT_INPUT_GUIDED` | zadanie z wpisaniem odpowiedzi, podpowiedzi po złych próbach (oceniany) | wzorce odpowiedzi (sekret, RE2 - D-052), `hints`, `maxAttempts`, `frame: "browser"` (okno przeglądarki z paskiem adresu) | D-052, D-094 |
| `SUMMARY` | rozwiązanie sprawy i ekran zamknięcia | `text`, `lessons[]`, `closing` (raport, pieczęć, liścik, `slots`, `portrait`) | D-089, D-098, D-107 |
| `NARRATIVE` | krótki tekst narracyjny między scenami | `title`, `text` | D-061 |

Okienka easter egga (`media.kind: "popups"`) nie są dowodem ani warunkiem ukończenia i nie zmieniają XP (D-100). Zbliżenia i okna z
drobnym tekstem mają wariant pionowy `imagePortrait` (rozdział 6).

## 5. Dowody

- Dowód to element z `evidence: true` (przedmiot sceny, pytanie rozmowy, kryterium maila, wiersz teczki). Każdy dowód MUSI mieć `note`
  z `kind` (ikona w notatniku) - walidacja (`semantics.ts`).
- **N (liczba dowodów) liczy serwer z treści** - nie wpisuje się jej nigdzie ręcznie. Wypisz w scenariuszu, ile dowodów jest w każdym
  bloku i łącznie (moduł 1: 23), bo ta liczba pojawia się w licznikach, na rozwiązaniu sprawy i w raporcie zamknięcia.
- **Wymagane a opcjonalne:** `required` wyznacza ukończenie bloku, nie dowód. Dowód może być opcjonalny (tablica w korytarzu, historia
  przeglądarki - D-094), a przedmiot wymagany nie musi być dowodem.
- **Bez duplikatów:** jeden fakt = jeden dowód w całym module. Ten sam trop pokazany w dwóch miejscach (np. domena w mailu i w historii
  przeglądarki) to dwa RÓŻNE dowody tylko wtedy, gdy wnoszą inną informację (mail: nadawca; historia: 8:58 wejście na stronę) - inaczej
  jeden z nich jest zwykłym elementem albo ma własny komunikat (`message`, jak wiersz przelewu 9:12 w teczce).
- Przedmiot ze sceną zagnieżdżoną (`media.kind: "scene"`) nie jest dowodem - dowody są w jego scenie. Kryterium maila może być dowodem
  tylko, gdy jest poprawne.
- Worki z dowodami na raporcie zamknięcia to etykiety grafiki (`reportPortrait` / raport poziomy) - przy nowym module przygotuj je razem
  z listą dowodów (D-107).

## 6. Grafiki

Wszystkie sceny powstają w kompozytorze (`scripts/content/scenes`) z klocków w płaskim stylu Unfooly - bez ręcznego rysowania i bez
cudzych grafik. Klocek = funkcja w `props.ts` / `props-odprawa.ts`, wpis w `PROPS` i wiersz w README kompozytora.

- **Sceny poziome:** 1600×1000 (sceny z przedmiotami) albo 1600×900 (odprawa, raport); źródło `examples/<scena>.json`, build
  `npx tsx scenes/cli.ts build ...` (hotspoty liczy kompozytor - współrzędne przepisujesz do `module.json` albo `--module`).
- **Animacje:** tylko CSS w SVG (klasy `a-*`), zatrzymywane przez `prefers-reduced-motion` i fragment `#static`, który odtwarzacz dopisuje
  przy reduced-motion (README kompozytora, „Animacje”).
- **Warianty pionowe (telefon):** odprawa i zamknięcie mają sceny 900×1600 (`*-pion.json`, `portrait` w treści - D-098, D-107); okna
  z drobnym tekstem - `imagePortrait` (niżej). Test `odprawa.test.ts` pilnuje, że build ze źródła daje identyczne SVG i że sloty w
  `module.json` zgadzają się z `*.hotspots.json`.
- **Miniatura:** `assets/miniatura-<slug>.svg` z kompozytora (scena z przykładów, jak `examples/miniatura-*.json`).
- **Publikacja:** `npm run tts --prefix scripts/content -- <slug> --assets --storage r2 --yes`, potem `--assets --check` - zawsze z gałęzi
  PR (CLAUDE.md, reguła 13).

### Grafiki otwierane kliknięciem mają przezroczyste tło (D-101)

Każda grafika otwierana kliknięciem (zbliżenie przedmiotu, dokument, okno, ekran) ma przezroczyste tło:

- **przedmioty, dokumenty, okna** → `scripts/content/scenes/crop-zooms.ts` (`wall: 'none'`, ciasny kadr wokół jedynego elementu sceny);
- **ekrany komputera** (pulpit, okno aplikacji na monitorze) → `scripts/content/scenes/wrap-in-monitor.ts` (ramka monitora `screenFrame`,
  tapeta = dawny kolor tła, tło wokół przezroczyste).

Odtwarzacz pokazuje taką grafikę bez karty, z samym cieniem po kształcie (`drop-shadow`), max 88% sceny, na przyciemnionej i
rozmytej scenie (ink 35% + blur 3 px, D-102). Okno otwarte z ekranu (przedmiot sceny zagnieżdżonej - pulpit) otwiera się bez ruchu
kamery, od razu nad przyciemnionym pulpitem, max 94% sceny; okienka easter egga - bez przyciemnienia (D-104).

### Wariant pionowy okna (`imagePortrait`, D-104)

Okno z drobnym tekstem (mail, historia przeglądarki) na telefonie w pionie (widok sceny < 0.8) byłoby nieczytelne w poziomym kadrze.
Dodaj wtedy `media.imagePortrait` obok `media.src` (na obu poziomach: przedmiot sceny i przedmiot pulpitu): osobna scena `<scena>-pion.json`
z klockiem pionowym (`mailWindowPortrait`, `browserHistoryPortrait` - duży zawijany tekst), przepuszczona przez `crop-zooms.ts`, dopisana
do `ASSET_PATHS` przez schemat (pole `client`). Bez `imagePortrait` odtwarzacz pokazuje `src` także w pionie. Klocki pionowe zawijają tekst
po liczbie znaków, nie po szerokości - po zmianie treści obejrzyj podgląd (`--preview`) i skróć za długie tytuły/adresy.

Kolejność pracy dla nowej albo zmienionej grafiki:

```
cd scripts/content
npx tsx scenes/crop-zooms.ts scenes/examples <scena> [...]        # albo wrap-in-monitor.ts dla ekranów
npx tsx scenes/cli.ts build scenes/examples/<scena>.json --out ../../packages/content/modules/<slug>/assets/scenes
# ekran z hotspotami: przepisz współrzędne z <scena>.hotspots.json do module.json
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
  mówiąca = nowa rola w schemacie i w `voices.json` (D-082). Klucz API tylko w `.env.local` (D-060).
- **`text` a `spokenText`:** `text` to napis na ekranie i w transkrypcji; `spokenText` (opcjonalny, niewysyłany do klienta) to to, co
  czyta głos. Używaj go zawsze, gdy zapis różni się od wymowy: **liczby i godziny słownie** („9:40” → „dziewiąta czterdzieści”,
  „14 000 zł” → „czternaście tysięcy złotych”), domeny i adresy tak, jak się je mówi, skróty rozwinięte.
- Lektor mówi w trzeciej osobie, spokojnie; podpowiedzi (`tip`, reakcje) mówią do gracza per „ty” i są tylko tekstem, bez nagrań.
- **Publikacja:** `npm run tts --prefix scripts/content -- <slug>` (tylko brakujące nagrania, skrót tekst + model + głos), `--check` w PR;
  `audio.lock.json` commitowany (`docs/content-pipeline.md`).

## 8. Nazwy i fikcja

- Firma ofiary w module 1 to **Unfooly Sp. z o.o.** (fikcyjna spółka, nazwa marki produktu). Postaci są fikcyjne; nie używamy nazwisk
  prawdziwych osób.
- **Banki, firmy i domeny - wyłącznie fikcyjne i sprawdzone:** przed użyciem nazwy banku i każdej domeny (prawdziwej w fabule i fałszywej)
  sprawdź, że nie należy do istniejącej instytucji albo marki (wyszukiwarka, WHOIS, rejestr banków). Moduł 1: „Bank Wektor”, prawdziwa
  domena w fabule `bankwektor.pl`, fałszywa `bankwektor-weryfikacja.pl`.
- Kwoty, numery spraw i kont - wymyślone, bez prawdziwych numerów rachunków czy telefonów.

## 9. Zakazy

- **Żadnych realistycznych formularzy logowania** ani pól na dane uwierzytelniające - fałszywa strona istnieje w module tylko jako wpis
  historii, adres w pasku i ostrzeżenie „Ta strona podszywa się pod bank” (D-094). Symulacje phishingowe to osobny moduł platformy.
- **Żadnych cudzych logotypów i znaków towarowych** (banki, aplikacje, gry) - ikony i grafiki tylko z kompozytora, w stylu Unfooly
  (np. własna ikona gry w easter eggu, D-100).
- Klucz odpowiedzi, podpowiedzi i rozwiązania nigdy w polach `client`; SVG tylko przez `<img>`; `EMBEDDED_HTML` tylko w `<iframe sandbox>`
  (CLAUDE.md „Silnik szkoleń”).
- Bez przycisków dalej w treści i scenach (D-106) i bez tekstu, który na telefonie miałby mniej niż 15 px (D-103).

## 10. Lista kontrolna przed PR

- [ ] `SCENARIUSZ.md` zatwierdzony; oś czasu spójna we wszystkich blokach i grafikach.
- [ ] `module.json` przechodzi walidację (`npm run test --workspace=packages/content`); nowe pola sklasyfikowane (`client`/`secret`).
- [ ] Dowody: każdy z `note` i `kind`, N zgodne ze scenariuszem, bez duplikatów, wymagane przedmioty ustawione świadomie.
- [ ] Grafiki z kompozytora; zbliżenia z przezroczystym tłem (`crop-zooms` / `wrap-in-monitor`); warianty pionowe tam, gdzie tekst jest
      drobny; `npx vitest run scenes` w `scripts/content` zielone (build = SVG w module, sloty = `*.hotspots.json`).
- [ ] Zasoby opublikowane z gałęzi PR, `--assets --check` i `tts --check` zielone.
- [ ] Nagrania: role z `VOICE_ROLES`, `spokenText` przy liczbach, godzinach i domenach.
- [ ] Nazwy fikcyjne i sprawdzone; brak formularzy logowania i cudzych logotypów.
- [ ] layout-check (`node scripts/layout-check.mjs`, sekcje odtwarzacza i telefonu) zielony i wklejony do PR (CLAUDE.md, reguła 12).
- [ ] e2e modułu (wzór: `scripts/e2e-module-01.mjs`, przejście wyłącznie dolnym „Dalej”) zielone lokalnie; `content-import` w opisie
      PR („DEPLOY: … content-import: tak”).
- [ ] Decyzje zmieniające zachowanie w `docs/decisions.md`, odłożone uwagi w `docs/backlog-issues.md`.
