# Checklista: co musi obejmować polityka prywatności i regulamin

Dokument roboczy dla prawnika / inspektora ochrony danych (IOD). Wynika z tego, **co platforma faktycznie
przetwarza** (stan kodu po serii „Organizacja 1-6/7”), a nie z wzoru - każdą pozycję trzeba potwierdzić, uzupełnić
danymi administratora i odzwierciedlić w finalnym tekście. Nie jest poradą prawną.

Warunek startu publicznego (patrz `docs/deploy-test.md`, sekcja 9): strony `/regulamin`, `/polityka-prywatnosci`
i `/bezpieczenstwo` nie mogą mieć placeholderów `[DO UZUPEŁNIENIA]` ani `noindex`, a `LEGAL_DOCUMENT_VERSION`
(`packages/shared`) musi wskazywać finalną wersję.

## 1. Role stron (kluczowa decyzja do rozstrzygnięcia)

- [ ] **Kto jest administratorem, a kto podmiotem przetwarzającym.** Zwykle: dane pracowników klienta (postępy w
  szkoleniach, wyniki symulacji phishingowych) - klient jest administratorem, my podmiotem przetwarzającym
  (**umowa powierzenia, art. 28 RODO**, jako część regulaminu lub osobny załącznik); dane administratora konta i
  dane do faktury - my jesteśmy administratorem. Polityka i regulamin muszą to rozdzielać.
- [ ] Dane kontaktowe administratora, IOD (jeśli powołany), adres do żądań osób.

## 2. Jakie dane osobowe i firmowe przetwarzamy

| Kategoria | Skąd w kodzie | Uwagi do polityki |
|---|---|---|
| Imię, nazwisko, służbowy e-mail administratora | `users`, formularz rejestracji | rola: nasz administrator danych |
| Dane firmy do faktury: pełna nazwa, NIP, ulica, kod, miasto, kraj (PL) | `organization_billing_details` (RLS) | dane firmowe; przy jednoosobowej działalności mogą być danymi osobowymi |
| Domena firmowa i token weryfikacji DNS | `organization_domains` | token jest publiczny (trafia do DNS) - to nie sekret |
| Zgody: typ dokumentu, **wersja**, znacznik czasu, użytkownik | `legal_acceptances` | dowód zgody; wersja musi wskazywać realny tekst |
| Dane pracowników: e-mail, imię, nazwisko, dział, rola, status | `users`, `departments` | rola: podmiot przetwarzający |
| Postępy w kursach, wyniki, odznaki, awatary, ranking | `course_assignments`, `user_badges`, leaderboard | ranking widoczny dla organizacji - uwzględnić w informacji dla pracowników |
| Wyniki symulacji phishingowych: wysłano / kliknięto / wysłano formularz (znaczniki czasu per odbiorca), dział jako snapshot, hash tokenu z linku; **wartości wpisane w formularzu strony lądowania NIE są zapisywane ani logowane**; brak pikseli otwarcia | `phishing_campaign_recipients` (moduł kampanii; wyniki per osoba domyślnie niewidoczne - patrz commit 5) | **wymaga osobnej oceny** (monitorowanie pracowników, kodeks pracy, konsultacje ze związkami, DPIA). Adres IP odwiedzającego stronę lądowania nie jest zapisywany w wynikach (tylko krótkotrwały licznik limitu żądań w pamięci) |
| Kopia e-maila autora kampanii (`phishing_campaigns.createdByEmail`) i aktora zmian szablonów | `phishing_campaigns`, `phishing_template_edits` | przeżywa usunięcie konta (dowód rozliczalności) - okres przechowywania |
| **Zgłoszenia podejrzanych wiadomości** (pracownik zgłasza e-mail): nadawca, jego domena i temat (tekst wpisany przez pracownika), **wklejona treść, nagłówki i komentarz** (tylko zgłoszenia prawdziwe), zgłaszający i jego dział (snapshot), status, dopasowanie do symulacji; dla symulacji dodatkowo znacznik `reportedAt` odbiorcy kampanii | `threat_reports` (RLS), `phishing_campaign_recipients.reportedAt` | **treść może zawierać dane osobowe osób trzecich** (nadawca, dane w treści maila, czasem dane pracownika) - pracownika trzeba poinformować, że zgłoszenie widzą osoby odpowiedzialne za bezpieczeństwo w firmie; linki śledzące `/t/<token>` są maskowane przy zapisie; **zgłoszenie dopasowane do symulacji NIE zapisuje treści, nagłówków ani komentarza** (CHECK w bazie) - zostaje temat, nadawca i powiązanie z odbiorcą kampanii |
| **Import pracowników z CSV (podgląd)**: adres e-mail, imię, nazwisko i nazwa działu każdego wiersza pliku, wynik walidacji (powód błędu), nazwa pliku, autor partii (kopia e-maila) | `user_import_batches`, `user_import_rows` (RLS) | dane pracowników wgrane przez administratora klienta (rola: podmiot przetwarzający); **przechowywane maksymalnie ok. 25 h** (podgląd ważny 24 h, job `user-import-retention` co godzinę kasuje partię z wierszami), jedna aktywna partia na organizację; anulowanie kasuje od razu; kopia e-maila autora przeżywa usunięcie jego konta (do usunięcia organizacji); adresów z innych organizacji celowo nie sprawdzamy (brak enumeracji kont) |
| Przypisanie kursu uzupełniającego po kliknięciu w symulację | `course_assignments` | pracownik dostaje kurs szkoleniowy; uwzględnić w informacji dla pracowników |
| Tokeny (reset hasła, weryfikacja e-mail) - tylko hashe | `password_reset_tokens`, `email_verification_tokens` | krótki okres życia |
| Hasła - tylko hashe bcrypt | `users.passwordHash` | brak haseł w logach |
| Dane techniczne: adres IP, logi żądań, ciasteczka sesyjne (`access_token`, `refresh_token`, httpOnly) | API, BFF (`apps/web`) | ciasteczka niezbędne - informacja, bez banera zgody; ocenić, czy dodajemy analitykę |
| Treść wiadomości wysyłanych przez MailerSend | `apps/api/src/email` | odbiorca danych (patrz pkt 4) |

## 3. Cele i podstawy prawne (art. 6 RODO)

- [ ] Założenie i obsługa konta organizacji, świadczenie usługi - wykonanie umowy (6.1.b).
- [ ] Fakturowanie, księgowość - obowiązek prawny (6.1.c).
- [ ] Bezpieczeństwo (limity żądań, logi, weryfikacja domeny, ochrona przed nadużyciami) - prawnie uzasadniony interes (6.1.f).
- [ ] Zgody na regulamin i zapoznanie z polityką - to **potwierdzenia**, nie zgoda w rozumieniu art. 6.1.a; ustalić
  wprost, na czym opieramy przetwarzanie, żeby nie wprowadzać w błąd.
- [ ] Marketing/„Umów demo” (`demo_requests`) - osobny cel i podstawa; sprawdzić, jakie dane zbiera formularz
  i jak długo je trzymamy.

## 4. Odbiorcy i transfery

- [ ] Hosting (AWS eu-central-1 planowany, obecnie VPS) - dostawca infrastruktury, umowa powierzenia, lokalizacja UE.
- [ ] **MailerSend** (wysyłka e-maili transakcyjnych i kampanii) - podmiot przetwarzający; sprawdzić lokalizację
  przetwarzania i transfer poza EOG (SCC).
- [ ] **Cloudflare** (Tunnel, TLS, ruch przechodzi przez ich sieć) - podmiot przetwarzający, transfer poza EOG.
- [ ] **GitHub/GHCR** - tylko obrazy i kod; potwierdzić, że nie trafiają tam dane osobowe.
- [ ] **Stripe** (planowane: fakturowanie z danych firmy) - osobny administrator/podmiot przetwarzający, dopisać
  przy uruchomieniu płatności.
- [ ] SSO Microsoft (planowane) - dopisać przy wdrożeniu.

## 5. Okresy przechowywania

- [ ] **Organizacje bez zweryfikowanej domeny: usuwane po 14 dniach od rejestracji** (ostrzeżenie mailem po 7 dniach;
  job `pending-organization-cleanup`, kaskadowo z użytkownikami, danymi do faktury i zgodami) - wpisać wprost.
- [ ] Konta aktywne: przez czas umowy + okres wygaśnięcia; co po wypowiedzeniu (eksport, usunięcie, termin).
- [ ] Dane do faktury/księgowe - zgodnie z przepisami (zwykle 5 lat od końca roku podatkowego).
- [ ] Logi i backupy - okres i mechanizm usuwania; jak backupy mają się do żądania usunięcia.
- [ ] Zgody (`legal_acceptances`) - jak długo jako dowód, mimo usunięcia konta.
- [ ] **Zgłoszenia podejrzanych wiadomości** (`threat_reports`) - decyzja właściciela produktu (2026-09-20), dwa przypadki:
  (1) zgłoszenie **dopasowane do symulacji**: treść, nagłówki i komentarz **nie są zapisywane w ogóle** (usuwane w chwili
  dopasowania, egzekwuje to CHECK w bazie); zostają temat, nadawca i powiązanie z odbiorcą kampanii - do usunięcia organizacji
  (statystyki wyników); (2) zgłoszenie **prawdziwe**: treść, nagłówki, komentarz, **a także nadawca i temat usuwane po 90 dniach** (job
  `threat-report-retention`, codziennie 03:30 UTC; zostaje wyłącznie **domena nadawcy** - statystyki „najczęstsze domeny” - oraz
  status, daty, zgłaszający i dział; decyzja właściciela produktu 2026-09-20, bo pracownik może wpisać dane osobowe także w
  polach nadawcy i tematu); po usunięciu konta zgłaszającego `reporterUserId` jest zerowany. Wpisać oba okresy w polityce prywatności.
- [ ] **Audyty modułu symulacji phishingowych** (`phishing_template_edits`, później `phishing_result_visibility_audit`):
  zawierają **kopię adresu e-mail aktora** (kto zmienił szablon / włączył widok osobowy), która **przeżywa usunięcie
  konta pracownika** (`actorUserId` jest zerowany, e-mail zostaje) - do czasu usunięcia organizacji. Zdecydować:
  podstawę (rozliczalność / uzasadniony interes), okres retencji i czy maskować e-mail po usunięciu konta; opisać w
  polityce i w DPIA modułu (patrz sekcja 8).

## 6. Prawa osób i ich realizacja

- [ ] Dostęp, sprostowanie, usunięcie, ograniczenie, przenoszenie, sprzeciw; skarga do PUODO.
- [ ] **Proces techniczny:** kto (administrator klienta czy my) realizuje żądanie pracownika; jak wyeksportować/usunąć
  dane użytkownika i organizacji (dziś usuwanie organizacji jest kaskadowe, brak self-service dla pojedynczej osoby).
- [ ] Czas odpowiedzi (1 miesiąc) i kanał kontaktu.

## 7. Bezpieczeństwo (spójne ze stroną `/bezpieczenstwo`)

- [ ] Izolacja danych klientów: filtr po `organizationId` w każdym zapytaniu + Row-Level Security w bazie (FORCE).
- [ ] Hasła hashowane (bcrypt), tokeny jednorazowe w postaci hashy, sesje w ciasteczkach httpOnly, ochrona CSRF (Origin).
- [ ] Weryfikacja własności domeny rekordem DNS przed odblokowaniem organizacji.
- [ ] Ochrona przed enumeracją kont (identyczne odpowiedzi rejestracji), limity żądań.
- [ ] Polityka zgłaszania incydentów: termin 72 h dla organu, informowanie klientów (jako podmiot przetwarzający -
  bez zbędnej zwłoki), kontakt do zgłoszeń podatności.
- [ ] Nie obiecywać w treści niczego, czego kod nie robi (np. SSO, szyfrowanie na poziomie pól, certyfikaty ISO).

## 8. Szczególne ryzyka tego produktu

- [ ] **Symulacje phishingowe** wobec pracowników: podstawa i zakres monitorowania, informowanie pracowników,
  zakaz wykorzystywania wyników do sankcji (jeśli tak zdecydujemy), DPIA - **przed** uruchomieniem modułu kampanii.
- [ ] **DPIA - wyniki osobowe symulacji (kto kliknął)**: to monitorowanie zachowania pracowników (kodeks pracy, konsultacje ze
  związkami/przedstawicielami, cel i proporcjonalność, informacja dla pracowników, zakaz wykorzystania do sankcji - decyzja
  klienta). Środki w produkcie: (1) domyślnie WYŁĄCZONE - wyniki tylko zagregowane per dział, próg minimalnej liczebności 3 osób z
  łączeniem małych grup (brak identyfikacji w działach 1-2 osobowych); (2) włączenie wyłącznie przez administratora organizacji z
  pisemnym uzasadnieniem (min. 20 znaków, CHECK w bazie); (3) dziennik dostępu append-only: włączenie/wyłączenie, każdy wgląd i
  eksport (kto, kiedy, którą kampanię, jaki zakres, ile osób), kopia e-maila aktora przeżywa usunięcie konta; (4) kierownik
  działu widzi wyłącznie agregaty własnego działu (bez metadanych pozostałych kampanii organizacji), nigdy danych osobowych;
  **ryzyko rezydualne ZAAKCEPTOWANE decyzją właściciela produktu (2026-09-20), do wpisania w DPIA:** administrator, który sam
  dobiera odbiorców kampanii, może przez porównanie wyników kampanii różniących się o małą grupę wyliczyć wynik grupy poniżej
  progu (patrz `docs/phishing-simulations.md`, "Znane, nieusunięte ograniczenie") - dotyczy roli, która i tak ma audytowaną
  ścieżkę do danych osobowych; próg 3 bez zmian; w backlogu alert audytowy, gdy kampanie w 7 dni różnią się o mniej niż 3 osoby; (5) wyniki per osoba nie są kopiowane do eksportu dashboardu; (6) wartości
  wpisane w formularzu strony lądowania nie są zapisywane ani logowane. Do rozstrzygnięcia: okres przechowywania wyników i dziennika
  (dziś: do usunięcia organizacji), rola podmiotu przetwarzającego.
- [ ] **Skrzynka zgłoszeń, notatki i powiadomienia** (commit 3/5): (1) zgłaszający jest widoczny dla `ORG_ADMIN` wyłącznie w szczegółach zgłoszenia (potrzebne do odpowiedzi
  pracownikowi; każdy wgląd audytowany), nie na liście; kierownik działu widzi listę własnego działu wyłącznie jako **datę, status, samą DOMENĘ nadawcy i informację, czy zgłoszenie było
  powiązane z symulacją** - **bez tematu i pełnego nadawcy** (dane osób trzecich; decyzja właściciela produktu 2026-09-20: kierownik nie
  obsługuje zgłoszeń), bez zgłaszającego, treści i notatek; z opóźnieniem godziny i tylko dla działów z >= 3 innymi osobami niż on sam
  (mniej: bez listy); pełny adres nadawcy i temat widzi wyłącznie `ORG_ADMIN`;
  (2) dziennik zdarzeń zgłoszenia (`threat_report_events`) zawiera **kopię e-maila admina** (autor zmiany statusu/notatki), która
  przeżywa usunięcie jego konta - do czasu usunięcia organizacji (jak audyty modułu, patrz sekcja 5); **treść notatek jest czyszczona po
  90 dniach** razem z treścią zgłoszenia; (3) powiadomienia mailowe do adminów (zbiorczo, max 1 / 15 min) **nie zawierają treści zgłoszeń ani
  danych zgłaszających**, tylko liczbę i link - mail idzie przez dostawcę poczty transakcyjnej (MailerSend); (4) **każdy wgląd ORG_ADMIN w szczegóły zgłoszenia jest
  audytowany** (`threat_report_views`: kto, kiedy, które zgłoszenie - jak wgląd w wyniki osobowe; kopia e-maila admina przeżywa usunięcie
  konta do czasu usunięcia organizacji, patrz sekcja 5); (5) agregaty wyników są odświeżane co godzinę (migawka w Redisie: same liczby per dział, bez
  danych osobowych) - ograniczenie kanału różnicowania w czasie.
- [ ] **Zgłaszanie podejrzanych wiadomości**: cel (bezpieczeństwo organizacji, uzasadniony interes / wykonanie umowy), zakres
  (patrz sekcja 2 i 5), dostęp (skrzynka zgłoszeń: ORG_ADMIN; kierownik działu - ograniczony widok bez tożsamości zgłaszającego
  i bez treści; wprowadzane w kolejnych commitach modułu - zaktualizować ten wpis przy wdrożeniu panelu), zakaz wykorzystywania
  zgłoszeń do oceny pracownika. Zgłoszenie po kliknięciu w symulację (`reportedAt` po `clickedAt`) trafia do statystyk
  zbiorczych (te same grupy i próg 3 co kliknięcia; KPI „zgłaszalność”); wynik osobowy (kto zgłosił, kto po kliknięciu) podlega
  tym samym zasadom co pozostałe wyniki osobowe (flaga, audyt, tylko ORG_ADMIN). Nowy kanał różnicowania w czasie (zgłoszenia
  napływają po kampanii) - opisany w `docs/phishing-simulations.md`, do wpisu w DPIA razem z K1. Dopasowanie do symulacji
  jest heurystyczne (token w treści albo dokładny nadawca i temat) - opisać w informacji dla pracowników, że zgłoszenie
  ćwiczebnej wiadomości nie trafia do skrzynki zgłoszeń.
- [ ] **Odbiorcy kampanii spoza zweryfikowanej domeny organizacji** (np. kontraktorzy na Gmailu): podstawą jest, że
  odbiorca jest kontem `ACTIVE` (sam aktywował konto linkiem z maila = potwierdził członkostwo w organizacji); wysyłka
  z naszej domeny do osób trzecich jest ryzykiem nadużycia - patrz backlog (alert SUPER_ADMIN >20% odbiorców spoza domeny)
  i `docs/phishing-simulations.md`.
- [ ] **Strona lądowania i śledzenie** (`/t/<token>`): token 256-bitowy w bazie tylko jako hash, ważny 90 dni od zajęcia (chwili wysyłki), jawny w logach dostępowych infrastruktury;
  strona bez cookie, bez marek, `noindex`; kliknięcie zalicza JS strony po 2,5 s lub interakcji (nie samo pobranie
  strony); dobowy limit wysyłek 2 x liczba licencji na organizację. Informacja dla pracowników o samym istnieniu symulacji.
- [ ] **Ranking i odznaki** (grywalizacja) - widoczność wyników dla współpracowników.
- [ ] Wysyłka e-maili phishingowych z osobnej domeny - reputacja, regulamin dostawcy poczty, zgoda klienta na
  symulacje (pkt regulaminu).
- [ ] Dane dzieci/osób poniżej 16 lat - potwierdzić, że usługa jest tylko B2B dla osób dorosłych.

## 9. Regulamin (poza polityką prywatności)

- [ ] Zawarcie umowy przez rejestrację, kto może się rejestrować (osoba umocowana), skutek niezweryfikowania domeny
  (usunięcie po 14 dniach).
- [ ] Plany, licencje, cennik, fakturowanie, wypowiedzenie, odpowiedzialność, SLA, prawo właściwe, zmiany regulaminu.
- [ ] Zasady dopuszczalnego użycia symulacji phishingowych (tylko wobec własnych pracowników, bez szkodliwych treści).

## 10. Powiązanie z kodem (żeby dokumenty nie rozjechały się z produktem)

- [ ] `LEGAL_DOCUMENT_VERSION` w `packages/shared` zmieniana przy każdej zmianie tekstu; nowa wersja = ponowna
  akceptacja (proces do zaprojektowania).
- [ ] Zmiana zakresu przetwarzania (nowy moduł, nowy odbiorca danych, nowe dane w formularzu) = aktualizacja tej
  listy i polityki **przed** wdrożeniem.
