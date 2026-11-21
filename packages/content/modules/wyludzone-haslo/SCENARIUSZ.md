# Moduł 1 – „Zabawa w phishing” (scenariusz „Webinar”, D-176)

Scenariusz zaakceptowany przez właściciela 2026-11-19: `docs/modules/modul-1-zabawa-w-phishing-webinar.md` (przebieg nagrania cudzego
kursu → nasze bloki, decyzje właściciela). Fabuła, postaci, firmy i domeny są fikcyjne; prawdziwy incydent w gazecie (Charming Kitten,
2020) opisany własnymi słowami. Dawna treść tego modułu („Wyłudzone hasło”: Anna, bank, odprawa) żyje jako moduł podglądu
`packages/content/dev-modules/dev-modul-1` (D-175) - materiał testowy odtwarzacza.

## Metadane

- slug: `wyludzone-haslo` (bez zmian - klucz importu, odznaki modułu 1), tytuł „Zabawa w phishing”, podtytuł bez zmian (D-170)
- schemaVersion 6, `locales: ["pl"]`, tryb pełny (nie prosty: lista cech maila, wpisywanie domeny i tablica wymagają bloków spoza trybu prostego)
- czas ~10 min, `caseNumber: 1`, `startNotice` bez zmian (D-171)
- okładki start/koniec (poziomo i pionowo), miniatura, sceny biura i gazety, portret Pawła - Dreamina (Seedream 4.7), WebP w
  `assets/images/`; znak wodny darmowego konta wycięty kadrem (decyzja właściciela, D-173); źródła PNG i skrypty konwersji poza repo
- pulpit z grą (easter egg odznaki „Ciekawski detektyw”, wyróżnienie `ciekawski-detektyw`) - osobny blok `pulpit` (D-179), grafika
  `images/pulpit.webp` złożona z monitora odtwarzacza i ekranu `assets/scenes/pulpit-ekran.svg` (kompozytor)
- lektor: rola `narrator` (jak dotąd), narracja każdego bloku; kwestie Pawła w rozmowie bez nagrań (tekst)

## Postaci

| Postać | Rola |
|---|---|
| Paweł Nowicki | analityk danych w Unfooly Sp. z o.o., ofiara ataku (bohater z brandkitu) |
| „Katarzyna Zielińska” | fałszywa koordynatorka „Fundacji Analityki Stosowanej” (`k.zielinska@fundacja-analityki.pl`) |
| Gracz | detektyw prowadzący dochodzenie |

Domeny `fundacja-analityki.pl` i `formularz-online.net` sprawdzone 2026-11-19 - nie istnieją (test treści pilnuje, że w module nie ma innych).

## Bloki

| # | id | typ | treść | ocena |
|---|---|---|---|---|
| 1 | `teczka` | TABS | teczka „ŚCIŚLE TAJNE” na biurku detektywa (D-178): Twoje zadanie / Incydent / Ofiara ataku (wszystkie zakładki wymagane); na kartce „Ofiara ataku” zdjęcie Pawła przypięte spinaczem (`photo`, D-191 - ten sam portret co avatar w rozmowie) | – |
| 2 | `biuro-pawla` | SCENE_HOTSPOTS | „zacznij od komputera”: komputer = drzwi do pulpitu; smartfon i Paweł - karty (nieobowiązkowe); wariant pionowy | – |
| 3 | `pulpit` | SCENE_HOTSPOTS | monitor Unfooly z pulpitem: Poczta = drzwi do maila; Internet - tylko zapowiedź, bez strony (zadanie startuje na `pulpit-2`, D-185); gra (okienka bez najazdu kamery, D-184) - easter egg odznaki „Ciekawski detektyw” | – |
| 4 | `zaproszenie` | EMAIL_ANALYSIS | mail na ekranie monitora (`frame: monitor`), bez linków i załączników; 4 cechy, poprawna tylko „niespodziewana, atrakcyjna oferta” (`exact`) | 2 |
| 5 | `biuro-pawla-2` | SCENE_HOTSPOTS | ✓ komputer (`done`); smartfon = drzwi do ekranu telefonu | – |
| 6 | `telefon` | SCENE_HOTSPOTS | ekran główny smartfona na biurku: Komunikator (3 wiadomości) = drzwi do czatu; Poczta, Kalendarz - karty | – |
| 7 | `komunikator` | DOSSIER | czat na ekranie telefonu ze sceny `telefon` (`layout: chat`, `phone`, D-181); dowody: połączenie 12 min 40 s, link „Rejestracja”, prośba o służbowy e-mail i hasło | – |
| 8 | `pulpit-2` | SCENE_HOTSPOTS | ten sam pulpit po komunikatorze (D-185): ✓ Poczta (`done`); Internet = drzwi do zadania z formularzem | – |
| 9 | `domena` | TEXT_INPUT_GUIDED | fałszywa strona logowania „Formularz prelegenta” w oknie przeglądarki na pulpicie Pawła (`page`, `background`, D-184; `frame: monitor`, D-181): w pasku adresu `https://fundacja-analityki.formularz-online.net/prelegenci/48213` gracz klika pierwszy pojedynczy „/”, potem drugą „.” na lewo (`markUrl`), dopiero wtedy wpisuje domenę → `formularz-online.net`; 3 podpowiedzi po złej próbie (ukośnik, druga kropka, poddomena); waga 0 - ćwiczenie prowadzone (D-181) | 0 |
| 10 | `zaufanie` | QUIZ | „Czy link jest godny zaufania?” Tak / Nie → Nie; w tym samym widoku co zadanie z domeną (`frame: monitor`, `markUrl`, `page`, `background` jak w `domena`, D-190): pytanie w pasku zadania nad fałszywą stroną, adres z zaznaczoną domeną, wynik i komentarz (`reactions.result`) na tej samej stronie | 1 |
| 11 | `biuro-pawla-3` | SCENE_HOTSPOTS | ✓ komputer i smartfon; Paweł = drzwi do rozmowy | – |
| 12 | `rozmowa-pawel` | DIALOGUE | na ekranie telefonu z biurka (`phone`, D-184); 4 pytania (3 wymagane): co się stało, czy coś było dziwne, telefon, link | – |
| 13 | `tablica` | ORDERING | tablica z notatkami jak na nagraniu (`look: notes`, D-182): na korkowej tablicy (tło z Dreaminy) trzy ponumerowane kartki z notatkami ze śledztwa; gracz przeciąga etapy „E-mail”, „Rozmowa telefoniczna”, „Link” na właściwe kartki (wpisanie hasła jest w notatkach kartki „Link”) | 2 |
| 14 | `raport` | TABS | „Raport końcowy” w teczce „SPRAWA ZAMKNIĘTA” na biurku: 3 etapy, przy każdym rada | – |
| 15 | `gazeta` | SCENE_HOTSPOTS | „Zanim sobie pójdziesz”: gazeta (ramka na zdjęciu w artykule, D-185) → strona gazety „Kurier Cyfrowy” (`look: newspaper`, D-181) z artykułem o Charming Kitten (2020) - tuż przed ekranem końca | – |
| 16 | `zasady` | SUMMARY | trzy zasady (`lessons`) na ekran końca; zamyka się samo (D-169) | – |

Okna jak na nagraniu (D-178, PR 2): tło modułu `cover.backdrop` (rozmyte biurko), pulpit = monitor odtwarzacza (`scenes/monitor`) z ekranem
z kompozytora (`scripts/content/scenes/examples/wyludzone-haslo/pulpit-ekran.json`), telefon = ekran z kompozytora
(`telefon-pawla.json`, klocek `phoneHomeApps`) na biurku detektywa (Dreamina). Złożenie grafik WebP - skrypt poza repo (sharp), prostokąty
kliknięć przeliczone z `*.hotspots.json` kompozytora.

Treść dosłownie: `module.json` (źródło prawdy); niezmienniki: `packages/content/src/module-1-content.spec.ts`.
