# Moduł 2 - „Głos z helpdesku” (vishing): specyfikacja, faza 0

Status: **faza 0 - specyfikacja do akceptacji** (bez kodu i migracji). Decyzje są podjęte przez właściciela (2026-09-29); ten dokument
je rozpisuje. Wzór konwencji: moduł 1 (`packages/content/modules/wyludzone-haslo`, `docs/content/MODULE-PLAYBOOK.md`, D-108, D-109).

Spis treści:

1. Nazwa, postacie, zasady nazewnictwa
2. Oś czasu
3. Sceny (11) - cel, hotspoty, dowody, kwestie
4. Nowe typy scen - schemat JSON
5. Głosy
6. Osiągnięcia
7. Lista grafik
8. Do weryfikacji
9. Wpływ na silnik i dane (plan faz 1+)
10. Gotowość na wersję EN (schemat wielojęzyczny)

**Format tekstów w tym dokumencie:**
- Wszystkie teksty modułu 2 są pisane w formacie wielojęzycznym z rozdziału 10: pola tekstowe, `spokenText` i nagrania są kluczowane
  locale, wypełnione tylko `pl`.
- W tabelach i listach rozdziału 3 podaję sam tekst `pl`, dla czytelności.
- Przykłady JSON w rozdziale 4 pokazują pełny kształt.

---

## 1. Nazwa, postacie, zasady nazewnictwa

- **Nazwa modułu:** „Głos z helpdesku” (bez prefiksu „Sprawa”). Slug: `glos-z-helpdesku`. Kategoria: `PHISHING_SOCIAL_ENGINEERING`, poziom
  `intermediate`, ok. 15 min, `mandatory: true`, `schemaVersion: 6` (nowe typy bloków - rozdział 4 i 9).
- **Firma ofiary (fikcyjna):** Drukarnia Lipowa sp. z o.o., Kraków (poligrafia na zamówienie; dział sprzedaży, CRM z listą klientów).
- **Postacie (fikcyjne):**
  - **Karol Wieczorek** - handlowiec, dział sprzedaży; ofiara.
  - **Paweł Nowicki** - prawdziwy informatyk (helpdesk, numer wewnętrzny 214).
  - **Oszust** - podszywa się pod Pawła (ten sam głos - rozdział 5), na wyświetlaczu „IT Helpdesk”.
  - **Komisarz** i **narrator** - jak w module 1.
- **Zero marek.** Bez nazw produktów i firm technologicznych. Zamiast nich:
  - „konsola administratora”;
  - „narzędzie zdalnej pomocy”;
  - „aplikacja uwierzytelniająca”;
  - „system CRM”;
  - „poczta firmowa”.
  Grafiki bez logotypów (ikony z kompozytora, w stylu Unfooly).
- **Numery i identyfikatory tylko zamaskowane:**
  - telefon oszusta: „12 3XX XX 41”;
  - ID sesji: „7XX XXX 219”;
  - adres zewnętrzny: „k.w…@skrzynka-zewn.example”;
  - numery wewnętrzne trzycyfrowe (214 - helpdesk);
  - adresy IP: „185.XX.XX.17”.

  Lektor nie czyta zamaskowanych cyfr: `spokenText` mówi „numer kończący się na czterdzieści jeden” (D-109 - zero cyfr w tekście
  czytanym przez TTS, wymóg CI).
- **Pole „ttsText” = `spokenText`** (nazwa pola w schemacie modułu, D-109). Poniżej każda kwestia z liczbą ma `spokenText` słownie.

## 2. Oś czasu (czwartek)

| Godzina | Zdarzenie | Gdzie gracz to znajduje |
|---|---|---|
| 8:55 | Sześć powiadomień MFA pod rząd (8:55-8:57) - Karol odrzuca wszystkie | telefon Karola (powiadomienia), konsola admina (logowania), alert |
| 8:58 | System wysyła do IT alert „wiele odrzuconych prób MFA” - bez reakcji (Paweł na szkoleniu do 10:00) | konsola admina |
| 9:02 | Telefon, na wyświetlaczu „IT Helpdesk” (podszyty numer 12 3XX XX 41). Głos jak Pawła: „ktoś próbuje się włamać, wpisz w aplikacji liczbę czterdzieści siedem” | rejestr połączeń, nagranie rozmowy |
| 9:04 | Karol wpisuje 47 → zatwierdzone logowanie atakującego z Amsterdamu | nagranie, konsola admina (logowania) |
| 9:06 | „Wgram poprawkę” - link, instalacja narzędzia zdalnej pomocy, Karol czyta ID sesji | nagranie, karteczka z ID, lista programów |
| 9:07-9:40 | Reguła przekierowania poczty na zewnętrzny adres (9:09), eksport listy klientów z CRM (9:31) | konsola admina |
| 9:41 | „Zrestartuj komputer po południu” - koniec rozmowy (39 min) | nagranie, rejestr połączeń |
| 10:15 | Karol dzwoni do prawdziwego helpdesku (wewn. 214) - Paweł: „nie dzwoniłem” | rejestr połączeń, przesłuchanie Pawła |
| 10:40 | Odprawa, start gracza | odprawa |

**Źródło wiedzy oszusta** (scena OSINT):

- strona firmy, zakładka „Zespół”: imię, nazwisko i stanowisko Pawła, format numerów wewnętrznych (trzy cyfry);
- publiczny webinar z Pawłem (około 40 minut jego głosu - próbka do sklonowania głosu).

Klonowanie głosu opisujemy **ogólnie** („z kilkunastu minut nagrania da się podrobić czyjś głos”), bez narzędzi, kroków i instrukcji.

**Dlaczego istnieje nagranie:** telefony działu sprzedaży nagrywają rozmowy automatycznie (znane pracownikom, informacja w regulaminie
działu) - stąd scena odsłuchu.

## 3. Sceny (11)

Konwencje jak w module 1:

- Każda scena to blok z `id`, `title`, `narration` (tekst, `spokenText`, `voice`), opcjonalnie `tip`.
- Dowód = element z `evidence: true` i `note { text, kind }` - trafia do notatnika, licznik „Dowody x/20”.
- Numeracja dowodów (D01-D20) to identyfikatory robocze. W treści id elementu jest kebab-case, a klucz notatki to `<blockId>.<id>`.
- Kwestie: rola głosu w nawiasie. Kwestie bez liczb nie potrzebują `spokenText`.

### Scena 1 - Odprawa (`odprawa`, BRIEFING)

- **Cel dydaktyczny:** wejście w sprawę; napastnik nie zdobył hasła, tylko zgodę na logowanie i dostęp zdalny - od ofiary, telefonicznie.
- **Kroki** (jak moduł 1):
  - `typewriter`: telefon dzwoni na biurku detektywa;
  - `call`: komisarz;
  - `caseFile`: akta z zadaniami;
  - `badge`: legitymacja;
  - `start`: miejsce akcji.
- **Karta sprawy:** nr GZH/2026/1004, poszkodowany Karol Wieczorek (sprzedaż), strata: „lista klientów i poczta handlowca”, zgłaszający
  Paweł Nowicki (IT).
- **Zadania** (`caseFile.tasks`):
  1. Ustal, jak oszust dostał się do konta (`completeWhen`: `biurko-karola`, `nagranie`).
  2. Sprawdź, co zrobił w systemach (`completeWhen`: `przesluchanie-pawla`).
  3. Dowiedz się, skąd wiedział, pod kogo się podszyć (`completeWhen`: `osint`).
- **Kwestie:**
  - (komisarz) „Drukarnia Lipowa, Kraków. Dziś rano ktoś zadzwonił do handlowca jako firmowy informatyk. Pół godziny później lista
    klientów była poza firmą. Jedź tam i ustal, jak to się stało.”
  - (narrator, `start`) „Drukarnia Lipowa, dział sprzedaży. 10:40.”
    - `spokenText`: „Drukarnia Lipowa, dział sprzedaży. Dziesiąta czterdzieści.”
- **Hotspoty:** jak moduł 1 - `telefon` (krok 1), `rozlacz` (krok 2), `teczka` / `akta` (krok 3), `legitymacja` (krok 4); współrzędne w
  rozdziale 7.
- **Dowody:** brak (odprawa nie jest oceniana).

### Scena 2 - Biurko Karola (`biurko-karola`, SCENE_HOTSPOTS)

- **Cel dydaktyczny:** seria powiadomień MFA to sygnał ataku (MFA fatigue); zasada „IT nigdy nie prosi o kody” była znana.
- **Narracja** (narrator): „Biurko Karola. Kubek zimnej kawy, telefon ekranem do góry, komputer, którego nikt nie zrestartował. Zacznij od
  tego, co pokazuje telefon.”
- **Hotspoty:**
  - `telefon` - zagnieżdżona scena `telefon-karola` z dwoma przedmiotami:
    - `powiadomienia` - zbliżenie z listą sześciu odrzuconych powiadomień MFA, 8:55-8:57 (**D01**);
    - `rejestr` - zbliżenie rejestru połączeń: 9:02 „IT Helpdesk” 12 3XX XX 41, 39 min; 10:15 wewn. 214, 3 min (**D02**).
  - `komputer` - zagnieżdżona scena `pulpit-karola`:
    - ikona „narzędzie zdalnej pomocy” na pulpicie i w zasobniku (**D03**);
    - ikona przeglądarki - bez dowodu, podpis „Historia pusta - ktoś wyczyścił”.
  - `karteczka` - karteczka z „ID: 7XX XXX 219, Paweł IT” (**D04**).
  - `plakat` - plakat „IT nigdy nie prosi o kody ani liczby z aplikacji” (**D05**).
  - `kubek` - bez dowodu.
  - `drzwi` - `action: next`, do sali, gdzie jest nagranie.
- **Dowody:**
  - **D01** `mfa-seria` (kind `item`) - „8:55-8:57: sześć próśb o zatwierdzenie logowania, Karol odrzucił wszystkie. Ktoś już miał jego
    hasło.”
  - **D02** `rejestr-helpdesk` (kind `call`, nowy rodzaj - rozdział 9) - „9:02: połączenie od »IT Helpdesk«, numer zewnętrzny 12 3XX XX
    41, 39 minut.”
  - **D03** `narzedzie-zdalne` (kind `item`) - „Na pulpicie Karola jest narzędzie zdalnej pomocy, którego rano jeszcze nie było.”
  - **D04** `karteczka-id` (kind `item`) - „Karteczka z ID sesji zdalnej pomocy i dopiskiem »Paweł IT«.”
  - **D05** `plakat-zasada` (kind `place`) - „Plakat przy biurku: »IT nigdy nie prosi o kody ani liczby z aplikacji«. Zasada była znana.”
- **Wymagane:** `telefon`, `komputer`, `karteczka`.

### Scena 3 - Odsłuch nagrania (`nagranie`, CALL_RECORDING - nowy typ)

- **Cel dydaktyczny:** rozpoznawanie technik manipulacji w rozmowie: pośpiech, autorytet, strach, prośba o kod, prośba o instalację.
  Kluczowe: przy „number matching” **dzwoniący nie może znać liczby** - jeśli ją podaje, logowanie jest jego.
- **Mechanika:** gracz słucha nagrania (fala dźwiękowa, pauza, przewijanie) i stuka „Czerwona flaga” w chwili manipulacji. Transkrypcja z
  tymi samymi przyciskami jest alternatywą dostępności.
- **Segmenty** (rola, tekst, `spokenText` przy liczbach; flaga `[F: kategoria]` jest polem `secret`):
  1. (oszust) „Dzień dobry, Karol? Paweł z IT. Mamy problem - ktoś właśnie próbuje się włamać na twoje konto.” [F: strach]
  2. (karol) „O, to te powiadomienia? Odrzucałem je.”
  3. (oszust) „Dobrze, że dzwonię. Nie mam dużo czasu, zaraz blokuje się cały dział sprzedaży.” [F: pośpiech]
  4. (oszust) „Zaraz przyjdzie powiadomienie. Wpisz w aplikacji liczbę 47, to je zablokuje.” [F: prośba o kod]
     - `spokenText`: „…Wpisz w aplikacji liczbę czterdzieści siedem, to je zablokuje.”
  5. (karol) „Czterdzieści siedem… wpisane.”
  6. (oszust) „Świetnie. Kierownik sprzedaży wie, że się tym zajmuję, nie musisz nikomu zgłaszać.” [F: autorytet]
  7. (oszust) „Teraz wgram ci poprawkę. Kliknij link, który przyszedł na czacie, i zainstaluj narzędzie zdalnej pomocy.” [F: prośba o instalację]
  8. (karol) „Zainstalowane. Mam tu jakiś numer… ID sesji.”
  9. (oszust) „Przeczytaj mi go.” [F: prośba o kod]
  10. (karol) „Siedem… dwa, jeden, dziewięć na końcu.” (ID czytane z przerwami - bez pełnego numeru w treści)
  11. (oszust) „Mam. Nie ruszaj myszki, to potrwa. I zrestartuj komputer dopiero po południu, bo poprawka się nie zapisze.” [F: pośpiech]
  12. (karol) „Jasne. Dzięki, Paweł.”
- **Czerwone flagi (7):** segmenty 1, 3, 4, 6, 7, 9, 11.
- **Okno flagi:** od początku segmentu do końca segmentu + 1500 ms (reakcja po usłyszeniu zdania). W trybie transkrypcji tapnięcie
  wskazuje segment wprost.
- **Fałszywe tapnięcia:** każde tapnięcie, które nie trafia nowej flagi (także powtórne w oknie trafionej), poza podwójnym stuknięciem
  w ciągu 1500 ms od trafienia (B-131, rozdz. 4.1); do osiągnięcia Perfect Pitch - 0.
- **Dowody:**
  - **D06** `liczba-47` (kind `call`) - „Dzwoniący sam podał liczbę 47. Przy parowaniu liczb liczbę zna tylko ten, kto się loguje.”
  - **D07** `prosba-instalacja` (kind `call`) - „»Paweł« kazał zainstalować narzędzie zdalnej pomocy i przeczytać ID sesji.”
- **Ocena:** waga 2; punkty = znalezione flagi / 7, pomniejszone o 0,1 za każde fałszywe tapnięcie (min. 0). Liczy serwer z czasów tapnięć
  - klient nie zna segmentów-flag.

### Scena 4 - Przesłuchanie Karola (`przesluchanie-karola`, INTERROGATION - nowy typ)

- **Cel dydaktyczny:** ofiara działała w dobrej wierze; głos „był identyczny” - rozpoznanie głosu nie jest dowodem tożsamości.
  Sprzeczność uczy weryfikować zeznania dowodami.
- **Postać:** Karol Wieczorek, handlowiec. Otwarcie: „Myślałem, że pomagam. To był Paweł, znam jego głos.”
- **Pytania** (wszystkie wymagane, dowolna kolejność; fragmenty oznaczone *[→ notes]* da się przeciągnąć albo stuknąć i dodać do
  notatnika):
  - `glos` - „Skąd wiedziałeś, że to Paweł?”
    - (karol) „To był jego głos, na sto procent. Ten sam sposób mówienia.” *[→ notes: **D08**]*
    - (karol) „Na wyświetlaczu było »IT Helpdesk«, tak jak zawsze.”
  - `kod` - „Czy podawałeś jakieś kody?”
    - (karol) „Nie, żadnych kodów. Tylko odrzucałem te powiadomienia.” ← **sprzeczność**, obala ją **D06** (liczba 47)
    - po „Podważ” (karol): „…No tak. Wpisałem liczbę, którą podał. Myślałem, że to blokuje atak.” *[→ notes: **D09**]*
  - `wiedza` - „Co o tobie wiedział?”
    - (karol) „Znał moje imię, dział, nazwisko kierownika. Mówił o nim jak o koledze.” *[→ notes: **D10**]*
  - `koniec` - „Jak zakończyła się rozmowa?”
    - (karol) „Kazał zrestartować komputer dopiero po południu i nikomu nie mówić, żeby nie robić zamieszania.”
- **Dowody:**
  - **D08** `glos-identyczny` (kind `person`) - „Karol rozpoznał głos Pawła. Głos można podrobić - to nie dowód, kto dzwoni.”
  - **D09** `wpisal-liczbe` (kind `person`) - „Karol przyznał: wpisał liczbę podaną przez dzwoniącego.”
  - **D10** `znal-kierownika` (kind `person`) - „Oszust znał dział i kierownika Karola - wiedzę z publicznych źródeł.”
- **Ocena:** waga 1; podważenie sprzeczności właściwym dowodem = 1 pkt, zły dowód = 0 (jedna próba po wybraniu dowodu).
  `refutedBy` jest `secret`.

### Scena 5 - Przesłuchanie Pawła i konsola administratora (`przesluchanie-pawla`, INTERROGATION + zakładki konsoli)

- **Cel dydaktyczny:** co napastnik zrobił po wejściu (przekierowanie poczty, eksport danych, dostęp zdalny) i że prawdziwe IT dzwoni z
  numeru wewnętrznego.
- **Postać:** Paweł Nowicki, IT. Otwarcie: „Nie dzwoniłem do Karola. Byłem na szkoleniu do dziesiątej.”
- **Pytania:**
  - `gdzie` - „Gdzie byłeś rano?”
    - (pawel) „Na szkoleniu poza biurem, do 10:00. Telefon służbowy miałem wyciszony.” *[→ notes: **D11**]*
      - `spokenText`: „…do dziesiątej. Telefon służbowy…”
  - `alert` - „Czy system coś zgłaszał?”
    - (pawel) „Był alert o seryjnie odrzucanych logowaniach - zobaczyłem go dopiero po szkoleniu.” *[→ notes: **D20**]*
  - `procedura` - „Jak IT kontaktuje się z pracownikami?”
    - (pawel) „Zawsze z wewnętrznego dwieście czternaście. I nigdy nie prosimy o kody ani liczby z aplikacji.”
  - `konsola` - „Pokaż, co widać w konsoli.” → otwiera konsolę administratora (dokument z zakładkami, wiersze-dowody jak DOSSIER):
    - zakładka **Logowania:**
      - 8:55-8:57 sześć odrzuconych prób, Kraków → Amsterdam (185.XX.XX.17);
      - **9:04 zatwierdzone logowanie, Amsterdam (D12)**;
      - 10:22 wylogowanie wszystkich sesji (Paweł).
    - zakładka **Reguły poczty:**
      - **9:09 „Przekaż kopię wszystkich wiadomości na k.w…@skrzynka-zewn.example” (D13)**;
      - zwykła reguła „Faktury → folder Faktury”.
    - zakładka **Programy:**
      - **9:06 narzędzie zdalnej pomocy - zainstalowane przez użytkownika (D14)**;
      - aktualizacja pakietu biurowego z poprzedniego tygodnia - zwykła linijka.
    - zakładka **CRM:**
      - **9:31 eksport „Klienci - pełna lista” (1 2XX rekordów) (D15)**;
      - raport sprzedaży z poniedziałku - zwykła linijka.
- **Sprzeczność (opcjonalna):** brak - Paweł mówi prawdę (celowo: nie każde zeznanie jest fałszywe).
- **Dowody:**
  - **D11** `pawel-szkolenie` (kind `person`) - „Paweł był do dziesiątej na szkoleniu - to nie on dzwonił.”
  - **D12** `logowanie-amsterdam` (kind `log`, nowy rodzaj) - „9:04: logowanie zatwierdzone przez Karola, z Amsterdamu.”
  - **D13** `regula-przekierowania` (kind `log`) - „9:09: reguła kopiująca całą pocztę Karola na zewnętrzny adres.”
  - **D14** `instalacja-9-06` (kind `log`) - „9:06: narzędzie zdalnej pomocy zainstalowane z konta Karola.”
  - **D15** `eksport-crm` (kind `log`) - „9:31: eksport pełnej listy klientów z CRM.”
  - **D20** `alert-mfa` (kind `log`) - „8:58: alert o serii odrzuconych logowań - nikt go nie odebrał.”
- **Ocena:** waga 0 (eksploracja); wymagane: wszystkie pytania i zakreślenie D12-D15.

### Scena 6 - Porównanie w rejestrze połączeń (`rejestr`, SCENE_HOTSPOTS)

- **Cel dydaktyczny:** nazwa na wyświetlaczu to nie dowód. Prawdziwy helpdesk ma numer wewnętrzny, a „IT Helpdesk” przyszedł z numeru
  zewnętrznego z podszytą nazwą. Weryfikacja = oddzwonienie na numer z intranetu.
- **Narracja** (narrator): „Dwa połączenia. Obie strony przedstawiły się jako IT. Tylko jedno przyszło z wewnątrz firmy.”
- **Hotspoty:**
  - `wpis-9-02` - „IT Helpdesk”, 12 3XX XX 41, przychodzące, 39 min (**D16**, szczegóły połączenia: numer zewnętrzny, nazwa nadana przez
    dzwoniącego);
  - `wpis-10-15` - „wewn. 214”, wychodzące, 3 min;
  - `intranet` - karta intranetu „Kontakt z IT: wewn. 214” (bez dowodu, podpowiedź do rozmowy na żywo);
  - `drzwi` - `action: next`.
- **Dowody:**
  - **D16** `numer-zewnetrzny` (kind `call`) - „»IT Helpdesk« dzwonił z numeru zewnętrznego. Prawdziwy helpdesk to wewnętrzny 214.”

### Scena 7 - OSINT: strona „Zespół” i webinar (`osint`, OSINT_SPOT - nowy typ)

- **Cel dydaktyczny:** skąd napastnik wziął wiedzę - publiczne informacje wystarczą do wiarygodnego podszycia; nie wszystko, co publiczne,
  zostało użyte (pułapki).
- **Obraz:** strona www drukarni, zakładka „Zespół” (zdjęcia bez twarzy - ilustracje, imiona, stanowiska) + kafel „Webinar: Bezpieczna
  praca zdalna - Paweł Nowicki”.
- **Obszary użyte przez oszusta:**
  - `zespol-pawel` - „Paweł Nowicki, specjalista IT, helpdesk” (**D17**);
  - `numery-wewn` - stopka „Kontakt: centrala 12 3XX XX 00, wewnętrzne trzycyfrowe” (**D18**);
  - `webinar` - kafel webinaru (**D19**; otwiera odtwarzacz nagrania, rozdział 6 „Off the Record”);
  - `kierownik-sprzedazy` - „Kierownik sprzedaży: …” (wiedza z D10).
- **Pułapki (nieużyte):**
  - `adres-firmy` - adres drukarni;
  - `godziny` - godziny otwarcia;
  - `oferta` - cennik;
  - `zdjecie-budynku` - zdjęcie budynku.
- **Dowody:**
  - **D17** `strona-zespol` (kind `web`, nowy rodzaj) - „Strona »Zespół«: imię, nazwisko i stanowisko Pawła - gotowa legenda.”
  - **D18** `format-numerow` (kind `web`) - „Stopka strony zdradza format numerów wewnętrznych.”
  - **D19** `webinar-glos` (kind `web`) - „Publiczny webinar: około czterdziestu minut głosu Pawła - wystarczy, żeby go podrobić.”
- **Webinar** (nagranie `media.kind: audio`, głos `pawel`, ok. 90 s w module):
  - ogólna część o bezpiecznej pracy zdalnej;
  - **na końcu wpadka:** „…a jak trzeba komuś pomóc zdalnie, to po prostu prosimy o ID sesji z narzędzia zdalnej pomocy i już.”
  - Wysłuchanie do końca odsłania tajne osiągnięcie Off the Record i zdanie w notatniku - bez dowodu i punktów (jak easter egg, D-100).
- **Ocena:** waga 1; punkty = trafione obszary użyte (4) / 4, pomniejszone o 0,25 za każdą pułapkę (min. 0). `used` jest polem `secret`.

### Scena 8 - Tablica osi czasu (`tablica`, ORDERING - istniejący mechanizm, D-088)

- **Cel dydaktyczny:** łańcuch zdarzeń i miejsca, w których można go było przerwać.
- **Zdarzenia (7, poprawna kolejność):**
  1. Oszust zbiera dane ze strony „Zespół” i z webinaru.
  2. Karol odrzuca sześć próśb MFA.
  3. Telefon od „IT Helpdesk”.
  4. Karol wpisuje liczbę podaną przez dzwoniącego.
  5. Instalacja narzędzia zdalnej pomocy i ID sesji.
  6. Reguła przekierowania poczty i eksport CRM.
  7. Karol dzwoni na wewnętrzny 214.
- **`start` / `end`:** „Publiczna strona firmy” / „Lista klientów poza firmą”.
- **Ocena:** waga 2, `scoring: partial` (jak moduł 1).

### Scena 9 - Rozmowa na żywo (`na-zywo`, LIVE_CALL - nowy typ)

- **Cel dydaktyczny:** zachowanie pod presją. Nie podawać niczego, rozłączyć się, oddzwonić na numer z intranetu (wewn. 214).
- **Fabuła:** po odprawie ten sam „IT Helpdesk” dzwoni do gracza („detektyw z firmy zewnętrznej, sprawdzamy twoje konto gościa”).
- **Zasada sceny (jak w nagraniu):** oszust **sam podaje liczbę** i każe ją wpisać w aplikacji. Przy parowaniu liczb liczbę widzi tylko
  ten, kto się loguje - kto ją podaje, ten się loguje. Gracz nigdy nie „podaje” liczby oszustowi; zły wybór to jej **wpisanie**.
- **Drzewo:**
  - `start` (oszust): „Tu IT Helpdesk. Ktoś loguje się na konto gościa, które dostałeś rano. Zaraz przyjdzie powiadomienie - wpisz w
    aplikacji 62, to je zablokuję.”
    - `spokenText`: „…wpisz w aplikacji sześćdziesiąt dwa, to je zablokuję.”
    - „Oddzwonię na numer helpdesku z intranetu.” → koniec **dobry**
    - „Jaką liczbę mam wpisać?” → `nacisk`
    - „Poczekaj, sprawdzę, kto dzwoni.” → `autorytet`
    - cisza (limit czasu) → `nacisk`
  - `nacisk` (oszust): „62, szybko, blokada za dwie minuty!”
    - `spokenText`: „Sześćdziesiąt dwa, szybko, blokada za dwie minuty!”
    - „Rozłączam się i dzwonię na dwieście czternaście.” → koniec **dobry**
    - „Wpisuję 62.” (`gaveInfo`) → koniec **zły**
      - `spokenText` nie dotyczy (odpowiedzi gracza nie są czytane przez lektora)
    - „Najpierw podaj swój numer wewnętrzny.” → `wykret`
  - `autorytet` (oszust): „Kierownik już wie, to polecenie z góry. Chcesz, żeby cały dział stracił dostęp?”
    - „Rozłączam się i dzwonię na dwieście czternaście.” → koniec **dobry**
    - „Dobra, co mam zrobić?” → `instalacja`
  - `wykret` (oszust): „Dwieście czternaście, ale teraz dzwonię z komórki, bo system leży.”
    - „To oddzwonię na dwieście czternaście.” → koniec **dobry**
    - „W porządku, wpisuję.” (`gaveInfo`) → koniec **zły**
  - `instalacja` (oszust): „Kliknij link na czacie i zainstaluj narzędzie zdalnej pomocy. Przeczytaj mi ID.”
    - „Nie instaluję niczego z telefonu. Rozłączam się.” → koniec **częściowy**
    - „Instaluję.” (`gaveInfo`) → koniec **zły**
- **Zakończenia:**
  - **dobre** (narrator): „Rozłączasz się i dzwonisz na wewnętrzny 214. Paweł odbiera: »Nie dzwoniłem. Dobrze, że sprawdziłeś.«”
    - `spokenText`: „…na wewnętrzny dwieście czternaście…”
  - **częściowe:** „Nie wpisałeś liczby, ale wszedłeś w rozmowę dalej, niż trzeba. Następnym razem rozłącz się od razu.”
  - **złe:** „Wpisałeś liczbę, którą podał dzwoniący - zatwierdziłeś jego logowanie. W prawdziwej firmie to byłaby druga lista klientów.”
- **Limit czasu (niezależny od `prefers-reduced-motion`):**
  - 12 s na wybór; cisza wybiera krawędź `silence` (oszust naciska);
  - wyłączony, gdy konto ma ustawienie „Bez limitów czasu” albo gracz zaznaczy „Wyłącz limit czasu” na ekranie przed połączeniem
    (WCAG 2.2.1) - szczegóły w 4.4.
- **Ocena:** waga 1. Dobre = 1, częściowe = 0,5, złe = 0. Serwer odtwarza ścieżkę wyborów po drzewie; `outcome` i `gaveInfo` są
  `secret`.

### Scena 10 - Przewijanie z adnotacjami (`omowienie`, ANNOTATED_REPLAY - nowy typ)

- **Cel dydaktyczny:** podsumowanie technik na tej samej rozmowie. Numerowane znaczniki na transkrypcji; przejście 1 → N.
- **Znaczniki (6):**
  1. „Strach: »ktoś się włamuje« - w stresie myślimy krócej.” (segment 1)
  2. „Pośpiech: »nie mam czasu« - bez czasu nie ma weryfikacji.” (segment 3)
  3. „Parowanie liczb: liczbę zna tylko ten, kto się loguje. Dzwoniący, który ją podaje - to on się loguje.” (segment 4)
  4. „Autorytet: kierownik »wie« - nikt tego nie sprawdzi w trakcie rozmowy.” (segment 6)
  5. „Instalacja i ID sesji: to oddanie komputera obcej osobie.” (segmenty 7-9)
  6. „Zakończenie: »zrestartuj po południu« - kupuje czas na przekierowanie i eksport.” (segment 11)
- Każdy znacznik ma narrację (narrator). Waga 0; wymagane przejście wszystkich.

### Scena 11 - Zamknięcie sprawy (`rozwiazanie-sprawy`, SUMMARY + `closing` - istniejący mechanizm, D-089)

- **Cel dydaktyczny:** wnioski.
- **Wnioski** (`lessons`, ≤ 120 znaków):
  1. „Liczbę do wpisania w aplikacji widzi tylko logujący się. Kto ci ją podaje przez telefon, ten się loguje.”
  2. „Nazwa i głos na telefonie to nie dowód. Rozłącz się i oddzwoń na numer z intranetu.”
  3. „Nie instaluj niczego i nie czytaj ID sesji na prośbę rozmówcy.”
- **Narracja** (komisarz): „Zamknięte. Jedna rozmowa, trzydzieści dziewięć minut, lista klientów na zewnątrz. Zapamiętaj: przy
  telefonie weryfikujesz numer, nie głos.”
- **Raport:** `closing` z pieczęcią, liścikiem komisarza i wariantem pionowym (grafiki - rozdział 7).

**Dowody łącznie: 20** (D01-D20):

- biurko: 5 (D01-D05);
- nagranie: 2 (D06-D07);
- Karol: 3 (D08-D10);
- Paweł i konsola: 6 (D11-D15, D20);
- rejestr: 1 (D16);
- OSINT: 3 (D17-D19).

## 4. Nowe typy scen - schemat JSON

Konwencje jak w module 1 (`packages/content/src/blocks.ts`):

- schematy `.strict()`;
- id stałe (klucze postępu i notatek);
- współrzędne w % obrazu `{ x, y, w, h }`;
- wszystkie zasoby przez potok `--assets` / `tts`;
- każde pole sklasyfikowane jako `client` albo `secret` (test kompletności w CI);
- ocenę liczy wyłącznie serwer (`apps/api/src/courses/scoring`);
- klient wysyła tylko swoje działania.

Każdy typ ma wariant telefonu 9:16, obsługę klawiatury i zachowanie przy `prefers-reduced-motion`.

### 4.1 `CALL_RECORDING`

```json
{
  "id": "nagranie",
  "type": "CALL_RECORDING",
  "title": { "pl": "Odsłuch nagrania" },
  "narration": { "voice": "narrator", "pl": { "text": "…" } },
  "weight": 2,
  "segments": [
    { "id": "s1", "voice": "oszust", "gapAfterMs": 400,
      "speech": { "pl": { "text": "Dzień dobry, Karol? Paweł z IT. …" } } },
    { "id": "s4", "voice": "oszust",
      "speech": { "pl": { "text": "… Wpisz w aplikacji liczbę 47 …", "spokenText": "… liczbę czterdzieści siedem …" } } }
  ],
  "flags": [
    { "segmentId": "s1", "category": "fear" },
    { "segmentId": "s4", "category": "code_request" }
  ],
  "flagWindowAfterMs": 1500,
  "flagCategories": ["urgency", "authority", "fear", "code_request", "install_request"],
  "maxFalseTaps": 0,
  "falseTapPenalty": 0.1,
  "evidence": [
    { "id": "liczba-47", "segmentId": "s4", "note": { "text": { "pl": "Dzwoniący sam podał liczbę 47. …" }, "kind": "call" } }
  ]
}
```

(`speech.<locale>` to kształt `narration` z rozdziału 10: `text`, `spokenText?`, a po publikacji `audioUrl`, `durationMs`, `cues?` -
osobno dla każdego języka; `voice` jest wspólne.)

**Znaczniki czasu:**

- Każdy segment to osobne nagranie TTS na każdy język (`<blockId>#segments.<N>@<locale>`) - długości w EN będą inne, więc znaczniki
  i okna flag liczone są per język, z `durationMs` danego języka.
- Potok zapisuje `audioUrl` i `durationMs` (jak narracja).
- Klient i serwer liczą `startMs` segmentu jako sumę `durationMs + gapAfterMs` poprzednich - **z długości wygenerowanych plików**, nie
  wpisywane ręcznie.

**Klasyfikacja:**

- `client`: `segments[].{id, gapAfterMs}`, `segments[].speech.<locale>.{text, audioUrl, durationMs}` (serwer wydaje tylko język gracza,
  rozdział 10), `flagCategories`; `voice` i `spokenText` tylko dla TTS (jak dziś).
- `secret`: `flags` (cała tablica), `flagWindowAfterMs`, `evidence[].segmentId`.
- Notatki dowodów wychodzą dopiero w odpowiedzi serwera po ocenie (jak kryteria maila).

**Okno flagi:** `[startMs segmentu, startMs + durationMs segmentu + flagWindowAfterMs]` (domyślnie 1500 ms), liczone z `durationMs`
języka gracza.

**Odpowiedź klienta:** `{ taps: [{ atMs } | { segmentId }] }` - serwer przyjmuje oba kształty, także wymieszane w jednej odpowiedzi:

- `{ atMs }` - tapnięcie w trybie odsłuchu (pozycja w nagraniu); trafia flagę, gdy mieści się w jej oknie;
- `{ segmentId }` - tapnięcie w trybie transkrypcji; trafia flagę, gdy segment ma flagę;
- okna sąsiednich flag mogą się nakładać (segmenty 3 i 4): `atMs` w części wspólnej trafia najwcześniejszą jeszcze nietrafioną flagę;
- **fałszywe tapnięcie (B-131, decyzja właściciela 2026-09-29): KAŻDE tapnięcie, które nie trafia NOWEJ flagi** - `atMs` poza oknami,
  `segmentId` segmentu bez flagi, powtórne tapnięcie w oknie już trafionej flagi i powtórne `segmentId` tej samej kwestii (nieistniejący
  `segmentId` = odpowiedź odrzucona);
- **wyjątek - podwójne stuknięcie:** powtórka `atMs` w ciągu 1500 ms od trafienia flagi jest ignorowana (bez kary, bez punktu);
- kara bez zmian: −0,1 za każde fałszywe tapnięcie, wynik min. 0. Przykłady (testy): tapanie równomierne co 1 s przez całe nagranie →
  ≤ 0,2; 7 trafień + 1 pomyłka → 0,9; 7 trafień + podwójne stuknięcie przy jednej fladze → 1,0 (i warunek Perfect Pitch);
- klient nie wysyła kategorii ani poprawności; kategoria jest pokazywana dopiero w omówieniu.

**UI:**

- fala dźwiękowa z pozycją;
- odtwórz / pauza (Spacja);
- przewijanie ±5 s (strzałki);
- „Czerwona flaga” (Enter / F);
- transkrypcja z tymi samymi przyciskami przy każdym segmencie - alternatywa dostępności;
- telefon: fala nad transkrypcją, przyciski ≥ 44 px, dolny pasek bez zmian;
- reduced-motion: fala bez animacji przewijania (skok do pozycji).

### 4.2 `INTERROGATION`

```json
{
  "id": "przesluchanie-karola",
  "type": "INTERROGATION",
  "character": { "name": "Karol Wieczorek", "role": { "pl": "handlowiec" }, "avatar": "avatars/karol.svg", "opening": { "pl": "…" } },
  "questions": [
    {
      "id": "kod",
      "text": { "pl": "Czy podawałeś jakieś kody?" },
      "required": true,
      "lines": [
        {
          "id": "kod-1",
          "speech": { "pl": { "text": "Nie, żadnych kodów. …" } },
          "voice": "karol",
          "contradiction": {
            "refutedBy": "nagranie.liczba-47",
            "challengeLine": { "voice": "karol", "speech": { "pl": { "text": "…No tak. Wpisałem liczbę…" } } },
            "note": { "text": { "pl": "Karol przyznał: wpisał liczbę podaną przez dzwoniącego." }, "kind": "person" }
          }
        },
        {
          "id": "glos-1",
          "voice": "karol",
          "speech": { "pl": { "text": "To był jego głos, na sto procent." } },
          "fragment": { "evidence": true, "note": { "text": { "pl": "Karol rozpoznał głos Pawła. …" }, "kind": "person" } }
        }
      ]
    }
  ],
  "documents": null,
  "weight": 1
}
```

- **Pytania:** wszystkie `required` (domyślnie wszystkie), dowolna kolejność.
- **Odpowiedzi:** linie z głosem (`narration.voice`).
- **Notatki:**
  - `fragment` - przeciągnięcie linii do notesu (albo stuknięcie linii i „Dodaj do notatek” - alternatywa tap-tap) tworzy notatkę-dowód;
  - klucz notatki `<blockId>.<lineId>`.
- **Sprzeczność:**
  - `contradiction.refutedBy` to klucz notatki dowodu z wcześniejszego bloku;
  - akcja „Podważ” przy linii otwiera notatnik, gracz wskazuje dowód, serwer sprawdza;
  - trafienie odsłania `challengeLine` i dodaje `note`; pudło zamyka podważenie tej linii (jedna próba).
- **Konsola** (scena 5): opcjonalne `documents[]` w tym samym kształcie co `DOSSIER.documents` (zakładki, wiersze-dowody) - otwierane
  pytaniem z `opensDocuments: true`.
- **Klasyfikacja:**
  - `secret`: `contradiction.refutedBy`, `contradiction.challengeLine`, `contradiction.note` (odsłaniane po trafieniu);
  - `client`: reszta (jak DIALOGUE i DOSSIER).
- **Odpowiedź klienta:** `{ asked, noted, challenges: [{ lineId, evidenceKey }] }`.
- **Ocena:** trafione sprzeczności / wszystkie sprzeczności (waga z treści; blok bez sprzeczności ma wagę 0).
- **Klawiatura:** pytania jako lista przycisków; linia z fokusem → „Dodaj do notatek” (N) i „Podważ” (P).
- **Telefon:** wątek jak komunikator (D-087), notes jako dolny arkusz.
- **Reduced-motion:** bez animacji wlatywania notatki.

### 4.3 `OSINT_SPOT`

```json
{
  "id": "osint",
  "type": "OSINT_SPOT",
  "image": "scenes/strona-zespol.svg",
  "imagePortrait": "scenes/strona-zespol-pion.svg",
  "textLayer": [
    { "id": "t-pawel", "x": 9.0, "y": 52.0, "w": 24.0, "h": 6.0, "text": { "pl": "Paweł Nowicki - specjalista IT, helpdesk" } }
  ],
  "imageAlt": { "pl": "Strona drukarni, zakładka Zespół: …" },
  "prompt": { "pl": "Zaznacz informacje, które wykorzystał oszust." },
  "spots": [
    { "id": "zespol-pawel", "x": 8.0, "y": 30.0, "w": 26.0, "h": 34.0, "label": { "pl": "Paweł Nowicki, IT" }, "used": true,
      "note": { "text": { "pl": "Strona »Zespół«: …" }, "kind": "web" } },
    { "id": "godziny", "x": 70.0, "y": 88.0, "w": 22.0, "h": 6.0, "label": { "pl": "Godziny otwarcia" }, "used": false,
      "trapText": { "pl": "Godziny otwarcia nic oszustowi nie dały." } }
  ],
  "portraitSpots": [ { "id": "zespol-pawel", "x": 6.0, "y": 22.0, "w": 88.0, "h": 14.0 } ],
  "media": { "webinar": { "kind": "audio", "voice": "pawel", "speech": { "pl": { "text": "…" } }, "secretEnding": { "id": "off-the-record" } } },
  "falseSpotPenalty": 0.25,
  "weight": 1
}
```

- Obszary w % obrazu. Wariant pionowy ma własne współrzędne (`portraitSpots`, te same id).
- **Klasyfikacja:**
  - `secret`: `used`, `note` (wychodzi po ocenie), `trapText`;
  - `client`: `id`, `x`, `y`, `w`, `h`, `label`, `textLayer` (treść strony rysowana przez odtwarzacz - rozdział 10, bez tekstu
    wypalonego w grafice).
- **Odpowiedź klienta:** `{ marked: [spotId] }`.
- **Ocena:** użyte trafione / wszystkie użyte − kara za pułapki (min. 0).
- **Webinar:**
  - osobny odtwarzacz audio z transkrypcją;
  - `secretEnding`: klient zgłasza wysłuchanie do końca (bramka UX jak easter egg, D-100);
  - serwer przyznaje tajne osiągnięcie przy zapisie bloku.
- **Klawiatura:** Tab po obszarach, Enter zaznacza.
- **Telefon:** obraz strony 9:16 przewijany w pionie, obszary ≥ 44 px wysokości.

### 4.4 `LIVE_CALL`

```json
{
  "id": "na-zywo",
  "type": "LIVE_CALL",
  "caller": { "display": { "pl": "IT Helpdesk" }, "number": "12 3XX XX 41" },
  "choiceTimeLimitSec": 12,
  "start": "start",
  "nodes": [
    {
      "id": "start",
      "voice": "oszust",
      "speech": { "pl": { "text": "Tu IT Helpdesk. … wpisz w aplikacji 62, to je zablokuję.",
                          "spokenText": "… wpisz w aplikacji sześćdziesiąt dwa, to je zablokuję." } },
      "choices": [
        { "id": "oddzwonie", "text": { "pl": "Oddzwonię na numer helpdesku z intranetu." }, "next": "#dobre" },
        { "id": "jaka-liczba", "text": { "pl": "Jaką liczbę mam wpisać?" }, "next": "nacisk" },
        { "id": "sprawdze", "text": { "pl": "Poczekaj, sprawdzę, kto dzwoni." }, "next": "autorytet" }
      ],
      "silence": "nacisk"
    }
  ],
  "endings": [
    { "id": "dobre", "outcome": "good", "voice": "narrator", "speech": { "pl": { "text": "…" } } },
    { "id": "zle", "outcome": "bad", "speech": { "pl": { "text": "…" } } }
  ],
  "infoChoices": ["wpisuje-62", "wpisuje", "instaluje"],
  "weight": 1
}
```

- **Drzewo:** 2-4 odpowiedzi w węźle. `next` to id węzła albo `#<id zakończenia>`; `silence` to krawędź po upływie limitu.
- **Walidacja** (`semantics.ts`):
  - graf bez cykli;
  - każdy węzeł osiągalny;
  - każda ścieżka kończy się zakończeniem;
  - co najmniej jedno zakończenie `good`.
- **Klasyfikacja:**
  - `secret`: `endings[].outcome`, `infoChoices`;
  - `client`: reszta. Tekst zakończenia klient zna, ale nie jego ocenę; ocenę pokazuje po odpowiedzi serwera.
- **Odpowiedź klienta:** `{ path: [choiceId | "silence"] }`. Serwer przechodzi drzewo od `start` i odrzuca ścieżkę niezgodną z grafem.
- **Ocena:** good 1 / partial 0,5 / bad 0.
- **Limit czasu (WCAG 2.2.1; NIE zależy od `prefers-reduced-motion`):**
  - pasek odliczania 12 s (przy reduced-motion pasek bez animacji - zmiana co sekundę - ale limit działa tak samo);
  - wyłączony w dwóch przypadkach:
    - konto ma ustawienie dostępności „Bez limitów czasu” (nowe pole preferencji, migracja w fazie 1e);
    - gracz zaznaczy „Wyłącz limit czasu” na ekranie przed połączeniem (przełącznik na tym ekranie, domyślnie z ustawienia konta;
      dotyczy tego podejścia);
  - bez limitu nie ma krawędzi `silence`;
  - odpowiedź klienta: `{ path: [...], timed: boolean }`; serwer przyjmuje `silence` tylko przy `timed: true` i koncie bez
    „Bez limitów czasu”, inaczej odrzuca ścieżkę.
- **Klawiatura:** odpowiedzi 1-4, Enter.
- **Telefon:** ekran połączenia 9:16 (wyświetlacz, odpowiedzi jako duże przyciski).

### 4.5 `ANNOTATED_REPLAY`

```json
{
  "id": "omowienie",
  "type": "ANNOTATED_REPLAY",
  "source": { "kind": "transcript", "fromBlock": "nagranie" },
  "markers": [
    { "n": 1, "anchor": { "segmentId": "s1" }, "title": { "pl": "Strach" }, "text": { "pl": "…" },
      "narration": { "voice": "narrator", "pl": { "text": "…" } } },
    { "n": 3, "anchor": { "segmentId": "s4" }, "title": { "pl": "Parowanie liczb" }, "text": { "pl": "…" } }
  ]
}
```

- `source`:
  - `transcript` (segmenty z bloku `CALL_RECORDING` tego modułu - walidacja sprawdza istnienie);
  - albo `image` (`image`, `imagePortrait`) z kotwicami `{ x, y }` w %.
- Znaczniki numerowane 1..N, przejście „Dalej znacznik” w bloku, nie „Dalej” modułu (D-106: „Dalej” w pasku aktywny po znaczniku N).
- Nieoceniany (waga 0), wszystko `client` (to omówienie, po ocenie nagrania).
- **Odpowiedź klienta:** `{ seen: N }`.
- **Klawiatura:** strzałki ← → między znacznikami.
- **Reduced-motion:** bez płynnego przewijania do znacznika.

## 5. Głosy (`scripts/content/voices.json`)

| Rola | Postać | Głos |
|---|---|---|
| `narrator` | narrator | bez zmian |
| `komisarz` | komisarz | bez zmian |
| `karol` | Karol Wieczorek | nowy głos męski, spokojny |
| `pawel` | Paweł Nowicki | nowy głos męski |
| `oszust` | oszust podszyty pod Pawła | **ten sam `voiceId` co `pawel`** - celowo (lekcja o klonowaniu głosu) |

- Nowe role trafiają do `VOICE_ROLES` (`packages/content/src/common.ts`) i `voices.json` w fazie 1.
- **Role per locale** (gotowość na EN, rozdział 10) - `voices.json` w nowym kształcie; `en` puste do czasu tłumaczenia (potok odmawia
  nagrania EN bez głosu, zamiast brać polski):

```json
{
  "narrator": { "pl": "o2xdfKUpc1Bwq7RchZuW", "en": "" },
  "komisarz": { "pl": "o11yegU3CL24TZ1qcm6b", "en": "" },
  "bank":     { "pl": "B9cNwbQXN3s6l3nU6fqz", "en": "" },
  "marek":    { "pl": "853X4BjOscPIWJYTmuYo", "en": "" },
  "karol":    { "pl": "<nowy>", "en": "" },
  "pawel":    { "pl": "<nowy>", "en": "" },
  "oszust":   { "sameAs": "pawel" }
}
```

- `oszust` nie ma własnych identyfikatorów - `sameAs: "pawel"` bierze głos Pawła w KAŻDYM języku (zasada „oszust = ten sam głos
  co Paweł” działa także po dodaniu EN).
- Test potoku pilnuje, że `sameAs` wskazuje istniejącą rolę bez własnego `sameAs`. Świadoma decyzja, nie literówka: `oszust` i
  `pawel` zawsze mają ten sam `voiceId`.
- Stary kształt (`"rola": "voiceId"`) czytany jako `{ "pl": voiceId }` - moduł 1 bez zmian.
- Każda kwestia z liczbą, godziną albo numerem ma `spokenText` słownie (D-109, CI).

## 6. Osiągnięcia (nazwy EN, opisy PL - jak moduł 1)

| Kod | Nazwa | Ranga | Warunek (serwer) | Opis |
|---|---|---|---|---|
| `dead-air` | Dead Air | RARE | `na-zywo`: zakończenie `good`, ścieżka bez `infoChoices`, rozłączenie w pierwszych 3 wyborach; **niezależnie od trybu czasu** (z limitem i bez - `timed` nie wpływa na warunek) | „Rozłączyłeś się, zanim oszust zdążył cokolwiek wyciągnąć.” |
| `perfect-pitch` | Perfect Pitch | RARE | `nagranie`: 7/7 flag i 0 fałszywych tapnięć w jednym podejściu | „Wyłapałeś każdą manipulację. Bez jednego fałszywego alarmu.” |
| `full-transcript` | Full Transcript | LEGENDARY | wszystkie dowody (20/20) i 100% za zadania w jednym podejściu | „Cała rozmowa rozpisana co do słowa. Sprawa bez luk.” |
| `off-the-record` | Off the Record | SECRET (ukryte) | webinar w `osint` wysłuchany do końca | „Wysłuchałeś webinaru do końca i usłyszałeś to, czego nie powinno tam być.” |

- Przyznawanie wyłącznie na serwerze, idempotentnie, mechanizm z D-111 (`gamification/achievements.ts`, katalog w migracji).
- Tajne niezdobyte: bez nazwy i opisu (`secret-<n>`), neutralna grafika zablokowana.
- **Ranga RARE jest nowa** (dziś `SECRET`, `LEGENDARY`, `MILESTONE`): w fazie osiągnięć migracja enumu `AchievementRank`, etykieta
  UI „Rare”, kolor rewersu (token `rank.rare`) i wariant trofeum w kompozytorze.

## 7. Lista grafik (dla grafika)

Zasady (playbook, rozdział 6):

- SVG z kompozytora, bez cudzych logotypów.
- Zbliżenia i okna z **przezroczystym tłem** (D-101).
- Hotspoty w % obrazu (`x, y` - lewy górny róg, `w, h`); prostokąty docelowe, grafik trzyma przedmiot w tym prostokącie (±2%).
- Wariant pionowy 9:16 (900×1600) tam, gdzie tekst na telefonie byłby < 15 px (D-103).
- Źródła scen: `scripts/content/scenes/examples/glos-z-helpdesku/`.

Kolumna **Tekst** (gotowość na EN, rozdział 10) mówi, jak grafika obsłuży tekst:

- **tekst w warstwie** (preferowane) - grafika nie zawiera słów; tekst jest w treści modułu (`textLayer`, sloty, HTML odtwarzacza)
  i tłumaczy się razem z modułem;
- **wymaga wariantu EN** - tekst jest częścią rysunku i nie da się go sensownie przenieść do warstwy; w EN powstaje osobny plik
  (`<nazwa>.en.svg`, pole grafiki kluczowane locale);
- **bez tekstu** - grafika nie zawiera słów.

Cel: zero tekstu wypalonego w grafikach tam, gdzie się da. Liczby zamaskowane, znaki niezależne od języka (np. „12 3XX XX 41”, „214”)
mogą zostać w grafice.

| # | Plik | Proporcja / rozmiar | Hotspoty (%) | Pion | Przezroczyste tło | Tekst |
|---|---|---|---|---|---|---|
| 1 | `odprawa-biurko.svg` | 16:9, 1600×900 | `telefon` 36/52/16/22 | tak (`-pion`, `telefon` 30/58/40/14) | nie | tekst w warstwie (pasek tekstu kroku - HTML, jak moduł 1) |
| 2 | `odprawa-rozmowa.svg` | 16:9 | `rozlacz` 42/44/16/9 | tak (`rozlacz` 38/70/24/8) | nie | tekst w warstwie (dymek - HTML) |
| 3 | `odprawa-teczka.svg`, `odprawa-akta.svg` | 16:9 | `teczka` 30/30/40/45; `akta` 20/12/60/76, slot `tasks` 55/40/35/40 | tak (oba) | nie | tekst w warstwie (pola karty sprawy i zadania w slotach; nr sprawy w slocie `caseNo` zamiast rysunku) |
| 4 | `odprawa-legitymacja.svg` | 16:9 | `legitymacja` 30/20/40/60, sloty `photo`/`name`/`number` jak moduł 1 | tak | nie | tekst w warstwie (napis „Wydział Cyberbezpieczeństwa” w slocie `unit`, nowy) |
| 5 | `biurko-karola.svg` | 16:10, 1600×1000 | `telefon` 58/52/12/18; `komputer` 26/14/32/40; `karteczka` 62/34/8/9; `plakat` 80/8/14/30; `kubek` 12/58/8/12; `drzwi` 2/10/10/70 | nie (panorama jak moduł 1) | nie | bez tekstu (plakat w oddali bez czytelnych słów) |
| 6 | `telefon-karola.svg` (scena zagnieżdżona) | ekran telefonu 9:16 w ramce | `powiadomienia` 8/14/84/40; `rejestr` 8/58/84/32 | - (już pionowa) | tak | tekst w warstwie (etykiety kafli) |
| 7 | `mfa-powiadomienia-zoom.svg` | 9:16, 900×1600 | - (dokument) | - | tak | tekst w warstwie (6 powiadomień jako lista w `textLayer`; godziny zostają w grafice) |
| 8 | `rejestr-polaczen-zoom.svg` | 9:16 | - | - | tak | tekst w warstwie (nazwy „IT Helpdesk”, „wewn.”, kierunek; numery zamaskowane w grafice) |
| 9 | `pulpit-karola.svg` (w ramce monitora, `wrap-in-monitor`) | 4:3 | `narzedzie` 8/10/14/20; `przegladarka` 8/32/14/20 | nie | ramka monitora | tekst w warstwie (podpisy ikon) |
| 10 | `karteczka-id-zoom.svg` | 1:1 | - | nie | tak | bez wariantu EN (odręczny dopisek „Paweł IT” działa także po angielsku - decyzja właściciela; ID zamaskowane zostaje) |
| 11 | `plakat-zoom.svg` | 3:4 | - | nie | tak | tekst w warstwie (hasło plakatu w `textLayer` na polu plakatu) |
| 12 | `nagranie-tlo.svg` (tło odsłuchu: stół, rejestrator, słuchawki) | 16:9 | brak (UI fali rysuje odtwarzacz) | tak | nie | bez tekstu |
| 13 | `avatars/karol.svg`, `avatars/pawel.svg` | 1:1, 256 | - | - | tak | bez tekstu |
| 14 | `konsola-admina.svg` (okno konsoli, zakładki jako HTML w slocie) | 16:10 | slot `dokument` 4/12/92/84 | tak (`-pion`, slot 4/10/92/86) | tak | tekst w warstwie (tytuł okna i wszystkie zakładki - HTML) |
| 15 | `rejestr-porownanie.svg` (dwa wpisy obok siebie + karta intranetu) | 16:9 | `wpis-9-02` 8/22/40/20; `wpis-10-15` 8/48/40/20; `intranet` 56/20/36/50; `drzwi` 88/10/10/70 | tak (wpisy jeden pod drugim: 8/12/84/14, 8/30/84/14, intranet 8/50/84/30) | nie | tekst w warstwie (etykiety wpisów i karta intranetu) |
| 16 | `strona-zespol.svg` (strona www drukarni, zakładka „Zespół” + stopka + kafel webinaru) | 16:10 | `zespol-pawel` 8/30/26/34; `kierownik-sprzedazy` 38/30/26/34; `webinar` 70/30/24/30; `numery-wewn` 8/86/50/8; pułapki: `adres-firmy` 60/86/32/8, `godziny` 70/94/22/5, `oferta` 70/64/24/18, `zdjecie-budynku` 8/10/84/16 | tak (`strona-zespol-pion.svg`, 900×2400 przewijana, obszary w kolejności: budynek, Paweł, kierownik, webinar, oferta, stopka) | nie | tekst w warstwie (cała treść strony w `textLayer`; grafika to układ, zdjęcia-ilustracje, logo drukarni bez słów) |
| 17 | `webinar-odtwarzacz.svg` (kadr prelekcji: slajd „Bezpieczna praca zdalna”, sylwetka prelegenta) | 16:9 | - | tak | tak | tekst w warstwie (tytuł slajdu w `textLayer`) |
| 18 | `rozmowa-na-zywo.svg` (ekran połączenia przychodzącego „IT Helpdesk”, 12 3XX XX 41) | 9:16 | - (odpowiedzi to HTML) | - (pionowa także na desktopie, wyśrodkowana) | tak | tekst w warstwie („IT Helpdesk”, „Połączenie przychodzące” - HTML z `caller.display`; numer zamaskowany może zostać) |
| 19 | `tablica-osi.svg` (tablica korkowa, 7 kart, nić) | 16:9 | jak moduł 1 (karty to HTML) | tak | nie | tekst w warstwie (karty, `start`/`end`) |
| 20 | `omowienie-tlo.svg` (pulpit z transkrypcją) | 16:9 | - | tak | nie | bez tekstu (transkrypcja i znaczniki - HTML) |
| 21 | `zamkniecie-raport.svg`, `zamkniecie-pieczec.svg`, `zamkniecie-liscik.svg` | 16:9 / wg modułu 1 | sloty jak moduł 1 (`evidence`, `time`, `xp`, `lessons`, `signature`, `stamp`, `note`) | tak (`zamkniecie-raport-pion.svg`) | pieczęć i liścik: tak | raport: tekst w warstwie (nagłówki pól w slotach, nowe sloty `labels`); **pieczęć i liścik: wymaga wariantu EN** (napis pieczęci „SPRAWA ZAMKNIĘTA” i odręczny liścik to rysunek) |
| 22 | `miniatura-glos-z-helpdesku.svg` (+ PNG 1600×900 do og:image, poza repo) | 16:9, 1600×900 | - | nie | nie | bez tekstu - miniatura bez tytułu (zatwierdzone przez właściciela; tytuł pokazuje karta kursu), więc bez wariantu EN |
| 23 | Trofea: `osiagniecie-dead-air`, `-perfect-pitch`, `-full-transcript`, `-off-the-record` (+ `-zablokowane`; tajne - wspólne `osiagniecie-tajne-zablokowane`) | 1:1, 512×512 | - | - | tak | bez zmian językowych (nazwy i rangi po angielsku - decyzja D-111) |

Uwagi do grafik:

- Numery na grafikach wyłącznie zamaskowane (12 3XX XX 41, 7XX XXX 219).
- Brak twarzy na stronie „Zespół” - ilustracje sylwetek.
- Ikony programów bez logotypów (narzędzie zdalnej pomocy: dwa monitory i strzałka).
- Konsola administratora z nazwą ogólną „Konsola administratora”.

## 8. Do weryfikacji (rejestr nazw playbooka)

| Nazwa | Rodzaj | Status |
|---|---|---|
| Drukarnia Lipowa sp. z o.o. | firma ofiary (fikcyjna) | do sprawdzenia przez właściciela (KRS, wyszukiwarka) |
| `drukarnia-lipowa.pl` | domena strony firmy w fabule | status rejestracji do sprawdzenia przez właściciela (dns.pl); jeśli zajęta - domena produktu albo `.example` |
| `skrzynka-zewn.example` | domena zewnętrznej skrzynki (przekierowanie) | `.example` - zarezerwowana, bezpieczna |
| Karol Wieczorek, Paweł Nowicki | postacie fikcyjne | bez odniesień do prawdziwych osób (wyszukiwarka) |

Wpisy trafiają do rejestru w `docs/content/MODULE-PLAYBOOK.md` (rozdział 8) w fazie treści modułu.

## 9. Wpływ na silnik i dane (plan faz 1+)

Tylko lista konsekwencji decyzji z tego dokumentu - realizacja w kolejnych fazach, każda po akceptacji.

- **Schemat v6** (`packages/content`) - format wielojęzyczny z rozdziału 10 oraz nowe typy; każdy typ z fixturą, klasyfikacją pól,
  walidacją semantyczną, oceną serwera i testami:
  - nowe bloki `CALL_RECORDING`, `INTERROGATION`, `OSINT_SPOT`, `LIVE_CALL`, `ANNOTATED_REPLAY`;
  - `NOTE_KINDS` + `call`, `log`, `web`;
  - `VOICE_ROLES` + `karol`, `pawel`, `oszust`.
- **Potok treści** (`scripts/content`):
  - nagrania segmentów `CALL_RECORDING` (`durationMs` jako źródło znaczników czasu);
  - nowe ścieżki w `NARRATION_PATHS` i `ASSET_PATHS`;
  - test „oszust = pawel”.
- **Odtwarzacz** (`apps/web`) - pięć nowych komponentów bloków, każdy z wariantem pionowym, klawiaturą, reduced-motion i sekcją
  layout-check.
- **Wytyczne UI dla faz 1b-1e (decyzja właściciela, 2026-09-29):**
  - Makiety modułu 2 pokazują tylko **treść bloków**. Górny i dolny pasek, notatnik, licznik dowodów i narrację bierzesz z
    istniejącego `PlayerStage` - nie twórz własnych.
  - Nowe bloki używają tych samych klas co `DialogueBlock` i `SceneHotspotsBlock`: `rounded`, paleta slate/indigo, `min-h-[44px]`,
    karta od dołu jak `hotspot-card`, dymki jak w `DialogueBlock`.
  - Wyjątki z własnym tłem: ekran połączenia w `LIVE_CALL` (ciemny) i tablica korkowa w `ORDERING` - to grafika w bloku, nie chrome.
- **Testy oceny `CALL_RECORDING` (faza 1b, decyzja właściciela):** reguła nakładających się okien (tapnięcie w części wspólnej liczy
  się do wcześniejszej, jeszcze nietrafionej flagi) ma test na dwa nakładające się okna (segmenty 3 i 4) - m.in. dwa tapnięcia w części
  wspólnej trafiają obie flagi, jedno trafia wcześniejszą, a tapnięcie po trafieniu obu nie jest fałszywe.
- **Faza 1a zrobiona (D-114):** schemat v6 - `Localized<T>` z fallbackiem na `pl`, `textLayer`, notatki `call`/`log`/`web`, role
  `karol`/`pawel`/`oszust`, `voices.json` per język z `sameAs`; moduł 1 bez zmian bajt w bajt (test). Poza v6 (faza EN): odpowiedzi
  zadania tekstowego per język, ścieżki grafik `Localized`, nagrania EN w potoku. Głosy wybrane przez właściciela z próbek
  (2026-09-29; po 3 kandydatów z natywnym polskim w metadanych): karol = `V5GZ9rfeV9jjKZE5NkT7` („Adam - Emphatic and Romantic”,
  próbka karol-1), pawel = `H5xTcsAIeS5RAykjz57a` („Alex - Warm Storyteller”, pawel-1); oszust = głos Pawła (`sameAs`).
- **Faza 1b zrobiona (D-115):** `CALL_RECORDING` i `ANNOTATED_REPLAY` (schemat, klasyfikacja, walidacja, ocena serwera z regułą
  nakładających się okien i testem dwóch nakładających się okien, komponenty, wariant pionowy, klawiatura, reduced-motion, layout-check
  sekcja `modul2` na module podglądu `dev-modul-2`), ikony notatek call/log/web, rysowanie `textLayer`. Odstępstwa od szkicu z rozdz. 4:
  segment ma `narration` z `voice` (zamiast `speech` + `voice`) i `speaker`; bez `flagCategories` i `maxFalseTaps`; dowód nagrania trafia
  do notatnika po trafieniu flagi jego segmentu.
- **Do fazy 1b (z review 1a - zrobione w D-115):** odtwarzacz nie zna jeszcze v6 - `NoteKind` w `apps/web/src/lib/courses-types.ts` bez `call`/`log`/`web`
  (notatnik pokazałby wpis bez ikony) i brak rysowania `textLayer` na scenach i zbliżeniach. Oba muszą wejść, zanim treść v6 trafi do
  odtwarzacza (najpóźniej z pierwszym blokiem modułu 2). Przed fazą EN: język z żądania walidowany w DTO (`@IsIn(CONTENT_LOCALES)`);
  `localizeContent` już odrzuca nieznany język.
- **Ustawienia dostępności konta:** „Bez limitów czasu” (WCAG 2.2.1) - nowe pole preferencji użytkownika (migracja) + przełącznik
  „Wyłącz limit czasu” na ekranie przed połączeniem `LIVE_CALL`. Limit nie zależy od `prefers-reduced-motion`.
- **Osiągnięcia:**
  - ranga RARE (migracja enumu);
  - 4 wpisy katalogu (migracja);
  - warunki w `achievements.ts`;
  - trofea w kompozytorze.
- **Weryfikacja:**
  - `LAYOUT_CHECK_MODULE=glos-z-helpdesku`;
  - smoke `scripts/e2e-module.mjs glos-z-helpdesku`;
  - pełne przejście `scripts/e2e-module-02.mjs`.

## 10. Gotowość na wersję EN (schemat wielojęzyczny)

Tłumaczenie EN przyjdzie później, ale schemat modułu 2 jest wielojęzyczny od początku. Zgodnie z CLAUDE.md („PL + EN wystarczy w danych,
nie buduj pełnego i18n frameworka od razu”) zmiana dotyczy **danych treści**, nie tłumaczenia interfejsu aplikacji.

### 10.1 Stan dziś (moduł 1, schemat v5)

Format treści modułu 1 **nie obsługuje wielu języków**:

- każde pole tekstowe dla gracza (tytuły, teksty, etykiety, notatki, `alt`, pytania, odpowiedzi, wnioski) to pojedynczy string;
- `narration` to jeden tekst, jeden `spokenText`, jedno nagranie (`audioUrl`, `durationMs`, `cues`);
- `voices.json` mapuje rolę na jeden `voiceId`;
- klucze `audio.lock.json` i `assets.lock.json` nie mają języka;
- odpowiedzi tekstowe (`TEXT_INPUT_GUIDED.answer`, `regex`) są jednojęzyczne;
- użytkownik ani organizacja nie mają pola języka.

### 10.2 Minimalna zmiana schematu (opis; bez implementacji teraz)

1. **Typ `Localized<T>`:** obiekt kluczowany locale - `{ "pl": T, "en"?: T }`.
   - `pl` jest wymagane.
   - Kolejne języki dochodzą jako opcjonalne klucze z zamkniętej listy `CONTENT_LOCALES` (dziś `pl`, `en`).
2. **Pola tekstowe:** od `schemaVersion` 6 każde pole tekstowe dla gracza to `Localized<string>`.
   - Walidator v6 akceptuje też zwykły string i czyta go jako `{ pl }`.
   - Treść v5 i starsza przechodzi bez zmian (kompatybilność wstecz).
3. **Nagranie:** `narration` (i wszystkie jego odpowiedniki, np. `speech` w nowych typach):
   `{ "voice"?: rola, "pl": { "text", "spokenText"?, "audioUrl"?, "durationMs"?, "cues"? }, "en"?: { … } }`.
   - Rola głosu jest wspólna, a tekst, `spokenText` i nagranie są osobne na każdy język.
   - Nagranie EN ma inną długość - wszystko, co liczy czas z `durationMs` (znaczniki `CALL_RECORDING`, napisy), liczy się per język.
4. **Grafiki:** pole grafiki domyślnie zostaje jednym plikiem dla wszystkich języków (tekst w warstwie).
   - Wyjątkowo `Localized<ścieżka>` (`{ "pl": "scenes/x.svg", "en": "scenes/x.en.svg" }`) dla grafik oznaczonych „wymaga wariantu EN”
     (rozdział 7).
   - Nowe pole `textLayer[] { id, x, y, w, h, text: Localized<string>, style? }` na scenach i zbliżeniach - tekst rysowany przez
     odtwarzacz w prostokącie w % grafiki (jak sloty odprawy), z minimalnym rozmiarem czcionki 15 px na telefonie (D-103).
5. **Odpowiedzi zależne od języka:** `answer` / `regex` zadania tekstowego jako `Localized`; ocena na serwerze w języku przypisania.
6. **Wybór języka:** język gracza rozwiązuje serwer w `toClientBlock` / `client-view`.
   - Źródło: pole użytkownika, potem organizacji, domyślnie `pl` - migracja w fazie EN.
   - Klient dostaje zwykłe stringi i jedno nagranie, jak dziś, więc odtwarzacz prawie się nie zmienia.
   - **Fallback:** brak klucza `en` w polu oznacza `pl`, pole po polu; import wypisuje ostrzeżenie „brak tłumaczenia EN: <ścieżka>”.
7. **Potok treści:**
   - klucze locka z językiem - `<blockId>#<ścieżka>@<locale>`, a dla `pl` bez sufiksu, zgodnie ze stanem dzisiejszym;
   - `voices.json` per locale z `sameAs` (rozdział 5);
   - reguła D-109 (bez cyfr w tekście dla TTS) sprawdzana per język.
8. **Wersje treści:** dodanie EN to nowa wersja treści (hash obejmuje wszystkie języki). Rozpoczęte przypisania zostają na swojej
   wersji (zasada bez zmian).

**Moduł 2 powstaje od razu w tym formacie, z wypełnionym tylko `pl`.** Przykłady JSON w rozdziale 4 pokazują kształt.

### 10.3 Wpływ na moduł 1 - lista miejsc do zmiany (przy jego tłumaczeniu)

Dzięki kompatybilności wstecz moduł 1 **nie wymaga zmian**, dopóki nie jest tłumaczony. Tłumaczenie oznacza podniesienie `module.json`
do v6 i:

- **Treść (`module.json`) - pola do `Localized`:**
  - `title`, `subtitle`, `objectives[]`;
  - `BRIEFING`:
    - `steps[].text`, `sub`, `cta`;
    - `caller.name`, `caller.role`;
    - `caseFile.title`, `fields[].label/value`, `tasks[].text`;
    - `narration`.
  - `SCENE_HOTSPOTS`:
    - `title`, `narration`, `imageAlt`;
    - `hotspots[]` - `label`, `content`, `note.text`;
    - `media` - `alt`, `transcript`, `document`;
    - okienka easter egga - `items[]` (`title`, `body`, `button`), `outro`, `badge.label`;
    - sceny zagnieżdżone - te same pola.
  - `DIALOGUE`:
    - `character.role`, `character.opening`;
    - `questions[]` - `text`, `lines[].text`, `note.text`, nagrania;
    - `reactions`.
  - `EMAIL_ANALYSIS`: wyświetlana nazwa nadawcy, temat, treść, `criteria[].text` i opisy rozstrzygnięć.
  - `DOSSIER`: `documents[]` - `tab`, `org`, `title`, `meta`, `columns`, `rows[].cells`, `note.text`.
  - `ORDERING`: `prompt`, `items[].text`, `start/end.label/caption`.
  - `TEXT_INPUT_GUIDED`: `prompt`, `hints[]`, `solution`, `answer` / `regex`.
  - `SUMMARY`: `text`, `lessons[]`.
  - Wszystkie `tip` i `narration.spokenText`.
- **Grafiki modułu 1 z tekstem wypalonym - do przeniesienia do `textLayer` albo wariantu EN:**
  - tabliczka „Księgowość →” w `korytarz`;
  - `tablica-zoom` (ogłoszenia);
  - `karteczka-zoom` (hasło na karteczce - wariant EN);
  - `kalendarz-zoom`;
  - `wydruk`;
  - `mail-na-ekranie` (+ `-pion`);
  - `historia-przegladarki` (+ `-pion`);
  - podpisy ikon na `pulpit`;
  - `telefon-zoom`;
  - gazeta i tabliczki w scenach odprawy;
  - `zamkniecie-raport` (nagłówki pól), `zamkniecie-pieczec` i `zamkniecie-liscik` (wariant EN);
  - miniatura.
- **Kod (faza wielojęzyczna, osobne PR-y):**
  - `packages/content`:
    - `common.ts` - `text()`, `narrationSchema`, `noteSchema`, nowy `localized()`;
    - `blocks.ts` - każdy schemat i `FIELD_CLASSIFICATION` na ścieżkach z locale;
    - `semantics.ts` - `narrationsIn` i reguła cyfr per język, ostrzeżenia o brakach EN;
    - fixtury i testy.
  - `apps/api`:
    - `client-view.ts` / `toClientBlock` - rozwiązanie języka i fallback;
    - `scoring/evaluate.ts` - odpowiedzi tekstowe per język;
    - `content-import` - hash i ostrzeżenia;
    - pole języka użytkownika / organizacji (migracja).
  - `scripts/content`:
    - `pipeline.ts` (`collectNarrations` per język), `tts.ts`;
    - `assets.ts` (grafiki `Localized`);
    - `voices.json` (nowy kształt z `sameAs`), klucze locków.
  - `apps/web`:
    - rysowanie `textLayer` na scenach;
    - wybór języka w ustawieniach konta;
    - bez frameworka tłumaczeń UI - teksty interfejsu to osobna decyzja (backlog v2).
