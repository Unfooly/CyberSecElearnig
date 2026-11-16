# Moduł 5 „Najłatwiejsze drzwi” - scenariusz (projekt do akceptacji właściciela)

Źródło: zlecenie właściciela z 2026-11-16 (moduł o bezpieczeństwie sieci, kolejność **wstęp → wideo → quiz**, styl Unfooly) i cztery
decyzje z tego samego dnia (pkt 1). Wideo `elearning_16x9.mp4` (2:21) i brandkit (obsada, paleta) dostarczył właściciel. Zrzuty
cudzego kursu posłużyły wyłącznie za wzór kolejności ekranów; wszystkie teksty, pytania i grafiki w tym dokumencie są własne. Ten
dokument jest źródłem prawdy dla `module.json` (MODULE-PLAYBOOK, rozdział 1).

## 1. Założenia

- **Temat:** firmowa sieć ma „drzwi” - fizyczne (wejście z czytnikiem kart, gniazdka sieciowe w ścianie) i niewidoczne (Wi-Fi,
  logowanie do kont). Przestępca nie musi niczego łamać - szuka drzwi, które ktoś zostawił otwarte. Pracownik nie konfiguruje sieci,
  ale codziennie decyduje, czy te drzwi są zamknięte: komu przytrzyma drzwi, co podłączy, komu poda hasło do Wi-Fi.
- **Fabuła wideo** (wersja EN obejrzana; wersja PL od właściciela - decyzja 1): haker wchodzi do biura tuż za Anną, która otwiera
  drzwi kartą, podpina laptop do gniazdka w sali konferencyjnej i… nic, bo sieć jest podzielona na strefy, a sieć dla gości jest
  oddzielona od firmowej. Na końcu cztery nawyki: noś kartę, pytaj obcych, dokąd idą, nie podłączaj znalezionych nośników, gościom
  dawaj sieć dla gości.
- **Decyzje właściciela (2026-11-16):**
  1. Wideo: właściciel dostarczy **wersję PL** (lektor i napisy po polsku); plik EN zostaje na późniejszą wersję EN modułu.
  2. Quiz: **wielokrotny wybór** („zaznacz wszystkie poprawne”) - wymaga zmiany silnika przed treścią (pkt 5.1).
  3. Grafiki wstępu: **sceny SVG z kompozytora**, jak w modułach 1-4.
  4. Wstęp: **jeden ekran startowy** - krótki opis, o czym jest moduł, jedna grafika i przycisk „Zaczynamy” (doprecyzowanie
     właściciela 2026-11-16: bez sceny z celami do kliknięcia i bez odprawy detektywistycznej).
- **Tryb prosty** (`simpleMode: true`, D-132) jak moduły 3-4: tekst ≥ 16 px na 390 px, polecenia ≤ 90 znaków i jedno zdanie, każda
  odpowiedź z `feedback` ≤ 140 znaków, `hint` po 2 błędach. Tryb prosty dziś nie dopuszcza bloku `VIDEO` ani QUIZ z kilkoma
  poprawnymi odpowiedziami - obie zmiany w pkt 5. `locales: ["pl"]`; EN dopiero po „zatwierdzam treść modułu 5” (D-143).
- **Bez imion poza wideo:** w wideo koleżanka ma na imię **Anna** (postać z brandkitu); bohater i haker są bez imion. Moduł 1 też ma
  Annę (inną postać) - pkt 6.2.
- **Nazwy fikcyjne:** firma Unfooly Sp. z o.o. (jak moduł 1), sieci Wi-Fi „Unfooly” i „Unfooly-Gość”; bez logotypów, bez prawdziwych
  marek routerów i drukarek.
- **Głos:** ekran startowy bez lektora; podsumowanie - lektor `komisarz` (A.W.) jak w modułach 3-4 (pkt 6.1). Wideo ma własnego lektora.

## 2. Metadane

| pole | wartość |
|---|---|
| slug | `najlatwiejsze-drzwi` |
| title | Najłatwiejsze drzwi |
| subtitle | Jak przestępca szuka wejścia do firmowej sieci - i jak mu go nie zostawić |
| category | `IT_HYGIENE` |
| level | `basic` |
| durationMinutes | 6 |
| objectives | 1) Wiedzieć, że do firmowej sieci prowadzą drzwi fizyczne (wejście, gniazdka) i niewidoczne (Wi-Fi, logowanie). 2) Nie wpuszczać obcych za sobą i pytać nieznajomych, do kogo przyszli. 3) Nie podłączać nieznanych urządzeń ani znalezionych nośników i zgłaszać je do IT. 4) Gościom dawać sieć dla gości, nigdy hasło do sieci firmowej. 5) Chronić konto logowaniem dwuetapowym i VPN poza biurem. |

## 3. Bloki

Kolejność: **start → wideo → 4 pytania → podsumowanie** (7 bloków).

### 3.1 Start (BRIEFING, `start`) - jeden ekran

- **Grafika (jedna, scena statyczna z kompozytora):** wejście do biura - szklane drzwi z czytnikiem kart; bohater (granatowy sweter,
  jak w brandkicie) przykłada kartę, a tuż za nim, w cieniu, postać w kapturze. Paleta brandkitu: tło #131313, akcent #6C5CE7.
  Wariant pionowy na telefon.
- **Tytuł:** Najłatwiejsze drzwi
- **Opis (jeden krok, bez maszyny do pisania i bez lektora - pkt 6.1):**
  > Przestępca nie musi łamać zabezpieczeń – szuka drzwi, które ktoś zostawił otwarte. Obejrzysz krótki film o tym, jak próbuje
  > dostać się do firmowej sieci, a potem sprawdzisz w quizie, jak mu to utrudnić.
- **Przycisk:** „Zaczynamy”.

### 3.2 Wideo (VIDEO, `film`) - wymaga zmian w silniku (pkt 5.2)

- **Tytuł:** Najłatwiejsze drzwi
- **Plik:** wersja PL od właściciela (lektor i napisy po polsku), 16:9, publikowana w R2 jak grafiki (`--assets`) - nie w repo
  (44 MB). Plakat: pierwsza klatka albo grafika z kompozytora.
- **Ukończenie:** „Dalej” po obejrzeniu do końca (jak dziś w bloku VIDEO), przewijanie do przodu zablokowane dopiero po pierwszym
  obejrzeniu - pkt 6.3.
- **Bez narracji lektora** przed wideo - wideo ma własnego lektora, a dwa głosy po sobie zlewają się.

### 3.3-3.6 Quiz (QUIZ wielokrotnego wyboru) - wymaga zmian w silniku (pkt 5.1)

Wspólne: nad odpowiedziami stała linijka odtwarzacza „Zaznacz wszystkie poprawne odpowiedzi.” (nie w treści pytania), przycisk
„Sprawdź”. Każda odpowiedź ma własne zdanie informacji zwrotnej, pokazywane po sprawdzeniu przy tej odpowiedzi. ✔ = poprawna.

#### 3.3 Ktoś za tobą (`ktos-za-toba`)

- **Pytanie:** Co robisz, gdy ktoś bez karty idzie tuż za tobą do biura?
- **Odpowiedzi:**
  - ✔ **Pytam, do kogo przyszedł, i prowadzę go do recepcji.** → *Tak – uprzejme pytanie wystarczy. Gość i tak trafi do recepcji.*
  - Przytrzymuję drzwi, bo wygląda na kogoś z firmy. → *Wygląd nic nie mówi. Tak właśnie haker z wideo wszedł za Anną.*
  - ✔ **Nie przytrzymuję drzwi osobie bez karty.** → *Tak – każdy ma swoją kartę. Niech skorzysta z niej albo z recepcji.*
  - Pożyczam mu swoją kartę, żeby nie czekał. → *Twoja karta to twoje wejście – wszystko, co ktoś z nią zrobi, idzie na twoje konto.*
- **Podpowiedź:** Do biura wchodzi się własną kartą albo przez recepcję.

#### 3.4 Coś podpięte (`cos-podpiete`)

- **Pytanie:** Które z tych sytuacji od razu zgłaszasz do IT?
- **Odpowiedzi:**
  - ✔ **Nieznane urządzenie podpięte do gniazdka w sali konferencyjnej.** → *Tak – to może być czyjś „przedłużacz” do firmowej sieci.*
  - ✔ **Pendrive znaleziony na parkingu firmy.** → *Tak – nie podłączaj go. Oddaj IT, nawet jeśli kusi, żeby sprawdzić, czyj jest.*
  - Kolega pracuje na firmowym laptopie przy swoim biurku. → *To zwykły dzień pracy – nie ma czego zgłaszać.*
  - ✔ **Nieznajomy siedzi z laptopem w sali, w której nie ma spotkania.** → *Tak – zapytaj, czy możesz pomóc, i daj znać IT albo recepcji.*
- **Podpowiedź:** Zgłaszasz to, czego nie znasz i czego nie powinno tam być.

#### 3.5 Gość prosi o internet (`gosc-prosi`)

- **Pytanie:** Co możesz zrobić, gdy gość na spotkaniu prosi o internet?
- **Odpowiedzi:**
  - Podaję mu hasło do firmowej sieci „Unfooly”. → *Firmowa sieć jest tylko dla firmowych urządzeń. Hasło raz podane krąży dalej.*
  - ✔ **Daję mu dostęp do sieci „Unfooly-Gość”.** → *Tak – sieć dla gości jest oddzielona od firmowej. Gość ma internet, a nie twoje pliki.*
  - Podłączam jego laptop kablem do gniazdka w sali. → *Kabel w gniazdku to wejście do firmowej sieci – sieć dla gości jest bezpieczniejsza.*
  - ✔ **Kieruję go do recepcji po dane do sieci dla gości.** → *Tak – recepcja albo IT wydają dostęp dla gości.*
- **Podpowiedź:** Firma ma osobną sieć dla gości.

#### 3.6 Praca poza biurem (`poza-biurem`)

- **Pytanie:** Co chroni firmową sieć, gdy pracujesz na firmowym laptopie z kawiarni?
- **Odpowiedzi:**
  - ✔ **Łączę się z firmą przez firmowy VPN.** → *Tak – VPN szyfruje połączenie, nawet w otwartej sieci kawiarni.*
  - ✔ **Loguję się z kodem z telefonu.** → *Tak – ktoś, kto zna tylko twoje hasło, bez twojego telefonu się nie zaloguje.*
  - Używam jednego hasła do wszystkich kont, żeby go nie zapomnieć. → *Jeden wyciek otwiera wtedy wszystkie konta naraz.*
  - Zostawiam odblokowany laptop, gdy idę po kawę. → *Odblokowany laptop to otwarte drzwi. Zablokuj ekran, zanim wstaniesz.*
- **Podpowiedź:** Szukaj tego, co działa także wtedy, gdy ktoś pozna twoje hasło.

### 3.7 Podsumowanie (SUMMARY, `podsumowanie`)

- **Narracja (lektor - pkt 6.1):** Haker szukał najłatwiejszych drzwi i żadnych nie znalazł. To zasługa nie tylko IT, ale każdej osoby w
  biurze.
- **Tekst:** Sieć chroni IT, ale drzwi do niej otwierają i zamykają ludzie. Wystarczą trzy nawyki.
- **Trzy zasady:**
  1. Wchodzisz swoją kartą – nikogo nie wpuszczasz za sobą, a obcych pytasz, do kogo przyszli.
  2. Nie podłączasz nieznanych urządzeń ani znalezionych nośników – zgłaszasz je do IT.
  3. Goście dostają sieć dla gości, a ty logujesz się z kodem i przez VPN poza biurem.
- **Ekran zamknięcia:** bez pieczęci „SPRAWA ZAMKNIĘTA” (to nie śledztwo) - pkt 6.4.

## 4. Dowody i ocena

- **Dowody (notatnik):** 0 - moduł nie ma sceny z przedmiotami, a wideo i quiz nie dodają dowodów. Licznik dowodów i notatnik w
  module bez dowodów - do sprawdzenia w PR treści (ukryte, nie „0/0”).
- **Oceniane:** 4 pytania quizu, waga 1 każde. Pytanie zaliczone, gdy zaznaczono **dokładnie** wszystkie poprawne i żadnej błędnej
  (bez punktów cząstkowych - pkt 5.1). W trybie prostym: próby do skutku, wynik z pierwszej próby (jak QUIZ dziś).

## 5. Zmiany w silniku przed treścią (osobne PR-y)

### 5.1 QUIZ wielokrotnego wyboru (PR przed treścią; `security-reviewer` - ocena na serwerze)

- Schemat: `QUIZ` z polem `multiple: true` (klient - odtwarzacz musi wiedzieć, że to pola wyboru); `correct` przy odpowiedziach
  zostaje sekretem. Bez `multiple` - zachowanie bez zmian (moduły 1-4 bajt w bajt).
- Walidacja: przy `multiple: true` 3-6 odpowiedzi, co najmniej 1 poprawna i co najmniej 1 błędna; w trybie prostym każda odpowiedź z
  `feedback` ≤ 140, `hint`.
- Ocena wyłącznie na serwerze: klient wysyła zbiór indeksów (bez duplikatów, w zakresie), serwer porównuje ze zbiorem poprawnych; w
  odpowiedzi `/check` informacja zwrotna dla każdej zaznaczonej i każdej pominiętej poprawnej odpowiedzi - dopiero po próbie (klucz nie
  trafia do klienta przed wyborem).
- Odtwarzacz: pola wyboru (cel dotyku ≥ 44 px), przycisk „Sprawdź” nieaktywny bez zaznaczenia, linijka „Zaznacz wszystkie poprawne
  odpowiedzi.”; layout-check 390×844 i 1366×768 (reguła 12).

### 5.2 Wideo w module (PR przed treścią)

- `VIDEO` dopuszczony w trybie prostym.
- Plik wideo przez potok zasobów (`ASSET_PATHS`, publikacja `--assets` do R2, klucz z hashem w `module.json`) zamiast ręcznego
  adresu https; `media-src` z `CONTENT_BASE_URL` jest już w CSP.
- Odtwarzacz: blok wideo w stylu odtwarzacza (dziś jasna karta „Wideo” ze starego wyglądu), plakat, `playsinline`; napisy wpalone w
  wideo PL, więc bez osobnego pliku napisów (pkt 6.3).

## 6. Do decyzji właściciela

1. **Lektor** - propozycja: ekran startowy bez lektora (sam tekst, wideo zaraz potem ma własnego lektora); podsumowanie czyta
   `komisarz` (A.W.) jak w modułach 3-4, czy też bez lektora?
2. **Anna** - w wideo koleżanka ma na imię Anna, a w module 1 Anna to inna postać (ofiara phishingu). Zostawiamy (to imię z wideo,
   moduły są niezależne), czy prosisz o inne imię w wersji PL wideo?
3. **Wideo** - blokować „Dalej” do końca filmu (jak dziś), czy pozwolić przejść dalej od razu? Napisy PL wpalone w obraz (jak w EN)
   czy osobny plik napisów (wymaga obsługi napisów w odtwarzaczu)?
4. **Ekran zamknięcia** - prosty ekran z trzema zasadami (bez pieczęci i liściku), czy elementy zamknięcia jak w modułach 3-4 z
   pieczęcią np. „DRZWI ZAMKNIĘTE”?
5. **Liczba pytań** - 4 (jak wyżej), czy krócej (3)?
