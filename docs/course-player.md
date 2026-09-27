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

| Typ | Komponent | `answer` | Wynik / uwagi |
|---|---|---|---|
| `VIDEO`, `DRAG_AND_DROP` | `VideoBlock`, `DragAndDropBlock` | brak | nieoceniane; wideo spoza `CONTENT_BASE_URL` to link „Otwórz wideo” (B-076) |
| `QUIZ`, `BRANCHING_SCENARIO` | `SingleChoiceBlock` | indeks opcji | poprawność z serwera; w podglądzie „Twoja odpowiedź” |
| `SCENE_HOTSPOTS` | `SceneHotspotsBlock` | `{ visited, noted }` | ukończenie po punktach `required`; klik = zbliżenie przedmiotu (D-086), „Zabierz” zalicza dowód tylko dla `evidence` (inaczej toast „To nie jest dowód w tej sprawie.”) |
| `DIALOGUE` | `DialogueBlock` | `{ asked }` | komunikator (D-087): rozmówca „pisze” przed każdą kwestią (także otwierającą), dźwięki przy włączonym Lektorze; pytanie liczy się po ostatniej kwestii |
| `TABS` | `TabsBlock` | `{ opened }` | wzorzec ARIA tabs |
| `NOTEPAD`, `SUMMARY` | `NotepadBlock`, `SummaryBlock` | brak | `SUMMARY` z dowodami to „Rozwiązanie sprawy” (przeoczone tylko liczbowo) |
| `EMAIL_ANALYSIS` | `EmailAnalysisBlock` | `{ selected }` (id nieprzejrzyste) | klik we fragment maila zaznacza kryterium; link nigdy nie nawiguje; wynik z `detail` |
| `ORDERING` | `OrderingBlock` | `{ order }` (id nieprzejrzyste) | przyciski w górę/w dół (ścieżka główna) i przeciąganie |
| `TEXT_INPUT_GUIDED` | `TextInputBlock` | brak (próby: `POST /api/courses/:id/blocks/:blockId/attempt`, `{ answer }`) | podpowiedź po błędnej próbie, rozwiązanie po wyczerpaniu prób |
| `EMBEDDED_HTML` | `EmbeddedHtmlBlock` | brak | osobny dokument w iframe (niżej) |

Bloki eksploracyjne mają wagę 0; `weight` w treści może im nadać udział w wyniku.

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
- `NarrationPlayer` (dolny pasek): play, suwak, czas, przełącznik „Lektor” (`role="switch"`, zapis na koncie: `users.narrationEnabled`), napis w jednej linii przewijany z nagraniem, transkrypcja. Napisy z `cues`, a bez nich podział na zdania proporcjonalny do długości (`lib/narration-captions.ts`).
- Autoodtwarzanie tylko po „Dalej”, gdy poprzedni blok miał nagranie i lektor jest włączony. Blok bez narracji nie ma rzędu odtwarzacza ani przełącznika (zamierzone).
- Narracja pojedynczych elementów (punkt sceny, kwestia dialogu): B-078.

## Maskotka

Pozy: `greeting`, `thinking`, `pointing`, `cheer`, `warning` (SVG w `packages/content/mascot`, kopiowane do `public/mascot` w buildzie, ładowane przez `<img>`).
Poza spoczynkowa: `block.mascot` z treści albo domyślna dla typu (sceny z punktami: `pointing` z domyślnym tekstem). Reakcje na zdarzenia (`player/mascot-reaction.tsx`): nowy dowód = `cheer`, zła odpowiedź = `warning`, podpowiedź = `thinking`; reakcja trwa kilka sekund i dotyczy tylko bieżącego widoku.

## Testy

- Web: Vitest + RTL (komponenty w `blocks/*.test.tsx`, integracja `CoursePlayer.*.test.tsx`, BFF `app/api/courses/**/route.test.ts`).
- API: `apps/api/test/course-engine.e2e-spec.ts` (wyciek klucza, sekwencyjność, izolacja A/B, embed).
- Przeglądarka: `scripts/e2e-registration.mjs` (Playwright, build produkcyjny): pełna ścieżka „Śledztwa” przez prawdziwe API, mail, kolejność, zadanie tekstowe, embed (CSP, sandbox, obcy origin), brak poziomego przewijania na 390 px, brak naruszeń CSP; zrzuty w `docs/brand/screens/` (poza gitem). Opis: `docs/e2e-registration.md`.
