# Odtwarzacz modułów szkoleniowych (`apps/web`)

Krótki opis tego, co robi odtwarzacz i jakich zasad nie wolno łamić. Format treści i walidacja: `packages/content/README.md`. Decyzje:
D-051 (silnik), D-053 (CSP), D-054 do D-058 (odtwarzacz). Sekcja „jak pisać moduł” dojdzie w PR 4 (import i atrapa).

Kod: `apps/web/src/app/courses/[courseId]/_components/` (`CoursePlayer.tsx`, `blocks/`, `player/`), BFF: `apps/web/src/app/api/courses/`.

## Zasady, które nie podlegają negocjacji

1. **Ocenia wyłącznie serwer.** Klient wysyła swój wybór (indeks, listy id, tekst próby), nigdy poprawność ani punkty. BFF przekazuje ciało tylko z allowlisty.
2. **Klucz odpowiedzi nie trafia do przeglądarki.** Treść bloku idzie do klienta wyłącznie przez `toClientBlock` (biała lista, `FIELD_CLASSIFICATION`).
3. **Stan jest na serwerze.** Po odświeżeniu wracamy do bloku z `/start`; „Wstecz” to podgląd tylko do odczytu (bez zapisu).
4. **Kod z zewnątrz tylko w sandboxie** (`EMBEDDED_HTML`, patrz niżej). SVG zawsze przez `<img>`, nigdy inline.
5. **Ścieżki zasobów** (obrazy, audio, avatary) są względne wobec `CONTENT_BASE_URL` i sprawdzane tym samym wzorcem co schemat (`lib/content-assets.ts`).

## Typy bloków i ich odpowiedzi

Odpowiedź idzie `POST /api/courses/:id/progress` jako `{ blockIndex, answer? }`. Bloki ukończone po kolei; „Dalej” po wyniku to osobny krok w interfejsie.

**Jeden „Dalej” (D-106).** Jedynym przejściem dalej w całym odtwarzaczu jest przycisk w dolnym pasku (`PlayerStage`). Bloki nie mają
przycisków nawigacji; akcje w bloku („Sprawdź trop”, „Sprawdź odpowiedź”, Zabierz/Odłóż, drzwi na scenie, „Zabierz legitymację” na
ostatnim kroku odprawy, „Ukończyłem”) tylko zgłaszają gotowość (`onReady`), a wynik bloku ocenianego aktywuje „Dalej” od razu. „Dalej”
jest nieaktywny, dopóki blok nie jest kompletny, i krótko pulsuje przy aktywacji (bez pulsu przy reduced-motion; sam pierścień, bez
`transform`). Etykieta: „Zakończ sprawę”/„Zakończ szkolenie” na SUMMARY, „Wróć do biblioteki” (link) na ekranie zamknięcia. Enter i →
uruchamiają aktywny „Dalej”, o ile fokus nie jest w polu, na przycisku/linku (Enter) ani w kontrolce ze strzałkami (→), a żadna nakładka nie
jest otwarta (`forwardShortcutAllowed`). „Pomiń odprawę” (górny pasek) przeskakuje na ostatni krok odprawy. layout-check: sekcja
`single-next` i kontrole (j1, j2) w pozostałych sekcjach.

| Typ | Komponent | `answer` | Wynik / uwagi |
|---|---|---|---|
| `VIDEO`, `DRAG_AND_DROP` | `VideoBlock`, `DragAndDropBlock` | brak | nieoceniane; wideo spoza `CONTENT_BASE_URL` to link „Otwórz wideo” (B-076) |
| `QUIZ`, `BRANCHING_SCENARIO` | `SingleChoiceBlock` | indeks opcji | poprawność z serwera; w podglądzie „Twoja odpowiedź” |
| `SCENE_HOTSPOTS` | `SceneHotspotsBlock` | `{ visited, noted }` | ukończenie po punktach `required`; klik = zbliżenie przedmiotu (D-086; przezroczysta grafika z cieniem po kształcie - D-101, na przyciemnionej scenie ink 35% + blur 3 px - D-102; przedmiot na ekranie - pulpicie - bez ruchu kamery, max 94%, na telefonie `imagePortrait` - D-104), „Zabierz” zalicza dowód tylko dla `evidence` (inaczej toast „To nie jest dowód w tej sprawie.”); `media.kind: "popups"` - okienka easter egga (`PopupsEasterEgg`, D-100): do `visited` dopiero po zamknięciu wszystkich, wyróżnienie w notatniku, bez dowodu i XP; stan częściowy (D-128): każda zmiana obejrzanych/zabranych idzie w tle na `POST /api/courses/:id/blocks/:blockId/explore` (`{ visited, noted }`), a po powrocie do modułu scena odtwarza go z `progress.blocks[id].exploration` |
| `DIALOGUE` | `DialogueBlock` | `{ asked }` | komunikator (D-087): rozmówca „pisze” przed każdą kwestią (także otwierającą), dźwięki przy włączonym Lektorze; pytanie liczy się po ostatniej kwestii |
| `TABS` | `TabsBlock` | `{ opened }` | wzorzec ARIA tabs |
| `NOTEPAD`, `SUMMARY` | `NotepadBlock`, `SummaryBlock` | brak | `SUMMARY` z dowodami to „Rozwiązanie sprawy” (przeoczone tylko liczbowo) |
| `EMAIL_ANALYSIS` | `EmailAnalysisBlock` | `{ selected }` (id nieprzejrzyste) | klik we fragment maila zaznacza kryterium; link nigdy nie nawiguje; wynik z `detail` |
| `ORDERING` | `OrderingBlock` | `{ order }` (id nieprzejrzyste) | tablica śledcza (D-088): ślady z tacki na pola 1..N - przeciąganie, klik ślad → klik pole albo klawiatura; zajęte pole = zamiana; „Sprawdź trop”, gdy pełna; telefon w pionie - zygzak w jednej kolumnie, tacka pod tablicą (D-105) |
| `TEXT_INPUT_GUIDED` | `TextInputBlock` | brak (próby: `POST /api/courses/:id/blocks/:blockId/attempt`, `{ answer }`) | podpowiedź po błędnej próbie, rozwiązanie po wyczerpaniu prób |
| `EMBEDDED_HTML` | `EmbeddedHtmlBlock` | brak | osobny dokument w iframe (niżej) |

Bloki eksploracyjne mają wagę 0; `weight` w treści może im nadać udział w wyniku.

Po ukończeniu kursu odtwarzacz pokazuje ekran zamknięcia sprawy (`CaseClosedScreen`, D-089): raport z `SUMMARY.closing` (dowody, czas
od `startedAt` przypisania do `completedAt`, +XP, `lessons`, podpis gracza, pieczęć, liścik). Ceremonia z animacją i dźwiękami tylko przy
ukończeniu w tej sesji; reduced-motion i powrót do ukończonego kursu - od razu stan końcowy. Bez `closing` - prosty ekran z wynikiem.

## Co jest `client`, a co `secret`

Każde pole schematu bloku jest sklasyfikowane w `packages/content/src/blocks.ts` (`FIELD_CLASSIFICATION`); test kompletności wywala CI dla nowego, niesklasyfikowanego pola.

- **client:** treść do wyświetlenia (pytania, teksty, obrazy, kotwice `criteria[].target`, `hotspots[].evidence/note/required`, `questions[].lines`, `hintCount`).
- **secret:** `correct`, `outcome`, `feedback`, wyjaśnienia, `answer.accept/regex`, podpowiedzi i rozwiązanie zadania tekstowego, `criteria[].evidence` i notatki kryteriów, `scoring`, **`html` bloku `EMBEDDED_HTML`**.
- **Id nieprzejrzyste:** elementy `EMAIL_ANALYSIS` i `ORDERING` klient dostaje jako HMAC (inny w każdym przypisaniu), w kolejności potasowanej przez serwer.
- **Po ukończeniu bloku** serwer zwraca `answer` (własny wybór) i `detail` (rozstrzygnięcie): tylko dla bloku ukończonego, jako id nieprzejrzyste (podgląd „Wstecz”, także po odświeżeniu).
- **Dowody:** `Dowody X/Y` liczy serwer (`progress.evidence`, odpowiedź `/progress`). Suma bloku maila jest ukryta („?”) do zatwierdzenia odpowiedzi.

## CSP i `EMBEDDED_HTML`

- CSP strony (nonce z middleware, D-053): `script-src 'self' 'nonce-…'` bez `unsafe-inline`; zasoby modułów z `CONTENT_BASE_URL` (konkretny origin).
- `EMBEDDED_HTML` wykonuje dowolny JS, więc jest **osobnym dokumentem**: `GET /api/courses/:id/blocks/:blockId/embed` (web) pobiera `{ html }` z API (tylko właściciel przypisania, blok bieżący lub wcześniejszy) i serwuje z własnymi nagłówkami: `default-src 'none'`, skrypty i style tylko inline, `sandbox allow-scripts` (bez `allow-same-origin`), `nosniff`, `no-store`; `X-Frame-Options: SAMEORIGIN` tylko dla tej trasy.
- iframe: `sandbox="allow-scripts"`, `src` (nie `srcdoc`, który dziedziczy CSP strony), `referrerpolicy="no-referrer"`. Podczas „Wstecz” iframe jest **odmontowany**, nie ukryty.
- Ukończenie bloku to przycisk „Ukończyłem” poza iframe; wynik w grze jest tylko informacyjny.

## Narracja i napisy

- Blok ma opcjonalne `narration` (tekst, `audioUrl`, `durationMs`, opcjonalne `cues` z czasami). Nagranie i `cues` wpisuje skrypt TTS (PR 3).
- `NarrationBar` (dolny pasek): play, napis w jednej linii z nagraniem, transkrypcja, przełącznik „Lektor” (przycisk z `aria-pressed`, zapis na koncie: `users.narrationEnabled`). Na scenie węższej niż 640 px (D-097) pasek to jeden rząd ikon 44×44 + „Dalej”, a napis przechodzi do wiersza nad przyciskami. Napisy z `cues`, a bez nich podział na zdania proporcjonalny do długości (`lib/narration-captions.ts`).
- Autoodtwarzanie tylko po „Dalej”, gdy poprzedni blok miał nagranie i lektor jest włączony. Blok bez narracji nie ma rzędu odtwarzacza ani przełącznika (zamierzone).
- Narracja pojedynczych elementów (punkt sceny, kwestia dialogu): B-078.

## Sceny pionowe (D-098)

Odprawa (BRIEFING) i zamknięcie sprawy mają opcjonalny wariant pionowy (`portrait` w treści, grafiki 9:16). Odtwarzacz mierzy kontener
(`lib/use-portrait-container.ts`: proporcje < 0.8 = telefon w pionie; do pierwszego pomiaru grafika się nie renderuje - bez mignięcia
wariantu poziomego po SSR) i bierze pionową grafikę z jej prostokątami; obrót telefonu przełącza wariant bez utraty stanu kroku ani
etapu ceremonii. Zamknięcie w pionie (D-107): raport jako jedna duża strona 9:16 wypełniająca wolną wysokość, wszystkie dane w slotach
grafiki (liczby min. 18 px pogrubione, podpis min. 16 px, wnioski min. 15 px), pod raportem tylko „Następna sprawa · wkrótce” (i
ewentualny komunikat błędu; „Wróć do biblioteki” w dolnym pasku, D-106). Wynik zadań, awans i nowe odznaki - w opisie raportu dla czytnika. Bez `portrait` - scena 16:9 w pasach i panorama raportu (jak wcześniej).

## Telefon: tekst min. 15 px w całym module (D-099, D-103)

Na ekranie węższym niż 640 px cały tekst odtwarzacza ma min. 15 px - treść każdego bloku, notatnik, górny i dolny pasek (klasa
`.mobile-readable` na ramce `PlayerStage`, reguła w globals.css; napisy lektora, licznik pytań rozmowy i podpowiedź panoramy - 15 px w CSS;
tekst w slotach scen odprawy - wyższe granice FitText w pionie, pola legitymacji z `minPx`). Desktop bez zmian. layout-check: sekcja
`mobile-module` (tekst w całej ramce, każdy blok modułu 1). Końcówka modułu (od rekonstrukcji do zamknięcia sprawy) ma dodatkowo cele
dotyku 44 px i brak poziomego przewijania (D-099). Tablica śledcza w pionie (D-105) to ta sama tablica z korkiem i nicią, z polami w
jednej kolumnie zygzakiem (karty min. 15 px), przewijana w pionie; tacka jest paskiem pod nią, przypina się stuknięciami (ślad, potem
pole; dwa przypięte się zamieniają), wynik pokazuje się nad tablicą. Dłuższa treść przewija się w pionie wewnątrz bloku; dolny pasek zostaje. layout-check: sekcja `mobile-summary` (`auditMobileView`).

## Podpowiedzi (D-093, dawniej maskotka)

Odtwarzacz nie pokazuje postaci. Podpowiedź to sam tekst w neutralnym dymku z ikoną żarówki (`player/Hint.tsx`): na scenie z punktami w
lewym dolnym rogu (chowa się, gdy otwarta jest nakładka), w blokach „slide” jako pasek nad treścią, w rozmowie nad wątkiem. Dymek zwija
się po 8 s albo przy pierwszej interakcji z blokiem; ikona rozwija go z powrotem.
Stała podpowiedź: `block.tip` z treści (D-096; w starszych wersjach treści `block.mascot.text`) albo domyślna dla typu (sceny z punktami: „Rozejrzyj się. Kliknij to, co wygląda
podejrzanie.”). Zdarzenia (`player/hints.tsx`): nowy dowód, zła odpowiedź, podpowiedź w zadaniu tekstowym - stałe teksty; reakcje z treści
(`reactions.complete/result`) - ich tekst. Podpowiedź zdarzenia trwa 5 s i dotyczy tylko bieżącego widoku. Pole `pose` z treści i API jest
przestarzałe i ignorowane. Reakcja na wynik bloku ocenianego (ekran informacji zwrotnej) to zwykły tekst pod wynikiem.

## Testy

- Web: Vitest + RTL (komponenty w `blocks/*.test.tsx`, integracja `CoursePlayer.*.test.tsx`, BFF `app/api/courses/**/route.test.ts`).
- API: `apps/api/test/course-engine.e2e-spec.ts` (wyciek klucza, sekwencyjność, izolacja A/B, embed).
- Przeglądarka: `scripts/e2e-registration.mjs` (Playwright, build produkcyjny): pełna ścieżka „Śledztwa” przez prawdziwe API, mail, kolejność, zadanie tekstowe, embed (CSP, sandbox, obcy origin), brak poziomego przewijania na 390 px, brak naruszeń CSP; zrzuty w `docs/brand/screens/` (poza gitem). Opis: `docs/e2e-registration.md`.
