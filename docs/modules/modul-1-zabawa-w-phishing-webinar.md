# Moduł 1 „Zabawa w phishing” – nowy scenariusz „Webinar” (SZKIC do akceptacji)

Status: **zaakceptowany przez właściciela 2026-11-19**: (1) zastępuje obecną treść modułu 1 (nowa wersja kursu, slug bez zmian),
(2) nazwy OK (obie domeny sprawdzone 2026-11-19: nie istnieją), (3) gazeta z prawdziwym incydentem zostaje, jako ekran tuż PRZED
ekranem końca. Nic z tego nie jest jeszcze w `module.json`.

Do zachowania przy przebudowie: ukryta odznaka „Ciekawski detektyw” (easter egg `ciekawski-detektyw`, okienka na pulpicie
komputera ofiary) - przenosimy ją na pulpit komputera Pawła, żeby odznaka dalej była do zdobycia.

Źródło: nagranie właściciela `Nagrywanie 2026-11-19 172542.mp4` (3:13). To moduł cudzego kursu („Zabawa w kotka i phishing”).
Przejmujemy wyłącznie **przebieg i mechaniki**. Teksty, postaci, firmy, domeny i grafiki są nasze, w stylu Unfooly, jak przy
module 5. Prawdziwy incydent z zakończenia (Charming Kitten, 2020) to fakt publiczny, opisany własnymi słowami.

## Przebieg oryginału (co odwzorowujemy)

| # | Ekran w nagraniu | Mechanika |
|---|---|---|
| 1 | „Nowe zadanie!” – teczka „Ściśle tajne”, zakładki: Twoje zadanie / Incydent / Ofiara ataku | zakładki, Dalej po obejrzeniu wszystkich |
| 2 | „Zacznij szukać wskazówek” – biuro ofiary: komputer, smartfon, ofiara | scena z 3 punktami, każdy prowadzi do zadania, ✓ po wykonaniu |
| 3 | Komputer → mail z zaproszeniem na webinar + notes „Czy to phishing?” | zaznacz cechy phishingu (poprawna tylko „atrakcyjna oferta”) |
| 4 | Smartfon → historia komunikatora (połączenie głosowe 14 min, link „Rejestracja”) | klik w fragmenty = notatki w notesie |
| 5 | „Dostał link” → adres URL ukryty, wpisz domenę | pole tekstowe + podpowiedzi krok po kroku (pierwszy „/” od lewej, potem w lewo do drugiej kropki) |
| 6 | „Czy link jest godny zaufania?” Tak / Nie | wyjaśnienie: poddomena może mieć dowolną nazwę |
| 7 | Rozmowa z ofiarą | wybór pytań, przeciąganie odpowiedzi do notesu |
| 8 | Tablica śledcza – ułóż etapy ataku: E-mail → Rozmowa telefoniczna → Link | przeciąganie w kolejności |
| 9 | Raport końcowy – zakładki Etap 1–3, przy każdym rada | zakładki |
| 10 | „Zanim sobie pójdziesz” – gazeta z prawdziwym incydentem | klik w gazetę |

## Nasza wersja (Unfooly)

**Fabuła:** Paweł Nowicki, analityk danych w Unfooly Sp. z o.o. (bohater z brandkitu), dostaje pochlebne zaproszenie do wystąpienia
jako prelegent na webinarze „Dane w praktyce”. Nadawca: „Fundacja Analityki Stosowanej” (fikcyjna), `k.zielinska@fundacja-analityki.pl`.
Mail jest porządny, jedyna czerwona flaga to nieoczekiwana, atrakcyjna oferta. Potem „organizatorka” pisze do niego w komunikatorze,
dzwoni (12 min 40 s), buduje zaufanie i przysyła link „Formularz prelegenta”:
`https://fundacja-analityki.formularz-online.net/prelegenci/48213`. Strona prosi o zalogowanie się służbowym kontem pocztowym
„dla potwierdzenia tożsamości”. Paweł się loguje – przestępcy przejmują jego skrzynkę. Gracz jako detektyw Unfooly ustala, jak do tego doszło.

**Postaci:** Paweł Nowicki (ofiara, bohater), „Katarzyna Zielińska” (fałszywa organizatorka – na grafikach jako oszustka/oszust
z brandkitu), gracz (detektyw). Lektor: obecna rola narratora modułu 1.

| blok | typ (propozycja) | treść | ocena |
|---|---|---|---|
| 0 | TABS (teczka) | Twoje zadanie / Incydent („skrzynka Pawła wysyłała w nocy maile do klientów”) / Ofiara (Paweł, analityk danych) | – |
| 1 | SCENE_HOTSPOTS „Biuro Pawła” | komputer, smartfon, Paweł; ✓ po każdym zadaniu | – |
| 2 | EMAIL_ANALYSIS „Zaproszenie” | 4 kryteria: błędy językowe / nietypowy układ / linki lub załączniki / nieoczekiwana atrakcyjna oferta → poprawne tylko ostatnie; reakcja: „Ktoś się naprawdę przygotował.” | waga 2 |
| 3 | NOTEPAD „Komunikator” | historia czatu; klik: połączenie 12 min 40 s → „Przestępcy dzwonili do Pawła”, link → „Po rozmowie wysłali link” | – |
| 4 | TEXT_INPUT_GUIDED „Dokąd prowadzi link?” | wpisz domenę; podpowiedzi 1) pierwszy pojedynczy „/” od lewej, 2) w lewo do drugiej kropki; odpowiedź `formularz-online.net` | waga 2 |
| 5 | QUIZ „Czy link jest godny zaufania?” | Tak / Nie → Nie; wyjaśnienie poddomeny | waga 1 |
| 6 | INTERROGATION „Rozmowa z Pawłem” | 4 pytania: co się stało / czy coś było dziwne w mailu / co zrobił potem / czy podał hasło; odpowiedzi trafiają do notatek | – |
| 7 | ORDERING „Tablica” | E-mail → Rozmowa telefoniczna → Link | waga 2 |
| 8 | SUMMARY „Raport końcowy” | 3 etapy, przy każdym rada: sprawdź nieoczekiwaną ofertę innym kanałem; nie daj się naciskom przez telefon – rozłącz się; przed logowaniem sprawdź domenę, służbowego hasła nie podajesz na obcej stronie; zgłoś do IT | – |
| 9 | ekran końca + „Zanim pójdziesz” (gazeta) | prawdziwy incydent: w 2020 r. grupa Charming Kitten (APT35) podszywała się pod dziennikarzy i organizatorów wydarzeń, pisała przez WhatsApp i LinkedIn, dzwoniła, a potem wysyłała link do fałszywej strony logowania | – |

Typy bloków są propozycją: dokładne mapowanie i ewentualne braki silnika zgłoszę w PR treści, bez improwizacji.

## Grafiki (Dreamina, Seedream 4.7, styl okładek Unfooly)

Okładki start / koniec / miniatura, biuro Pawła (scena z punktami), portret Pawła do rozmowy, teczka, tablica śledcza, gazeta.
Ekrany komputera, maila i komunikatora – jak dotąd z kompozytora (HTML/SVG, czytelny tekst), nie z generatora.

## Do decyzji właściciela

1. **Zastąpić obecną treść modułu 1** (Anna, bank, Bukareszt; slug `wyludzone-haslo` zostaje, powstaje nowa wersja kursu, kto
   zaczął, kończy na starej) **czy dodać ten scenariusz jako nowy moduł**, a obecny zostawić pod inną nazwą?
2. Nazwy: Paweł Nowicki, „Fundacja Analityki Stosowanej”, domena `formularz-online.net` – OK? (Przed PR treści sprawdzę, że obie
   domeny nie należą do prawdziwych firm; jeśli tak, zmienię je na nieistniejące.)
3. Gazeta z prawdziwym incydentem (Charming Kitten 2020) – zostawiamy?
