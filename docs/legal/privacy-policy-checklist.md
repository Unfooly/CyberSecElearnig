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
| Wyniki symulacji phishingowych (planowane: kliknięcia, zgłoszenia) | moduł kampanii (nie zbudowany) | **wymaga osobnej oceny** (monitorowanie pracowników, kodeks pracy, konsultacje ze związkami, DPIA) |
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
