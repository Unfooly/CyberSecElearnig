# Moduł 4 „Na skróty” – scenariusz według nagrania „Shadow IT”

Status: **zaakceptowany przez właściciela 2026-11-22**:
1. Zastępuje poprzednią treść modułu 4 (nowa wersja kursu, slug `na-skroty` bez zmian).
2. Postacie: Bartek Lis (marketing), **Adam Kowal z działu IT** (mężczyzna – zmiana właściciela względem szkicu), Tomek, Kasia; program „z internetu” bez nazwy marki.
3. Tryb prosty zostaje.
4. Ilustracja obok tekstu i pytania wchodzi osobnym PR silnika (D-200).

**Wdrożone w D-201.** Źródłem prawdy o blokach jest `packages/content/modules/na-skroty/module.json`.

Ten plik zastępuje `modul-4-na-skroty.md` (scenariusz z 2026-10-23: odprawa, biurko, sytuacje do przesunięcia, dwa wybory).

## Źródło

Nagranie właściciela `shadowit.mp4` (1:07). To moduł cudzego kursu („Niewidzialne zagrożenie: shadow IT”). Jak przy module 1 („Webinar”, D-176) przejmujemy wyłącznie **przebieg i mechaniki**. Teksty, postaci i grafiki są nasze, w stylu Unfooly.

## Przebieg oryginału i nasza wersja

| # | Ekran w nagraniu | Mechanika | Nasz blok |
|---|---|---|---|
| 1 | „Zaczynamy?” | ekran startu | ekran startu modułu (okładka bez zmian) |
| 2 | „To sporo danych…” – pracownica przy biurku | ilustracja + tekst | `tabela` NARRATIVE: Bartek ma do rana przerobić 40 tys. wierszy |
| 3 | Program z internetu „z AI” – instalować? | 1 z 2 + wyjaśnienie | `instalowac` QUIZ: poprawna – „Najpierw zapytać dział IT” |
| 4 | „Shadow IT” – definicja | ilustracja + tekst | `shadow-it` NARRATIVE: definicja zatwierdzona 2026-10-19 + przykłady |
| 5 | „Ryzyko dla organizacji” – 3 karty | klik odsłania kartę | `skutki` SCENE_HOTSPOTS: tablica z 4 kartami z poprzedniej wersji (teksty zatwierdzone 2026-10-19) |
| 6 | „Zagrożenia dla pracowników” | ilustracja + tekst | `pracownik` NARRATIVE: dostęp może zostać zablokowany na czas wyjaśnienia; bez straszenia karami |
| 7 | „Lepiej dmuchać na zimne!” – ekspertka IT, 2 możliwości | ilustracja + tekst | `dwie-drogi` NARRATIVE: Adam z IT – firmowy katalog albo zgłoszenie potrzeby |
| 8 | „Urządzenia osobiste” | ilustracja + tekst | `prywatny-telefon` NARRATIVE: prywatny sprzęt w firmowej sieci to też shadow IT |
| 9 | „Cała naprzód!” | ilustracja + tekst | `cala-naprzod` NARRATIVE: Adam daje zatwierdzone narzędzie |
| 10 | „Czas na quiz!” | przerywnik | `czas-na-quiz` NARRATIVE |
| 11 | Edmund zainstalował program – zagrożenia? | wielokrotny wybór (wszystkie poprawne) | `bez-sprawdzenia` QUIZ `multiple`: Tomek; 3 dobre + 1 zła (reguła trybu prostego: co najmniej jedna zła odpowiedź) |
| 12 | Prywatny smartfon i służbowa poczta | 1 z 2 | `poczta-na-telefonie` QUIZ: Kasia |
| 13 | Chmura do pracy z domu | 1 z 3 | `pliki-w-chmurze` QUIZ: Kasia |
| 14 | „Idealnie!” | koniec | `raport` SUMMARY (trzy zasady bez zmian) + ekran końca z okienkiem nagrody (D-199) |

## Grafiki

Dreamina, Seedream 4.7 i2i z referencjami stylu marki. Wybór właściciela 2026-11-22: karty postaci Adam v2 i Tomek v1. Kasia to koleżanka z brandkitu, Bartek – bohater z brandkitu (jak na okładkach modułu 4).

Gotowych jest 11 ilustracji (`assets/images/*.webp`, znak wodny wycięty).

Przy kilku ilustracjach model dorysowywał tekst, logo Apple albo dodatkową postać. Wygenerowano je ponownie, a w jednym przypadku logo zamalowano.

Tablica skutków, raport i okładki – bez zmian (poprzednia wersja).

## Lektor – do nagrania później

Decyzja właściciela 2026-11-22: na razie bez lektora. ElevenLabs na darmowym planie nie pozwala używać głosu „komisarz” z biblioteki.

Nowe ekrany nie mają `narration`. Nagrania tablicy i raportu zostają. Teksty do nagrania (głos `komisarz`):

- `tabela`: Bartek z marketingu ma do rana przygotować analizę kampanii: czterdzieści tysięcy wierszy danych. Sam nie zdąży, więc szuka w internecie czegoś, co zrobi to za niego.
- `instalowac`: Bartek znalazł darmowy program, który dzięki sztucznej inteligencji ma zrobić analizę jednym kliknięciem. Ma świetne opinie. Co powinien zrobić?
- `shadow-it`: Shadow IT to każde narzędzie, którego używasz do pracy, a którego firma nie sprawdziła i nie zatwierdziła: program, aplikacja, czat AI, prywatna chmura albo pendrive. Nawet jeśli pomaga szybciej skończyć pracę, może być niebezpieczne. Dlatego zanim zaczniesz z niego korzystać, zapytaj dział IT.
- `pracownik`: Shadow IT to ryzyko nie tylko dla firmy. Jeśli przez niesprawdzony program dojdzie do incydentu, firma może na czas wyjaśnienia sprawy zablokować dostęp do części systemów. Dlatego lepiej zapytać wcześniej. IT woli pomóc na początku niż sprzątać na końcu.
- `dwie-drogi`: Bartek pisze do Adama z działu IT. Adam pokazuje mu dwie drogi. Pierwsza: sprawdź, czy firma ma już takie narzędzie. W firmowym katalogu są programy sprawdzone przez IT. Druga: jeśli go nie ma, zgłoś potrzebę do IT i napisz, do czego ma służyć. IT sprawdzi nowe narzędzie i powie, czy możesz z niego korzystać.
- `prywatny-telefon`: To samo dotyczy sprzętu. Prywatny telefon, laptop czy pendrive w firmowej sieci albo ze służbową pocztą to też shadow IT, jeśli firma na to nie pozwala. Sprawdź firmowe zasady, a w razie wątpliwości zapytaj IT.
- `cala-naprzod`: Adam znalazł w firmowym katalogu program do analizy danych, sprawdzony przez IT. Bartek skończył raport na czas, a dane klientów zostały w firmie.
- `czas-na-quiz`: Sprawdź, czy rozpoznasz shadow IT w codziennej pracy. Przed Tobą kilka sytuacji z biura.
- `bez-sprawdzenia`: Tomek ze sprzedaży zainstalował nowy program, nie pytając nikogo. Co może się stać? Zaznacz wszystkie poprawne odpowiedzi.
- `poczta-na-telefonie`: Kasia z księgowości czyta służbową pocztę na prywatnym telefonie, choć IT na to nie pozwoliło. Czym to grozi?
- `pliki-w-chmurze`: Kasia chciałaby pracować z domu i trzymać służbowe pliki w prywatnej chmurze. Co powinna zrobić?
