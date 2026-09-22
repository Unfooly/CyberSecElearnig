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

## Blok 2 — Biuro Anny (SCENE_HOTSPOTS)

- obraz: `scenes/biuro-anny.svg` (1600×1000, hotspoty w procentach)
- imageAlt: „Biuro księgowej: biurko z monitorem, na ramce monitora żółta karteczka, telefon stacjonarny z migającą diodą, kalendarz ścienny z zakreśloną datą, drukarka z wydrukiem na tacy, kubek z kawą."
- **Lektor:** „Biuro Anny wygląda jak każde inne. Biurko, monitor, telefon, kubek po kawie. Ale w sprawach takich jak ta odpowiedź prawie zawsze leży na wierzchu."
- **Fooli (poza: pointing):** „Rozejrzyj się. Kliknij to, co wygląda podejrzanie."
- ukończenie: wymagane 4 z 6 hotspotów (oznaczone ✱)

| id | Element | Karta po kliknięciu | Dowód | Notatka (kind) |
|---|---|---|---|---|
| `karteczka` ✱ | żółta karteczka przyklejona do ramki monitora | „Na karteczce: `Nortex2024!` — a niżej dopisek długopisem: *bank: to samo*." | tak | (item) „Hasło do systemu księgowego zapisane na karteczce przy monitorze. To samo hasło do banku." |
| `monitor` ✱ | ekran z otwartą skrzynką pocztową | „Na ekranie otwarta wiadomość: *Bank Wektor — pilna weryfikacja konta firmowego*. Przyszła dziś o 8:47." | tak | (mail) „Mail od »Banku Wektor« z 8:47, temat: pilna weryfikacja konta." |
| `telefon` ✱ | telefon stacjonarny z migającą diodą | „Nieodebrane połączenie z 9:05, numer zastrzeżony. Na wyświetlaczu notatka Anny: *informatyk, oddzwonić*." | tak | (item) „Połączenie o 9:05 z numeru zastrzeżonego, Anna zapisała »informatyk«." |
| `kalendarz` ✱ | kalendarz ścienny z zakreśloną datą | „Wtorek zakreślony na czerwono: *PRZELEWY DO 15:00 — koniecznie!!!*. Anna miała dziś presję czasu." | tak | (place) „Anna miała dziś termin przelewów do 15:00 — działała pod presją." |
| `drukarka` | drukarka z kartką na tacy | „Wydruk potwierdzenia przelewu z 9:12. Odbiorca: *Wektor Rozliczenia Sp. z o.o.*, tytuł: *weryfikacja salda*. Anna nie zna tej firmy." | tak (opcjonalny) | (item) „Przelew z 9:12 na nieznaną firmę »Wektor Rozliczenia«, tytuł »weryfikacja salda«." |
| `kubek` | kubek z napisem „Najlepsza księgowa" | „Kawa wystygła. Anna wyszła w pośpiechu — chyba tuż po rozmowie telefonicznej." | nie | — |

**reactions.complete:** `{ pose: cheer, text: „Cztery ślady. Teraz porozmawiajmy z Anną." }`

---

## Blok 3 — Rozmowa z Anną (DIALOGUE)

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

## Blok 4 — Ten mail (EMAIL_ANALYSIS) — ocena, waga 3

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

## Blok 5 — Akta sprawy (TABS) — bez oceny

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

## Blok 6 — Rozmowa z Markiem z IT (DIALOGUE)

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

## Blok 7 — Rekonstrukcja zdarzeń (ORDERING) — ocena, waga 2

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

## Blok 8 — Ostatnie pytanie (TEXT_INPUT_GUIDED) — ocena, waga 1

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

## Blok 9 — Rozwiązanie sprawy (SUMMARY)

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

Sceny SVG (dostarczę osobno, styl płaski jak Fooli, paleta `#F0883A / #6C5CE7 / #2B2440` + neutralne):
- `scenes/biuro-anny.svg` — biurko, monitor z otwartą skrzynką, karteczka na ramce, telefon z diodą, kalendarz na ścianie, drukarka, kubek. Hotspoty jako prostokąty w % (agent odczyta z warstwy `hotspots` w SVG lub z tabeli poniżej).

Avatary SVG: `avatars/anna.svg`, `avatars/marek.svg` — półportrety w tym samym stylu.

Narracja (PR 3): każdy blok ma jedno nagranie lektora (tekst „Lektor" wyżej). Kwestie Fooli i postaci — tylko tekst (B-078). Głos: spokojny, męski lub żeński, bez „reklamowego" tonu.

## Współrzędne hotspotów (scenes/biuro-anny.svg, % szerokości/wysokości: x, y, w, h)

| id | x | y | w | h |
|---|---|---|---|---|
| monitor | 30 | 28 | 26.5 | 29.5 |
| karteczka | 52.5 | 25.5 | 7 | 9.5 |
| telefon | 62 | 52 | 12 | 11.5 |
| kalendarz | 79.5 | 11.5 | 12.5 | 23 |
| drukarka | 6.5 | 51.5 | 15 | 14 |
| kubek | 21 | 54 | 6 | 7 |

Pliki: `modul-01-assets/scenes/biuro-anny.svg` (1600×1000), `modul-01-assets/avatars/anna.svg`, `modul-01-assets/avatars/marek.svg` (256×256). Docelowo w `packages/content/modules/wyludzone-haslo/assets/`. SVG bez skryptów, bez zewnętrznych odwołań, jedna animacja `<animate>` (dioda telefonu) - jeśli lint jej nie przepuści, usunąć element `<animate>`.


---

## Załącznik — PR 5 (media w hotspotach, B-084): wiadomość głosowa „informatyka"

Do dodania w wersji 2 modułu, gdy `hotspots[].media` będzie w schemacie. Hotspot `telefon` dostaje `media: { kind: audio, audioUrl, transcript }` — nagranie z **innym głosem** niż lektor (męski, uprzejmy, lekko pospieszny; ElevenLabs, osobny `voiceId` w skrypcie TTS).

**Transkrypcja (ok. 35 s):**
> Dzień dobry, pani Anno. Tomasz Wierzbicki, dział bezpieczeństwa, Bank Wektor. Dzwonię, bo nasz system wykrył przed chwilą próbę logowania do państwa konta firmowego z nietypowej lokalizacji. Zablokowaliśmy ją tymczasowo, ale żeby anulować operację, potrzebuję potwierdzenia z pani strony. Za moment przyjdzie do pani SMS z kodem — proszę go nie wpisywać nigdzie w systemie, tylko podać mi go przez telefon, wtedy anulujemy wszystko od naszej strony. To zajmie minutę. Proszę oddzwonić jak najszybciej, sprawa jest pilna — po dziesiątej system zablokuje rachunek automatycznie. Dziękuję i przepraszam za kłopot.

Po odsłuchaniu karta hotspotu pokazuje pod odtwarzaczem: „Prawdziwy bank nigdy nie prosi o kod SMS przez telefon. Kod SMS zawsze **zatwierdza** operację, nigdy jej nie anuluje."

Hotspot `drukarka` dostaje `media: { kind: document, title: „Potwierdzenie przelewu", lines: [...] }` — pełnoekranowy „wydruk":
```
BANK WEKTOR — POTWIERDZENIE WYKONANIA PRZELEWU
Data i godzina:  wtorek, 09:12:41
Z rachunku:      Nortex Sp. z o.o.  PL 61 …… 4412
Na rachunek:     Wektor Rozliczenia Sp. z o.o.  PL 27 …… 9903
Kwota:           14 000,00 PLN
Tytuł:           weryfikacja salda
Autoryzacja:     kod SMS, 09:06:58
```

Hotspot `monitor` dostaje `media: { kind: image, src: scenes/mail-na-ekranie.svg, alt: ... }` — powiększony podgląd skrzynki (SVG dostarczę przy PR 5).
