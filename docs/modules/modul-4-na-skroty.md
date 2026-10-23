# Moduł 4 „Na skróty” - scenariusz (zatwierdzony przez właściciela 2026-10-23)

Źródło: specyfikacja właściciela z 2026-10-19 (zastępuje wcześniejszą). Ten dokument uzupełnia ją o wszystkie teksty, których
specyfikacja nie podawała (narracje, karty przedmiotów, informacja zwrotna, odpowiedzi błędne), i jest źródłem prawdy dla
`module.json` (MODULE-PLAYBOOK, rozdział 1). Teksty z kursywą *(spec)* są przepisane ze specyfikacji bez zmian.

## 1. Założenia

- **Temat:** czym jest shadow IT i jakie ma skutki. **Bez wątku kryminalnego** - bez oszustów, fałszywych faktur i wycieków do
  przestępców. Ton: Bartek chciał dobrze, IT pomaga - bez straszenia karą dla pracownika.
- **Tryb prosty** (`simpleMode: true`, D-132): tekst ≥ 16 px na 390 px, bloki dozwolone w trybie prostym (odprawa, sceny, QUIZ,
  SWIPE_SORT, raport). `locales: ["pl"]`. EN dopiero po „zatwierdzam treść modułu 4” (D-143).
- **DoD (D-143):** PL gotowe + pseudo-lokalizacja zielona - sceny ze `strings` przechodzą `pseudo-locale.test.ts` bez nowych wpisów
  `KNOWN_TOO_TIGHT`, layout-check `pseudo` zielony.
- **Bez form rodzajowych w poleceniach i pytaniach** (decyzja właściciela 2026-10-23): w trybie prostym nie „-łeś/-łaś” - pytania
  bezosobowo („Dane klientów trafiły już…”), odpowiedzi w 1. osobie czasu teraźniejszego („Zgłaszam…”).
- **Nazwy fikcyjne** (rozdział 8 playbooka): Bartek Lis (marketing), narzędzia „CzatPomocnik”, „MojaChmura”, „PDF Zamiennik Free”;
  domeny `.test`; bez logotypów prawdziwych firm.
- **Głosy jak w module 3:** lektor-przewodnik `komisarz` (A.W.). Bartek nie mówi (nie potrzebuje roli głosu).

## 2. Metadane

| pole | wartość |
|---|---|
| slug | `na-skroty` |
| title | Na skróty |
| subtitle | Darmowe narzędzia z internetu w pracy - czym jest shadow IT i co może pójść nie tak |
| category | `IT_HYGIENE` (decyzja właściciela - pkt 7.3) |
| level | `basic` |
| durationMinutes | 7 |
| objectives | 1) Wiedzieć, czym jest shadow IT: narzędzie do pracy, którego firma nie sprawdziła i nie zatwierdziła. 2) Znać skutki: dane firmy u obcej firmy, złośliwe dodatki, naruszenie danych osobowych, utrata plików. 3) Przed użyciem nowego programu, strony albo AI zapytać IT. 4) Gdy coś poszło nie tak - od razu zgłosić to do IT. |

## 3. Bloki

### 3.1 Odprawa (BRIEFING, `odprawa`) - scena statyczna

- **Grafika:** biurko Bartka wieczorem (lampka, ciemne okno), laptop z ekranem „Raport na jutro, 9:00” (napis wpalony przez `strings`).
- **Krok (maszyna do pisania, lektor `komisarz`):**
  > Wieczór przed ważnym spotkaniem. Bartek Lis z marketingu ma do rana przygotować raport. Chciał zdążyć, więc sięgnął po kilka
  > darmowych narzędzi z internetu. Takie skróty mają swoją nazwę: shadow IT. Zobacz, czego użył.
- **Przycisk:** „Zobacz biurko Bartka”.

### 3.2 Co to jest shadow IT (SCENE_HOTSPOTS, `biurko`)

- **Narracja wejścia (`komisarz`)** *(spec)*: „Shadow IT to każde narzędzie, którego używasz do pracy, a którego firma nie sprawdziła
  i nie zatwierdziła.”
- **Podpowiedź (tip):** Wskaż cztery narzędzia, których Bartek użył bez wiedzy IT.
- **Grafika:** biurko i laptop Bartka (wariant pionowy na telefon), cztery przedmioty - wszystkie wymagane, każdy z notatką:

| przedmiot | etykieta | treść karty | notatka |
|---|---|---|---|
| ekran laptopa: czat AI z wklejoną tabelą klientów (dane rozmyte) | CzatPomocnik | Bartek wkleił do darmowego czatu AI tabelę z danymi klientów. Te dane są teraz na serwerach obcej firmy. | Dane klientów wklejone do darmowego czatu AI. |
| okno dysku w chmurze, folder „Raporty firmowe” | MojaChmura | Folder „Raporty firmowe” leży na prywatnym dysku w chmurze. Firma nie ma do niego dostępu ani kopii zapasowej. | Firmowe raporty na prywatnym dysku w chmurze. |
| ikona programu na pulpicie | PDF Zamiennik Free | Program ściągnięty z internetu. Nikt w firmie go nie sprawdził - może mieć ukryte dodatki. | Program z internetu, którego nikt nie sprawdził. |
| prywatny pendrive w porcie laptopa | Pendrive | Prywatny pendrive w firmowym laptopie. Nie wiadomo, co na nim jest, a firmowe pliki łatwo z nim zgubić. | Prywatny pendrive w firmowym laptopie. |

### 3.3 Co może pójść nie tak (SCENE_HOTSPOTS, `skutki`)

- **Narracja wejścia (`komisarz`):** Każdy taki skrót może kosztować więcej, niż daje. Sprawdź wszystkie cztery karty.
- **Podpowiedź (tip):** Otwórz każdą z czterech kart.
- **Grafika:** tablica z czterema kartami (tytuły kart wpalone przez `strings`, duże - min. 16 px na 390 px); wszystkie wymagane.
  Treść kart *(spec)*, każda ≤ 140 znaków:

| karta | treść |
|---|---|
| Dane firmy u obcej firmy | To, co wkleisz do darmowego narzędzia, trafia na cudze serwery; nie wiesz, kto ma do tego dostęp i czy narzędzie się na tym nie uczy. |
| Wirus w pakiecie | Darmowe programy i rozszerzenia z internetu często mają ukryte złośliwe dodatki. |
| Problem prawny firmy | Jeśli to dane osobowe, firma może musieć zgłosić naruszenie do UODO w ciągu 72 godzin i ryzykuje karę. |
| Utrata plików | Prywatne konto nie ma firmowej kopii zapasowej; gdy konto zniknie albo pracownik odejdzie, pliki przepadają. |

### 3.4 Bezpieczne czy zapytaj IT? (SWIPE_SORT, `bezpieczne-czy-it`) - z rozszerzeniem schematu (pkt 7.1)

- **Polecenie:** Oceń każdą sytuację: bezpieczne czy najpierw zapytać IT?
- **Werdykty:** w lewo „Zapytaj IT”, w prawo „Bezpieczne” (dziś na sztywno „Podejrzane” / „W porządku”).
- **Karty-sytuacje (bez nadawcy i godziny):**

| sytuacja | werdykt | zdanie po werdykcie (≤ 140) |
|---|---|---|
| Wklejam umowę z klientem do darmowego czatu AI, żeby ją streścić. | Zapytaj IT | Umowa trafiłaby na serwery obcej firmy. Do dokumentów używaj narzędzi zatwierdzonych przez IT. |
| Zapisuję raport na firmowym dysku. | Bezpieczne | Tak - firmowy dysk ma kopię zapasową, a dostęp mają tylko osoby z firmy. |
| Zamieniam listę płac na PDF w darmowym konwerterze online. | Zapytaj IT | Lista płac to dane osobowe - nie wysyłaj jej na obce strony. IT wskaże firmowe narzędzie. |
| Instaluję w przeglądarce rozszerzenie „Darmowy VPN”. | Zapytaj IT | Takie rozszerzenie widzi wszystko, co robisz w przeglądarce. Zapytaj IT przed instalacją. |
| Instaluję program z firmowego katalogu aplikacji. | Bezpieczne | Tak - programy z firmowego katalogu IT już sprawdziło. |
| Wysyłam plik z ofertą na prywatną skrzynkę, żeby skończyć w domu. | Zapytaj IT | Prywatna poczta to już poza firmą. Zapytaj IT o bezpieczny dostęp z domu. |

- **Podpowiedź po 2 błędach:** Czy firma sprawdziła to narzędzie? Jeśli nie - zapytaj IT.

### 3.5 Programu nie ma na liście firmowej (QUIZ, `brak-programu`)

- **Pytanie:** Potrzebujesz programu do edycji PDF, a nie ma go w firmowym katalogu. Co robisz?
- **Odpowiedzi:**
  - Pobieram pierwszy darmowy program, jaki znajdę w internecie. → *Darmowe programy z internetu bywają z ukrytymi dodatkami - firma nie wie, co instalujesz.*
  - ✔ **Zgłaszam potrzebę do IT i piszę, do czego jest mi potrzebny.** *(spec)* → *Tak - IT znajdzie bezpieczne narzędzie albo sprawdzi to, którego chcesz użyć.*
  - Proszę kolegę, żeby zainstalował mi swój program. → *To nadal program, którego nikt nie sprawdził - decyzję zostaw IT.*
- **Podpowiedź:** Kto w firmie sprawdza i zatwierdza programy?

### 3.6 Dane już wklejone (QUIZ, `juz-wklejone`)

- **Pytanie:** Dane klientów trafiły już do darmowego czatu AI. Co teraz?
- **Odpowiedzi:**
  - Kasuję historię rozmowy i nic nie mówię. → *(spec)* *Skasowanie historii u siebie nie usuwa danych z serwerów narzędzia.*
  - ✔ **Od razu zgłaszam to do IT.** *(spec)* → *Tak - liczy się czas. IT oceni, co się stało, i pomoże ograniczyć skutki.*
  - Czekam, czy coś się stanie. → *Jeśli to dane osobowe, firma ma 72 godziny na zgłoszenie naruszenia - czekanie zabiera ten czas.*
- **Podpowiedź:** Im szybciej IT się dowie, tym więcej da się zrobić.

### 3.7 Raport (SUMMARY, `raport`) - elementy zamknięcia jak w module 3 (≥ 16 px)

- **Narracja (`komisarz`):** Raport gotowy na czas, a dane zostały w firmie. Bartek zgłosił IT, czego potrzebuje, i dostał bezpieczne
  narzędzia.
- **Tekst raportu:** Bartek zgłosił do IT program do PDF i dane wklejone do czatu. IT pomogło ograniczyć skutki, a do raportu znalazło
  firmowe narzędzia. Następnym razem Bartek zacznie od pytania.
- **Trzy zasady** *(spec, dosłownie)*:
  1. Nowy program, strona albo AI do pracy? Najpierw zapytaj IT – pomogą znaleźć bezpieczne narzędzie.
  2. Dane firmy i klientów tylko w firmowych narzędziach – także w AI.
  3. Coś poszło nie tak? Zgłoś od razu. Liczy się czas, nie szukanie winnych.
- **Pieczęć i liścik** (pkt 7.2, zatwierdzone): pieczęć „SPRAWA ZAMKNIĘTA”, liścik „Najpierw zapytaj IT. — A.W.”.

## 4. Grafiki (kompozytor, `scripts/content/scenes/examples/na-skroty/`)

Wszystkie ze `strings` (`pl`), tekst ≥ 16 px na 390 px (`minTextPx: 16`), tekst potrzebny do zadania z kluczem `evidence`, każda
scena zielona w `xx` (pseudo-lokalizacja). Arkusze i zrzuty (pl-PL) do `docs/brand/screens/m4/` - przegląd właściciela przed merge.

| grafika | wariant pionowy | tekst wpalony |
|---|---|---|
| `odprawa-biurko` (wieczór, laptop „Raport na jutro, 9:00”) | tak | „Raport na jutro, 9:00” |
| `biurko-bartka` (4 przedmioty) + zbliżenia ekranu czatu i okna dysku | tak | nazwy narzędzi, „Raporty firmowe”; tabela klientów rozmyta (bez danych) |
| `tablica-skutki` (4 karty) | tak | tytuły czterech kart |
| `zamkniecie-raport(-pion)`, `zamkniecie-pieczec`, `zamkniecie-liscik` | raport - tak | jak moduł 3 |
| `miniatura-na-skroty` | nie | bez tekstu |

## 5. Nagrania

Lektor `komisarz`: odprawa, narracje wejścia scen, narracja raportu. Odpowiedzi QUIZ i karty - bez nagrań (jak moduł 3).

## 6. Weryfikacja (DoD)

`tts --check` i `--assets --check` (+ `--remote`), `npm test` w `scripts/content` (sceny, zasoby, pseudo-lokalizacja), layout-check
`LAYOUT_CHECK_MODULE=na-skroty` sekcje `module`, `prosty` (jeśli dotyczy), `pseudo`; e2e smoke `scripts/e2e-module.mjs na-skroty` i pełne
przejście; content-import; zrzuty pl-PL.

## 7. Decyzje właściciela (2026-10-23)

1. **SWIPE_SORT - własne werdykty i karty-sytuacje: TAK**, osobny mały PR przed treścią modułu: opcjonalne `labels: { suspicious, ok }`
   jako `Localized` (pl/en) i karta `channel: "situation"` (sam tekst, bez nadawcy i godziny). Domyślne etykiety bez zmian - moduł 3
   wygląda i działa identycznie (test). Etykiety ≤ 16 znaków, sprawdzone w pseudo-lokalizacji na 390 px. Bez migracji.
2. **Pieczęć:** zostaje „SPRAWA ZAMKNIĘTA” (rama serii z detektywem A.W.). **Liścik:** „Najpierw zapytaj IT. — A.W.”.
3. **Kategoria:** `IT_HYGIENE`. Nowej kategorii teraz nie dodajemy (wróci przy module o RODO).
