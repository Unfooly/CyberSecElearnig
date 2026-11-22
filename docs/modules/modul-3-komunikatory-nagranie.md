# Moduł 3 „Komunikatory i SMS-y” – scenariusz według nagrania „Usługi przesyłania wiadomości”

Status: **zaakceptowany przez właściciela 2026-11-22**:
1. Zastępuje poprzednią treść modułu 3 „Przejęte konto” (nowa wersja kursu, slug `lancuszek` i numer sprawy 3 bez zmian).
2. Postacie: **Ola Malec** z księgowości (bohaterka, jak dotąd), fałszywa znajoma **„Marta”**, **Adam Kowal z działu IT** (z modułu 4).
3. **Bez wątku BLIK i kodu z SMS-a** (pytania z poprzedniej wersji usunięte – nagranie ich nie ma).
4. Grafiki jak w module 4: ilustracje scen z Dreaminy, ekrany czatu i SMS-a z czytelnym tekstem z kompozytora, na razie bez lektora.
5. Tryb prosty zostaje.

**Wdrożone w D-203.** Źródłem prawdy o blokach jest `packages/content/modules/lancuszek/module.json`.

## Źródło

Nagranie właściciela `usługi przesyłania wiadomości.mp4` (3:11), moduł cudzego kursu. Jak przy modułach 1 (D-176) i 4 (D-201)
przejmujemy wyłącznie **przebieg i mechaniki**; teksty, postacie i grafiki są nasze, w stylu Unfooly, bez prawdziwych marek
(w nagraniu: Apple ID, Facebook Messenger, YouTube, WhatsApp – u nas „nowy komunikator”, nadawca KONTO-INFO, domeny `.test`).

## Przebieg oryginału i nasza wersja

| # | Ekran w nagraniu | Mechanika | Nasz blok |
|---|---|---|---|
| 1 | SMS z nieznanego numeru: „Agata” zaprasza do nowego komunikatora | ilustracja + tekst | `zaproszenie` NARRATIVE: Ola dostaje SMS od „Marty z liceum” z linkiem do aplikacji |
| 2 | Instalacja, rozmowa o restauracji, plik Word | ilustracja + tekst | `nowy-komunikator` NARRATIVE: pytania o pracę i plik Menu.docx |
| 3 | Plik otwarty w domu – komputer zainfekowany | ilustracja + tekst | `wirus` NARRATIVE: złośliwy program z pliku na służbowym laptopie |
| 4 | „Dlaczego komunikatory mogą być niebezpieczne” – rozmowa z 4 punktami | klik odsłania opis | `rozmowa` SCENE_HOTSPOTS: nieznany numer, pytania o pracę, prywatne informacje Oli, plik |
| 5 | „Klasyczne wiadomości tekstowe też” – SMS z 4 punktami, smishing | klik odsłania opis | `sms` SCENE_HOTSPOTS: nadawca, pośpiech i groźba, skrócony link, „odpisz STOP” |
| 6 | Atak przez komunikator w 3 krokach | 3 zakładki | `lancuszek` NARRATIVE z trzema krokami (wątek łańcuszka z poprzedniej wersji) |
| 7 | Ekspertka: 3 pytania przed korzystaniem z komunikatora | ilustracja + tekst | `trzy-pytania` NARRATIVE: Adam z IT |
| 8 | „Quiz – pomóż Janowi” | przerywnik | `czas-na-quiz` NARRATIVE (ilustracja Adama z modułu 4) |
| 9 | 3× wielokrotny wybór, 1× „Czym jest smishing?” | quiz | `prawda`, `niebezpieczne`, `film` – QUIZ `multiple`; `smishing` – QUIZ |
| 10 | „Gratulacje, 100%” | koniec | `raport` SUMMARY (trzy nowe zasady) + ekran końca z okienkiem nagrody (D-199) |

## Trzy zasady (raport, grafika zamknięcia)

1. Plik albo aplikacja od nieznajomego? Nie otwieraj – zapytaj IT.
2. Dziwna wiadomość od znajomego? Sprawdź ją innym kanałem.
3. SMS z linkiem i pośpiechem? Nie klikaj i nie odpisuj.

## Grafiki

- **Ilustracje** (9, Dreamina Seedream 4.7 i2i, 18 kredytów, `grafiki_m3/specs-sceny.txt`): Ola z brandkitu (`woman_ref.png`), Adam (karta
  postaci z modułu 4), haker z brandkitu. Kadr bez etykiety „AI” i znaku wodnego (`grafiki_m3/illu-webp.cjs`). `quiz-start.webp` – ta sama
  ilustracja co w module 4.
- **Rozmowa i SMS** – nowe klocki kompozytora `strangerChatPhone` i `smsPhone` (`scripts/content/scenes/props-lancuszek.ts`), sceny
  `examples/lancuszek/{komunikator,sms}{,-pion}.json`; tekst wpalony z kontrolą dopasowania i pseudo-lokalizacji (D-143).
- **Raport** – grafika zamknięcia przebudowana z nowymi zasadami i tytułem „Komunikatory”; pieczęć i liścik bez zmian.
- Okładki i miniatura – bez zmian (telefon z filmem w czacie, haker za szybą – pasują do wątku łańcuszka).

## Lektor – do nagrania później

Na razie bez lektora (jak moduł 4, B-183/B-184). Teksty do nagrania (głos `komisarz`):

- `zaproszenie`: Wieczorem Ola Malec z księgowości dostaje SMS-a z nieznanego numeru. To Marta z liceum: przeszła na nowy komunikator i prosi, żeby Ola pobrała go z linku. Ola klika i instaluje aplikację.
- `nowy-komunikator`: Marta pisze o nowej włoskiej restauracji i dopytuje, gdzie Ola teraz pracuje. Ola odpowiada bez zastanowienia. Po chwili przychodzi plik z menu.
- `wirus`: W domu Ola otwiera menu na służbowym laptopie. Dokument jest pusty, a laptop zaczyna dziwnie działać. Razem z plikiem przyszedł złośliwy program.
- `rozmowa`: Co w tej rozmowie powinno wzbudzić czujność? Sprawdź cztery miejsca.
- `sms`: Takie pułapki przychodzą też zwykłym SMS-em. Znajdź cztery sygnały ostrzegawcze.
- `lancuszek`: Tak działa częsty atak w komunikatorach. Znajomy przysyła film. Film wymaga logowania na fałszywej stronie. A potem oszust wysyła ten sam film wszystkim Twoim kontaktom.
- `trzy-pytania`: Adam z działu IT wyczyścił laptopa Oli. Radzi zadać sobie trzy pytania: czy aplikacja jest sprawdzona, czy wiem, z kim piszę, i czy sprawdzam pliki.
- `czas-na-quiz`: Sprawdź, czy rozpoznasz pułapki w komunikatorach i SMS-ach.
- `raport`: Ola od razu zgłosiła sprawę do IT. Adam wyczyścił laptopa, zanim dane firmy wyciekły, a Ola ostrzegła znajomych.
