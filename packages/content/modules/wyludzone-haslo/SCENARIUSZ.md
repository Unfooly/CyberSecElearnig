# Moduł 1 — „Sprawa: wyłudzone hasło"

Scenariusz treści dla silnika szkoleń (packages/content). Fabuła, postaci i firma są fikcyjne.
Agent mapuje ten dokument na schemat modułu (wersja 4: reactions, NARRATIVE, character.opening, subtitle/level/objectives): bloki, dowody, notatki, narrację,
pozy maskotki. Tam, gdzie schemat czegoś nie przewiduje, agent zgłasza, nie improwizuje.

## Metadane

- slug: `wyludzone-haslo`
- tytuł: „Sprawa: wyłudzone hasło"
- subtitle: „Phishing, hasła i jedna karteczka"
- category: `PHISHING_SOCIAL_ENGINEERING`, mandatory: true, schemaVersion: 4
- czas: ~12 minut
- level: `basic`
- objectives (4):
  1. „Rozpoznać fałszywą domenę w adresie nadawcy i w linku."
  2. „Wiedzieć, że ani bank, ani IT nie proszą o hasło ani kod SMS."
  3. „Nie zapisywać haseł na widoku i nie używać jednego hasła w wielu systemach."
  4. „Zgłosić podejrzany mail przyciskiem, zanim się kliknie."
- dowody łącznie: **15** (12 na ścieżce głównej: 9 ✱ w scenie/dialogach + 3 z analizy maila; 3 opcjonalne: drukarka, presja, inni)
- bloki oceniane: EMAIL_ANALYSIS (weight 3), ORDERING (weight 2), TEXT_INPUT_GUIDED (weight 1); pozostałe weight 0
- maskotka: Fooli; pozy z `packages/content/mascot/`
- zasoby: `packages/content/modules/wyludzone-haslo/assets/` (sceny SVG, avatary SVG); audio przez `scripts/content` (tryb r2)
- podpowiedzi (hints) są wyłącznie tekstowe — bez audio (D-060/K1)
- reakcje maskotki: pole `reactions` na bloku (`complete` dla eksploracyjnych, `result` dla ocenianych) — zastępuje dawne „Po ukończeniu: Fooli…"
- media w hotspotach (B-086/D-071): `hotspots[].media` (image/audio/document/scene) i `hotspots[].action: 'next'` (drzwi) — patrz Blok 2 i Blok 3 niżej.

## Postaci

| Postać | Rola | Avatar |
|---|---|---|
| Anna Kowalska | księgowa w Nortex Sp. z o.o. | `avatars/anna.svg` |
| Marek Zieliński | administrator IT (jednoosobowy dział) | `avatars/marek.svg` |
| „Bank Wektor" | fikcyjny bank; prawdziwa domena `bankwektor.pl`, fałszywa `bankwektor-weryfikacja.pl` | — |
| Gracz | „detektyw" — nowy audytor bezpieczeństwa w Nortex | — |

Fooli mówi do gracza per „ty". Lektor mówi w trzeciej osobie, spokojnie, jak narrator kryminału, bez żartów.

---

## Blok 1 — Otwarcie sprawy (NARRATIVE, weight 0)

Blok tekstowy bez interakcji, ukończony po wyświetleniu. Tekst bloku = treść poniżej (narracja lektora jako `narration`, dymek jako `mascot`, pytanie i dwie kwestie Fooli jako tekst bloku).

**Lektor (narracja):**
> Wtorek, 9:40. W dziale księgowości firmy Nortex zniknęło z konta czternaście tysięcy złotych. Przelew wyszedł o 9:12, zatwierdzony poprawnym loginem i hasłem Anny Kowalskiej. Anna twierdzi, że niczego nie wysyłała. Bank twierdzi, że wszystko odbyło się prawidłowo. Ktoś tu ma rację. Twoim zadaniem jest ustalić, co się stało — i jak do tego nie dopuścić następnym razem.

**Fooli (dymek, poza: greeting):**
> Cześć, detektywie. Mamy sprawę. Zbieraj dowody do notatnika — na końcu złożymy to w całość.

**Tekst bloku (markdown):**
> **Od czego zaczynamy?**
>
> Od miejsca zdarzenia. Biuro Anny — zobaczmy, co tam zostało.
>
> Klikaj wszystko, co wygląda podejrzanie. Nie wszystko jest dowodem, ale wszystko coś mówi.

**reactions.complete:** brak (przejście przyciskiem „Dalej").

---

## Blok 2 — Korytarz (SCENE_HOTSPOTS) — B-086/D-071

- obraz: `scenes/korytarz.svg` (1600×1000)
- imageAlt: „Korytarz biurowy: okno, tabliczka »Księgowość →«, tablica ogłoszeń, dwoje drzwi (Księgowość, IT), rośliny."
- **Lektor:** „Wtorek, 8:50. Anna z księgowości zgłosiła, że »coś jest nie tak z kontem«. Zacznij od jej biura — drzwi są przed tobą."
- **Fooli:** brak (blok czysto przejściowy — bez dymka).
- ukończenie: brak dowodów, bez przycisku „Dalej" — jedynym wyjściem jest hotspot `drzwi` (`action: 'next'`).
- drugie drzwi (IT) na obrazie są WYŁĄCZNIE dekoracją sceny (bez hotspotu) — Marek z IT pojawia się dopiero w Bloku 7 (DIALOGUE), nie jako osobna lokacja.

| id | x | y | w | h | action |
|---|---|---|---|---|---|
| `drzwi` | 43.8 | 36.6 | 12.4 | 42.8 | `next` |

---

## Blok 3 — Biuro Anny (SCENE_HOTSPOTS)

- obraz: `scenes/biuro-anny.svg` (1600×1000, przekomponowana wersja: drzwi po prawej, biurko krótsze, roślina po lewej)
- imageAlt: „Biuro księgowej: biurko z monitorem, na ramce monitora żółta karteczka, telefon stacjonarny z migającą diodą, kalendarz ścienny z zakreśloną datą, drukarka z wydrukiem na tacy, kubek z kawą, drzwi wyjściowe."
- **Lektor:** „Biuro Anny wygląda jak każde inne. Biurko, monitor, telefon, kubek po kawie. Ale w sprawach takich jak ta odpowiedź prawie zawsze leży na wierzchu."
- **Fooli (poza: pointing):** „Rozejrzyj się. Kliknij to, co wygląda podejrzanie."
- ukończenie: wymagane 4 z 6 hotspotów-dowodów (oznaczone ✱); `drzwi` (action:'next') wykluczone z tej puli (B-086/D-071) — nieaktywne (przygaszone, `aria-disabled` + tooltip „Zbierz najpierw dowody: X/Y") dopóki wymagane nie zebrane, potem wyjście z biura = koniec bloku.

| id | Element | Karta po kliknięciu | Dowód | Notatka (kind) | Media (B-086/D-071) |
|---|---|---|---|---|---|
| `karteczka` ✱ | żółta karteczka przyklejona do ramki monitora | „Na karteczce: `Nortex2024!` — a niżej dopisek długopisem: *bank: to samo*." | tak | (item) „Hasło do systemu księgowego zapisane na karteczce przy monitorze. To samo hasło do banku." | image `karteczka-zoom.svg` (800×800) — zbliżenie karteczki |
| `monitor` ✱ | ekran z otwartą skrzynką pocztową | „Ekran nie jest zablokowany — pulpit świeci się, tak jak Anna go zostawiła. Zobacz, co ma otwarte." (celowo TEASER, nie ujawnienie — treść maila jest dopiero za Outlookiem, patrz „Scena zagnieżdżona" niżej; poprawione po przeglądzie kodu, wcześniej to pole miało tu przez pomyłkę tę samą treść co `outlook`) | **nie** (patrz niżej) | — | **scene** `pulpit` (patrz sekcja „Scena zagnieżdżona" niżej) — dowód `mail` przeniesiony na hotspot `outlook` wewnątrz pulpitu |
| `telefon` ✱ | telefon stacjonarny z migającą diodą | „Prawdziwy bank nigdy nie prosi o kod SMS przez telefon. Kod SMS zawsze zatwierdza operację, nigdy jej nie anuluje." (insight, odsłaniany dopiero po odsłuchaniu do końca — patrz „Media: wiadomość głosowa" niżej; treść karty to insight, nie teaser — inaczej niż `monitor` powyżej, bo dla audio karta i tak nic nie pokazuje przed `onEnded`) | tak | (item) „Połączenie o 9:05 z numeru zastrzeżonego, Anna zapisała »informatyk«." | audio `assets/audio/poczta-glosowa.mp3` + transkrypcja (patrz „Media: wiadomość głosowa" niżej) |
| `kalendarz` ✱ | kalendarz ścienny z zakreśloną datą | „Wtorek zakreślony na czerwono: *PRZELEWY DO 15:00 — koniecznie!!!*. Anna miała dziś presję czasu." | tak | (place) „Anna miała dziś termin przelewów do 15:00 — działała pod presją." | image `kalendarz-zoom.svg` (800×1000) — zbliżenie kalendarza |
| `drukarka` | drukarka z kartką na tacy | „Wydruk potwierdzenia przelewu z 9:12. Odbiorca: *Wektor Rozliczenia Sp. z o.o.*, tytuł: *weryfikacja salda*. Anna nie zna tej firmy." | tak (opcjonalny) | (item) „Przelew z 9:12 na nieznaną firmę »Wektor Rozliczenia«, tytuł »weryfikacja salda«." | image `wydruk.svg` (800×1100) — **NIE** `document`: to gotowa grafika w stylu Fooli z pieczątką, nie linie tekstu (`document` zostaje w schemacie na przyszłość — dokumenty bez gotowej grafiki) |
| `kubek` | kubek z napisem „Najlepsza księgowa" | „Kawa wystygła. Anna wyszła w pośpiechu — chyba tuż po rozmowie telefonicznej." | nie | — | bez media (karta jak dziś, sam tekst) |
| `drzwi` | wyjście z biura | — (`action: 'next'`, nigdy nie otwiera karty — patrz „ukończenie" wyżej) | — | — | — |

**reactions.complete:** `{ pose: cheer, text: „Cztery ślady. Teraz porozmawiajmy z Anną." }`

### Scena zagnieżdżona `pulpit` (media.kind: scene na hotspocie `monitor`, B-086/D-071)

Zawsze dokładnie jeden poziom zagnieżdżenia (silnik to wymusza typami, nie tylko treścią): hotspoty wewnątrz `pulpit`
nie mogą mieć własnego `action` ani własnej zagnieżdżonej sceny.

- obraz: `scenes/pulpit.svg` (1200×800). Pulpit komputera z ikonami: Poczta (z odznaką „1"), Przelewy, Internet,
  Faktury, Kosz; pasek zadań pokazuje 8:52.
- hotspoty wewnętrzne:

| id | x | y | w | h | Karta po kliknięciu | Dowód | Notatka (kind) | Media |
|---|---|---|---|---|---|---|---|---|
| `outlook` | 4.2 | 5.0 | 17.7 | 28.1 | „Na ekranie otwarta wiadomość: *Bank Wektor — pilna weryfikacja konta firmowego*. Przyszła dziś o 8:47." | **tak** — dowód `mail` przeniesiony tu z `monitor` (patrz tabela wyżej) | (mail) „Mail od »Banku Wektor« z 8:47, temat: pilna weryfikacja konta." | image `mail-na-ekranie.svg` (1200×800), alt: „Otwarta wiadomość od Banku Wektor z 8:47" |

Uzasadnienie przeniesienia dowodu: prawdziwy dowód (treść maila) leży dopiero za Outlookiem — kredytowanie go samym
kliknięciem `monitor` (otwarcie pulpitu) byłoby przedwczesne. Otwarcie samego pulpitu (klik `monitor`) niczego nie
zalicza; dopiero klik w `outlook` (media.kind: image, jak każdy inny hotspot z mediami) zalicza dowód od razu przy
otwarciu karty — te same zasady co dla hotspotów najwyższego poziomu (patrz `karteczka`/`kalendarz` wyżej).

Pozostałe ikony pulpitu (Przelewy, Internet, Faktury, Kosz) są WYŁĄCZNIE dekoracją tła — bez hotspotów.

### Media: wiadomość głosowa „informatyka" (hotspot `telefon`)

Nagranie z **innym głosem** niż lektor (męski, uprzejmy, lekko pospieszny) — GOTOWY plik mp3 (nagrany osobno przez
właściciela treści w ElevenLabs, publikowany przez `--assets` jak obraz; NIE przechodzi przez silnik TTS/cues narracji
modułu, D-071).

**Transkrypcja (ok. 35 s):**
> Dzień dobry, pani Anno. Tomasz Wierzbicki, dział bezpieczeństwa, Bank Wektor. Dzwonię, bo nasz system wykrył przed chwilą próbę logowania do państwa konta firmowego z nietypowej lokalizacji. Zablokowaliśmy ją tymczasowo, ale żeby anulować operację, potrzebuję potwierdzenia z pani strony. Za moment przyjdzie do pani SMS z kodem — proszę go nie wpisywać nigdzie w systemie, tylko podać mi go przez telefon, wtedy anulujemy wszystko od naszej strony. To zajmie minutę. Proszę oddzwonić jak najszybciej, sprawa jest pilna — po dziesiątej system zablokuje rachunek automatycznie. Dziękuję i przepraszam za kłopot.

Insight (pole `content` hotspotu `telefon`, odsłaniany dopiero po odsłuchaniu do końca — onEnded, D-071): „Prawdziwy
bank nigdy nie prosi o kod SMS przez telefon. Kod SMS zawsze **zatwierdza** operację, nigdy jej nie anuluje." —
transkrypcja jest dostępna od razu (przycisk „Pokaż transkrypcję"), insight dopiero po pełnym odsłuchaniu.

### Media: wydruk przelewu (hotspot `drukarka`)

Treść, którą przedstawia grafika `wydruk.svg` (referencja dla kompozytora/regeneracji grafiki - sam plik jest gotową
ilustracją, `media.kind: image`, nie tekstem w treści modułu):

```
BANK WEKTOR — POTWIERDZENIE WYKONANIA PRZELEWU
Data i godzina:  wtorek, 09:12:41
Z rachunku:      Nortex Sp. z o.o.  PL 61 …… 4412
Na rachunek:     Wektor Rozliczenia Sp. z o.o.  PL 27 …… 9903
Kwota:           14 000,00 PLN
Tytuł:           weryfikacja salda
Autoryzacja:     kod SMS, 09:06:58
```

---

## Blok 4 — Rozmowa z Anną (DIALOGUE)

- postać: Anna Kowalska, księgowa, `avatars/anna.svg`
- **Lektor:** „Anna wróciła od telefonu. Jest roztrzęsiona, ale chce pomóc. Pytaj — ale słuchaj uważnie, bo ludzie pod stresem mówią więcej, niż im się wydaje."
- **Fooli (poza: thinking):** „Nie oceniaj. Pytaj."
- ukończenie: wymagane 3 z 5 pytań (✱)

**character.opening:** „Ja naprawdę nic nie zrobiłam. Znaczy… zrobiłam to, co kazali."

| id | Pytanie gracza | Kwestie Anny (po jednej) | Dowód | Notatka (kind) |
|---|---|---|---|---|
| `mail` ✱ | „Opowiedz o tym mailu z banku." | 1. „Przyszedł rano, wyglądał normalnie — logo, stopka, wszystko." 2. „Pisali, że konto firmowe będzie zablokowane do 10:00, jeśli nie potwierdzę danych." 3. „Kliknęłam w link, strona wyglądała jak nasz bank. Wpisałam login i hasło." | tak | (person) „Anna kliknęła link z maila i wpisała login oraz hasło na stronie »banku«." |
| `telefon` ✱ | „Kto dzwonił o 9:05?" | 1. „Informatyk z banku. Powiedział, że wykryli podejrzaną próbę logowania i muszą to zatrzymać." 2. „Poprosił o kod SMS, który właśnie przyszedł. Żeby *anulować* operację." 3. „Podałam. Był bardzo uprzejmy. Miał mój numer, znał nazwę firmy…" | tak | (person) „Anna podała przez telefon kod SMS »informatykowi z banku«, który miał anulować operację." |
| `haslo` ✱ | „To hasło na karteczce…" | 1. „Wiem, wiem. Ale mamy dwanaście systemów i każdy chce innego hasła." 2. „Marek z IT mówił, żebym używała menedżera haseł. Nie miałam kiedy." | tak | (person) „Anna używa tego samego hasła do systemu księgowego i banku; nie ma menedżera haseł." |
| `presja` | „Dlaczego działałaś tak szybko?" | 1. „Do 15:00 muszę puścić wszystkie przelewy do dostawców. Jak konto by zablokowali, nie zdążyłabym." 2. „W mailu był zegar. Odliczał." | tak (opcjonalny) | (person) „Mail zawierał odliczanie; Anna działała pod presją terminu przelewów." |
| `zglosic` | „Pomyślałaś, żeby to komuś zgłosić?" | 1. „Komu? Marek był na urlopie do wczoraj." 2. „Poza tym… to był bank. Bank się nie zgłasza, bank się słucha." | nie | — |

**reactions.complete:** `{ pose: warning, text: „Hasło, kod SMS, presja czasu. Trzy rzeczy, których prawdziwy bank nigdy nie połączy w jednej rozmowie. Zobaczmy ten mail." }`

---

## Blok 5 — Ten mail (EMAIL_ANALYSIS) — ocena, waga 3

- **Lektor:** „Oto wiadomość, od której wszystko się zaczęło. Przeczytaj ją tak, jak nie przeczytała jej Anna: powoli. Zaznacz wszystko, co powinno zapalić czerwoną lampkę."
- **Fooli (poza: pointing):** „Kliknij w mailu to, co jest podejrzane. Możesz zaznaczyć kilka rzeczy."
- makieta klienta pocztowego:

```
Od:       Bank Wektor — Dział Bezpieczeństwa <bezpieczenstwo@bankwektor-weryfikacja.pl>
Do:       a.kowalska@nortex.pl
Data:     wtorek, 8:47
Temat:    PILNE: weryfikacja konta firmowego — blokada o 10:00
Załącznik: Regulamin_weryfikacji.pdf.exe (412 KB)

Szanowna Kliencie,

W związku z aktualizacją systemów bezpieczeństwa Twoje konto firmowe
wymaga natychmiastowej weryfikacji. W przypadku braku potwierdzenia
do godziny 10:00 dostęp do rachunku zostanie tymczasowo zablokowany.

Pozostało: 01:12:33

Aby potwierdzić dane, kliknij tutaj:
  [ Przejdź do weryfikacji ]      → https://bankwektor-weryfikacja.pl/login?id=88213

Prosimy o nie odpowiadanie na tę wiadomość.

Z poważaniem,
Zespół Bezpieczeństwa Bank Wektor
Bank Wektor S.A. | ul. Przykładowa 1 | 00-001 Warszawa
```

- `Do:` mapuje na `email.to` (schemaVersion 4, pole `client`, opcjonalne) - dodane do schematu specjalnie dla tego modułu
  (rozjazd zgłoszony i rozstrzygnięty 2026-09-22: starsze moduły go nie mają, bo `email` w schemacie nie miało pola na
  adresata).

Kryteria (klikalne fragmenty; `correct` = powinno być zaznaczone):

| id | Fragment | correct | Dowód | Feedback po zatwierdzeniu | Notatka (kind) |
|---|---|---|---|---|---|
| `domena` | adres nadawcy `bankwektor-weryfikacja.pl` | tak | tak | „Prawdziwa domena banku to `bankwektor.pl`. Dopisek `-weryfikacja` robi z tego zupełnie inną stronę, którą może zarejestrować każdy." | (mail) „Nadawca z domeny `bankwektor-weryfikacja.pl`, nie `bankwektor.pl`." |
| `link` | link „Przejdź do weryfikacji" (URL w dymku po najechaniu) | tak | tak | „Napis mówi jedno, adres — drugie. Zawsze patrz na adres, nie na napis." | (mail) „Link prowadzi na `bankwektor-weryfikacja.pl/login`." |
| `zalacznik` | załącznik `Regulamin_weryfikacji.pdf.exe` | tak | tak | „`.pdf.exe` to program udający dokument. Bank nie wysyła programów." | (mail) „Załącznik `.pdf.exe` — plik wykonywalny udający PDF." |
| `presja` (bez kotwicy w mailu) | „do godziny 10:00 dostęp … zostanie zablokowany" + zegar | tak | nie | „Odliczanie i groźba blokady mają wyłączyć myślenie. Prawdziwy bank daje czas i nigdy nie odlicza." | — |
| `zwrot` | „Szanowna Kliencie" | tak | nie | „Błąd gramatyczny w zwrocie do klienta. Bank wie, jak się nazywasz." | — |
| `stopka` | stopka z adresem | nie | — | „Stopka jest skopiowana z prawdziwych maili banku — sama w sobie nic nie znaczy. Oszuści kopiują stopki jako pierwsze." | — |
| `nieodpowiadaj` | „Prosimy o nie odpowiadanie" | nie | — | „To standardowy zwrot w automatycznych mailach. Nie jest sygnałem." | — |

- `presja` bez kotwicy: `criteria[].target` (schemat) obsługuje jeden ciągły cytat z `email.body`, a ten fragment to dwa
  oddzielne elementy (zdanie o blokadzie + licznik) - kryterium jest widoczne i zaznaczalne wyłącznie na liście pod mailem,
  bez klikalnego fragmentu w treści (rozjazd zgłoszony i rozstrzygnięty 2026-09-22).
- punktacja: trafione kryteria +1, fałszywe alarmy −0,5 (nie poniżej 0), wynik jako % z 5 poprawnych
- **reactions.result** (progi po wzorze silnika; agent dopasuje minScore tak, by odpowiadały ≥4/5, 2–3/5, ≤1/5 trafień):
  - `{ minScore: 0.8, pose: cheer, text: „Czytasz maile jak detektyw." }`
  - `{ minScore: 0.4, pose: thinking, text: „Część złapałeś. Domena i link to dwa najważniejsze — zapamiętaj je." }`
  - `{ minScore: 0, pose: warning, text: „Ten mail złapałby też ciebie. Spójrz na adres nadawcy — tam zawsze zaczynaj." }`

---

## Blok 6 — Akta sprawy (TABS) — bez oceny

- **Lektor:** „Zanim porozmawiasz z Markiem z IT, zajrzyj do akt. Trzy rzeczy, które każdy w Nortex powinien znać."
- **Fooli (thinking):** „Krótka lektura. Przyda się za chwilę."
- ukończenie: otwarte wszystkie 3 zakładki

**Zakładka „Domeny":**
> Prawdziwe adresy Banku Wektor kończą się na `@bankwektor.pl`, a strona logowania to `https://www.bankwektor.pl`. Każda inna wersja — z myślnikiem, dopiskiem, inną końcówką (`.com`, `.net`, `.pl.info`) — nie jest bankiem. Sprawdzaj to, co jest **tuż przed pierwszym ukośnikiem** po `https://`.

**Zakładka „Czego bank nigdy nie zrobi":**
> - Nie poprosi o hasło — mailem, telefonem ani SMS-em.
> - Nie poprosi o kod SMS „żeby anulować operację". Kod SMS **zawsze zatwierdza**, nigdy nie anuluje.
> - Nie zadzwoni z numeru zastrzeżonego z prośbą o natychmiastowe działanie.
> - Nie wyśle programu (`.exe`, `.scr`, `.bat`) w załączniku.
> Jeśli masz wątpliwość: rozłącz się i zadzwoń na numer z **odwrotu swojej karty**, nie z maila.

**Zakładka „Jak zgłosić w Nortex":**
> Podejrzany mail: przycisk **„Zgłoś podejrzany mail"** w Unfooly albo przekaż do `bezpieczenstwo@nortex.pl`. Podejrzany telefon: rozłącz się, zapisz godzinę i numer, napisz do Marka. Nikt nie ma za to pretensji — pretensje są za brak zgłoszenia. Lepiej zgłosić dziesięć prawdziwych maili niż przegapić jeden fałszywy.

---

## Blok 7 — Rozmowa z Markiem z IT (DIALOGUE)

- postać: Marek Zieliński, administrator IT, `avatars/marek.svg`
- **Lektor:** „Marek wrócił z urlopu wczoraj wieczorem. Dziś rano zastał pożar. Ma logi — i ma coś, czego Anna nie wie."
- **Fooli (pointing):** „Marek widzi to, czego nie widać z biura Anny. Wyciągnij to z niego."
- ukończenie: wymagane 2 z 4 (✱)

**character.opening:** „Nie mów mi, że karteczka. Błagam, nie karteczka."

| id | Pytanie gracza | Kwestie Marka | Dowód | Notatka (kind) |
|---|---|---|---|---|
| `logi` ✱ | „Co mówią logi banku?" | 1. „Logowanie o 9:03 z adresu IP w innym kraju. Poprawny login, poprawne hasło — bo Anna je wpisała na ich stronie o 8:58." 2. „Przelew o 9:12, zatwierdzony kodem SMS. Tym, który Anna podała przez telefon." | tak | (item) „Logi: logowanie z zagranicy o 9:03 po wpisaniu danych przez Annę o 8:58; przelew 9:12 zatwierdzony kodem SMS podanym przez telefon." |
| `dzwonil` ✱ | „Ktoś z IT dzwonił do Anny o 9:05?" | 1. „Nikt. Jestem jedynym informatykiem w tej firmie, a o 9:05 stałem w korku." 2. „Bank też nie dzwoni z zastrzeżonego. Ten »informatyk« to był oszust — i to on wtedy siedział zalogowany na koncie Anny, czekając na kod." | tak | (person) „Nikt z IT ani z banku nie dzwonił o 9:05 — dzwonił oszust, już zalogowany, po kod SMS." |
| `inni` | „Czy ktoś jeszcze dostał ten mail?" | 1. „Sprawdziłem: siedem osób. Dwie kliknęły w link, ale nie wpisały danych — strona wydała im się dziwna." 2. „Nikt nie zgłosił. Ani jedna osoba. Gdyby pierwsza kliknęła »Zgłoś«, zablokowałbym domenę przed 8:55." | tak (opcjonalny) | (mail) „Mail trafił do 7 osób, 2 kliknęły, nikt nie zgłosił." |
| `co_teraz` | „Co robimy teraz?" | 1. „Bank próbuje cofnąć przelew — czasem się udaje, jeśli zgłosisz w ciągu godziny. Tu minęło pięć." 2. „Zmieniamy hasła Anny — wszystkie, bo były takie same. Włączamy menedżer haseł dla całej księgowości." 3. „I zgłaszamy na policję. To przestępstwo, nie wpadka." | nie | — |

**reactions.complete:** `{ pose: thinking, text: „Masz już wszystko. Ułóżmy to w kolejności." }`

---

## Blok 8 — Rekonstrukcja zdarzeń (ORDERING) — ocena, waga 2

- **Lektor:** „Sześć zdarzeń. Jedna kolejność. Ułóż je tak, jak naprawdę się wydarzyły."
- **Fooli (pointing):** „Przeciągnij albo użyj strzałek. Kolejność ma znaczenie — bo pokazuje, gdzie można było przerwać łańcuch."
- elementy (podane wymieszane; poprawna kolejność jak niżej):

1. `mail` — 8:47 — Do skrzynki Anny trafia mail z domeny `bankwektor-weryfikacja.pl`.
2. `link` — 8:58 — Anna klika link i wpisuje login oraz hasło na fałszywej stronie.
3. `login` — 9:03 — Oszust loguje się do prawdziwego banku danymi Anny.
4. `telefon` — 9:05 — „Informatyk" dzwoni po kod SMS, „żeby anulować operację".
5. `kod` — 9:06 — Anna podaje kod; oszust zatwierdza przelew.
6. `przelew` — 9:12 — 14 000 zł wychodzi na konto „Wektor Rozliczenia".

- punktacja: częściowa (liczba elementów na właściwej pozycji / 6); pełne punkty tylko za komplet
- **reactions.result:**
  - `{ minScore: 1, pose: cheer, text: „Dokładnie tak. I zauważ: łańcuch dało się przerwać w trzech miejscach — przy mailu, przy stronie i przy telefonie." }`
  - `{ minScore: 0, pose: thinking, text: „Blisko. Kluczowe: logowanie oszusta było przed telefonem. Dzwonił, bo już był w środku i brakowało mu tylko kodu." }`

---

## Blok 9 — Ostatnie pytanie (TEXT_INPUT_GUIDED) — ocena, waga 1

- **Lektor:** „Zostało jedno pytanie. Najważniejsze — bo to ono uratuje cię następnym razem."
- **Fooli (thinking):** „Bez zaglądania do notatnika. Pamiętasz?"
- polecenie: „Wpisz domenę, z której przyszedł fałszywy mail (samą domenę, bez `https://` i bez adresu e-mail)."
- odpowiedź: regex `^(www\.)?bankwektor-weryfikacja\.pl/?$`, caseSensitive: false, trim
- maxAttempts: 3
- podpowiedzi (po każdej nieudanej próbie):
  1. „Spójrz na to, co jest po `@` w adresie nadawcy."
  2. „Prawdziwa domena to `bankwektor.pl`. Fałszywa miała coś dopisane po myślniku."
- rozwiązanie po wyczerpaniu prób: „`bankwektor-weryfikacja.pl`. Jedno słowo po myślniku wystarczyło, żeby to nie był bank."
- **reactions.result** (po `correct`, nie po progu):
  - `{ when: correct, pose: cheer, text: „To jest to. Domena, nie napis. Zawsze domena." }`
  - `{ when: incorrect, pose: warning, text: „Nic straconego — ale zapamiętaj ten adres. Następny będzie wyglądał podobnie." }`

---

## Blok 10 — Rozwiązanie sprawy (SUMMARY)

- **Lektor:** „Sprawa Anny nie była sprawą o głupotę. Była sprawą o pośpiech, zaufanie i jedną karteczkę. Oszust nie złamał żadnego zabezpieczenia. Poprosił — i dostał. Następnym razem, kiedy ktoś poprosi cię o hasło, kod albo »szybkie potwierdzenie«, przypomnij sobie wtorek, 8:47."
- **mascot:** `{ pose: greeting, text: „Sprawa zamknięta. Dobra robota, detektywie." }`
- SUMMARY pokazuje też `objectives` jako „Czego się nauczyłeś".
- tekst wniosków (sekcja „Najważniejsze wnioski", poza automatyczną listą dowodów):

> **Trzy rzeczy do zapamiętania**
> 1. **Domena, nie napis.** Sprawdzaj adres nadawcy i adres linku — to, co jest tuż przed pierwszym ukośnikiem.
> 2. **Kod SMS zawsze zatwierdza.** Nikt — ani bank, ani IT — nie prosi o kod „żeby coś anulować".
> 3. **Zgłoś, zanim klikniesz.** Przycisk „Zgłoś podejrzany mail" jest po to, żeby Marek zablokował domenę, zanim ktoś wpisze hasło.
>
> **Co zmienił Nortex po tej sprawie:** menedżer haseł dla wszystkich, osobne hasła do każdego systemu, zasada „bank dzwoni — ja oddzwaniam na numer z karty".

- przycisk: „Zakończ sprawę" → ekran wyniku (istniejący)

---

## Zasoby do przygotowania

Sceny SVG, styl płaski jak Fooli, paleta `#F0883A / #6C5CE7 / #2B2440` + neutralne. Źródła scen (JSON dla
kompozytora) leżą w `scripts/content/scenes/examples/` — każda zmiana grafiki to edycja JSON + `build`, nigdy ręczna
edycja SVG.

| plik | rozmiar | użycie |
|---|---|---|
| `scenes/korytarz.svg` | 1600×1000 | Blok 2 (korytarz) |
| `scenes/biuro-anny.svg` | 1600×1000 | Blok 3 (Biuro Anny) |
| `scenes/pulpit.svg` | 1200×800 | zagnieżdżona scena na hotspocie `monitor` |
| `scenes/mail-na-ekranie.svg` | 1200×800 | media image na hotspocie `outlook` (wewnątrz `pulpit`) |
| `scenes/karteczka-zoom.svg` | 800×800 | media image na hotspocie `karteczka` |
| `scenes/kalendarz-zoom.svg` | 800×1000 | media image na hotspocie `kalendarz` |
| `scenes/wydruk.svg` | 800×1100 | media image na hotspocie `drukarka` |

Avatary SVG: `avatars/anna.svg`, `avatars/marek.svg` (256×256) — półportrety w tym samym stylu.

Audio: `assets/audio/poczta-glosowa.mp3` (hotspot `telefon`, transkrypcja w Bloku 3 wyżej) — gotowy plik, publikowany
przez `scripts/content --assets` (D-071), NIE przez silnik TTS narracji modułu (`scripts/content --tts`, PR 3, każdy
blok ma jedno nagranie lektora — tekst „Lektor" wyżej). Kwestie Fooli i postaci — tylko tekst (B-078).

## Współrzędne hotspotów (% szerokości/wysokości: x, y, w, h)

**`scenes/korytarz.svg`** (Blok 2):

| id | x | y | w | h |
|---|---|---|---|---|
| `drzwi` | 43.8 | 36.6 | 12.4 | 42.8 |

**`scenes/biuro-anny.svg`** (Blok 3):

| id | x | y | w | h |
|---|---|---|---|---|
| `kalendarz` | 73.3 | 11.2 | 13.0 | 23.6 |
| `drzwi` | 87.9 | 36.6 | 12.1 | 42.8 |
| `drukarka` | 8.9 | 51.2 | 15.4 | 14.6 |
| `kubek` | 24.5 | 53.7 | 6.0 | 7.8 |
| `monitor` | 30.8 | 27.2 | 27.3 | 34.8 |
| `karteczka` | 53.3 | 24.2 | 7.9 | 11.6 |
| `telefon` | 59.5 | 51.4 | 12.3 | 12.8 |

**`scenes/pulpit.svg`** (zagnieżdżona scena na `monitor`):

| id | x | y | w | h |
|---|---|---|---|---|
| `outlook` | 4.2 | 5.0 | 17.7 | 28.1 |

SVG bez skryptów, bez zewnętrznych odwołań. `biuro-anny.svg`: jedna animacja `<animate>` (dioda telefonu) - jeśli
lint jej nie przepuści, usunąć element `<animate>`.
