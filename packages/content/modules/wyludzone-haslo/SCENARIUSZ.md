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
- pulpit z grą (easter egg odznaki „Ciekawski detektyw”, wyróżnienie `ciekawski-detektyw`) - `assets/scenes/pulpit.svg` z dawnej treści
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
| 1 | `teczka` | TABS | „Nowe zadanie”: Twoje zadanie / Incydent / Ofiara ataku (wszystkie zakładki wymagane) | – |
| 2 | `biuro-pawla` | SCENE_HOTSPOTS | komputer (pulpit: Poczta, Internet, gra-easter egg), smartfon, Paweł; wariant pionowy | – |
| 3 | `zaproszenie` | EMAIL_ANALYSIS | mail z zaproszeniem na prelegenta, bez linków i załączników; 4 cechy, poprawna tylko „niespodziewana, atrakcyjna oferta” (`exact`) | 2 |
| 4 | `komunikator` | DOSSIER | historia czatu; dowody: połączenie 12 min 40 s, link „Rejestracja”, prośba o służbowy e-mail i hasło | – |
| 5 | `domena` | TEXT_INPUT_GUIDED | domena z `https://fundacja-analityki.formularz-online.net/prelegenci/48213` → `formularz-online.net`; 3 podpowiedzi (ukośnik, druga kropka, poddomena) | 2 |
| 6 | `zaufanie` | QUIZ | „Czy link jest godny zaufania?” Tak / Nie → Nie | 1 |
| 7 | `rozmowa-pawel` | DIALOGUE | 4 pytania (3 wymagane): co się stało, czy coś było dziwne, telefon, link | – |
| 8 | `tablica` | ORDERING | e-mail → rozmowa i telefon → link → logowanie; start „P.N.”, koniec „46 maili” | 2 |
| 9 | `raport` | TABS | „Raport końcowy”: 3 etapy, przy każdym rada | – |
| 10 | `gazeta` | SCENE_HOTSPOTS | „Zanim sobie pójdziesz”: gazeta → artykuł o Charming Kitten (2020) - tuż przed ekranem końca | – |
| 11 | `zasady` | SUMMARY | trzy zasady (`lessons`) na ekran końca; zamyka się samo (D-169) | – |

Treść dosłownie: `module.json` (źródło prawdy); niezmienniki: `packages/content/src/module-1-content.spec.ts`.
