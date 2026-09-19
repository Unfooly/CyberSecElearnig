# Symulacje phishingowe - kampanie i wysyłka

Dokument opisuje moduł `apps/api/src/phishing/`. Rozdziały o śledzeniu kliknięć i wynikach dochodzą w kolejnych
etapach (commity 4 i 5); tu: szablony, transport, kampanie, planowanie i semantyka wysyłki.

## Przepływ kampanii (jednorazowej)

1. `POST /phishing/campaigns` (tylko `ORG_ADMIN`, organizacja `ACTIVE`): nazwa, szablon, grono (wszyscy / działy /
   wskazane osoby), okno wysyłki, potwierdzenie ostrzeżenia z kreatora (`acknowledged: true`).
2. Serwis w jednej transakcji tworzy kampanię z **kopią (snapshotem) szablonu** i wiersze odbiorców. Momenty wysyłki
   są jednostajnie losowe w oknie (`planSendTimes`), a przed przypisaniem odbiorcom **tasowane kryptograficznie**
   (`shuffled`) - kolejność wysyłki nie wynika z kolejności założenia kont. Odbiorcy to **aktywni** pracownicy
   organizacji (zaproszeni, którzy nie ustawili hasła, nie są odbiorcami). Limit: 5000 odbiorców i 10 aktywnych kampanii.
   Tworzenie jest serializowane blokadą doradczą organizacji (limit nie do obejścia równoległymi żądaniami), a
   identyczna kampania (nazwa, szablon, grono, okno) utworzona w ciągu 2 min jest odrzucana (`DUPLICATE_CAMPAIGN`) -
   podwójne kliknięcie nie wyśle drugiego phishingu. Endpoint ma limit 20 żądań/min.
3. Po zatwierdzeniu transakcji do BullMQ trafia jedno **opóźnione zadanie na odbiorcę** (`jobId = phishing-send_<id>`,
   `addBulk` po 500).
4. Worker wywołuje `CampaignSenderService.sendOne`. Zadanie uzgadniające (co 5 min) odtwarza zgubione zadania i domyka
   wiszące zajęcia.
5. `POST /phishing/campaigns/:id/cancel` zatrzymuje kampanię (patrz niżej).

Stany kampanii: `SCHEDULED` -> `RUNNING` (pierwsza zajęta wiadomość) -> `COMPLETED` (nikt nie czeka na wynik) albo
`CANCELLED`.

## Semantyka wysyłki: "co najwyżej raz"

Duplikat maila phishingowego jest gorszy niż brak maila, dlatego wysyłka jednego odbiorcy działa tak:

1. **Zajęcie (atomowe).** Transakcja blokuje wiersz kampanii (`FOR NO KEY UPDATE`), potem `updateMany` z warunkiem
   `claimedAt IS NULL AND sentAt IS NULL AND failedAt IS NULL`, statusem kampanii `SCHEDULED/RUNNING`, oknem oraz
   `scheduledAt <= teraz + 1 min` ustawia `claimedAt` i `tokenHash`. Tylko jeden wykonawca dostaje `count = 1`;
   równoległe i powtórne zadania nic nie wysyłają, a zadanie uruchomione za wcześnie (błędne opóźnienie, ingerencja w
   Redisa) niczego nie wyśle - odbiorcę odtworzy zadanie uzgadniające po terminie. Zajęcie i anulowanie kampanii
   serializuje blokada wiersza kampanii: wygrywa to, co zatwierdzi się pierwsze. Odbiorca musi być nadal `ACTIVE`
   (inaczej `RECIPIENT_REMOVED`). Tuż przed wysyłką status kampanii jest sprawdzany jeszcze raz.
2. **Wysyłka** poza transakcją bazy, przez `PhishingMailTransport` (osobny od poczty transakcyjnej).
3. **Wynik:** `sentAt` (dostawca przyjął wiadomość) albo `failedAt` + `failureCode`. Baza wymusza (CHECK), że wynik jest
   jeden, że `failedAt` idzie z `failureCode` i że wysłana wiadomość była wcześniej zajęta.

### Co jest ponawiane, a co nie

Ponawiamy (maks. 3 próby, backoff BullMQ 60 s) **wyłącznie błędy, przy których wiadomo, że wysyłka nie nastąpiła**:
błąd połączenia przed wysłaniem (DNS, odmowa połączenia, TLS, uwierzytelnienie, SMTP `ECONNECTION` tylko w fazie
łączenia: komendy CONN/EHLO/STARTTLS/AUTH) oraz HTTP 429 (limit - dostawca odrzucił żądanie). Wtedy zajęcie jest
zwalniane, a błąd oddawany BullMQ.

**Timeout NIE jest ponawiany.** Dostawca mógł już przyjąć wiadomość, więc odbiorca dostaje `failedAt` z kodem
`TIMEOUT_UNKNOWN`. To samo dotyczy zerwanego połączenia po wysłaniu (w tym SMTP `ECONNECTION` po DATA) i
nieoczekiwanych błędów (`RESULT_UNKNOWN`), zajęcia bez wyniku po awarii procesu (`INTERRUPTED_UNKNOWN`, domykane przez
zadanie uzgadniające po 10 min) oraz **każdej odpowiedzi HTTP 5xx** dostawcy (`HTTP_5xx`): bramka mogła zwrócić 502/504
po przekazaniu wiadomości, więc 5xx nie dowodzi, że nic nie wyszło.

W szczegółach kampanii takie wpisy są liczone osobno jako **niepewne** (`counts.uncertain`; w `failures` z flagą
`uncertain: true`). Pozostałe nieudane (odrzucony adres `HTTP_422`, `CANCELLED`, `WINDOW_EXPIRED`, `RECIPIENT_REMOVED`,
`COMPOSE_FAILED`) to pewne porażki - nic nie wyszło. Kody nie zawierają danych osobowych.

Konsekwencja dla wyników: "niepewne" mogły dostać wiadomość, ale nie mamy tokenu potwierdzonego wysyłką - w
raportach traktujemy je osobno, nie jako wysłane.

## Koniec okna i anulowanie

- Zadanie może ruszyć do 15 min po końcu okna (opóźnienie workera); później odbiorca dostaje `WINDOW_EXPIRED` i nie
  dostaje maila.
- Anulowanie: kampania -> `CANCELLED`, niezajęci odbiorcy -> `failedAt = CANCELLED`, zadania usuwane z kolejki.
  Wiadomość zajęta PRZED zatwierdzeniem anulowania dokończy się (nie da się jej cofnąć); zajęcie po anulowaniu jest
  niemożliwe (blokada wiersza kampanii + warunek statusu), a sprawdzenie tuż przed wysyłką zatrzymuje także wiadomości
  zajęte tuż przed anulowaniem, jeśli jeszcze nie wyszły.
- Usunięcie pracownika: wiersz wyniku zostaje (`userId` zerowane, nazwa działu to snapshot). Adresu e-mail w wynikach
  nie kopiujemy - wysyłka czyta go z konta w chwili wysyłki (usunięty pracownik: `RECIPIENT_REMOVED`).

## Zadanie uzgadniające (`phishing-campaign-reconcile`, co 5 min, UTC)

Siatka bezpieczeństwa, gdy Redis został wyczyszczony albo był niedostępny przy starcie kampanii:

- odbiorca po terminie (> 2 min) bez zajęcia dostaje zadanie; dodanie jest deduplikowane po `jobId`, ale
  zakończone/nieudane zadanie tego odbiorcy (BullMQ je przechowuje) jest przed dodaniem usuwane (`replaceFinished`),
  inaczej dedup po cichu blokowałby odtworzenie,
- zajęcie bez wyniku starsze niż 10 min -> `INTERRUPTED_UNKNOWN` (bez ponawiania),
- po końcu okna + 15 min niewysłani -> `WINDOW_EXPIRED`,
- kampania bez oczekujących -> `COMPLETED`,
- kampanie anulowane w ostatnich 7 dniach: wiszący odbiorcy (zwolnione claimy po ponowieniu) -> `CANCELLED`, stare
  zajęcia -> `INTERRUPTED_UNKNOWN` (licznik "oczekuje" schodzi do zera).

Lista kampanii do uzgodnienia (wszystkich organizacji, stronami po id) to jedyne zapytanie międzyorganizacyjne: bypass RLS
w polityce SELECT `phishing_campaigns`, wyłącznie przez `TenantPrismaService.listCampaignsToReconcile` (wynik to tylko id i
organizationId). Wynik uzgadniania danej kampanii zapisuje się już w kontekście jej organizacji.

## Znane ograniczenia i backlog (świadomie poza tym commitem)

- **Adresy odbiorców a domeny organizacji:** zaproszenia nie ograniczają domeny e-maila do zweryfikowanych domen
  organizacji, a wysyłka symulacji idzie z naszej domeny nadawcy. Rozważyć wymaganie zgodności domeny odbiorcy z
  zweryfikowaną domeną organizacji (decyzja produktowa).
- **Limit dobowy wysyłki na organizację:** dziś ograniczają tylko 5000 odbiorców i 10 aktywnych kampanii.
- Redis musi być chroniony (hasło, sieć wewnętrzna): kolejka steruje wysyłką, a zadania niosą tylko identyfikatory.

Bez działającego Redisa/workera (`BACKGROUND_JOBS_ENABLED=false`) kampanie nie wysyłają - status API pokazuje
konfigurację transportu (`GET /phishing/config`), ale nie stan kolejki.

## Transport i konfiguracja

Patrz `docs/deploy-test.md` sekcja 9 (warunki blokujące startu: domena nadawcy z SPF/DKIM/DMARC, własny token,
osobna domena strony lądowania) oraz `.env.example`. Wysyłka symulacji nigdy nie idzie przez `EmailService`;
pilnuje tego `transport-separation.spec.ts`.

## Testowanie

- `send-planner.spec.ts`: rozkład i granice planera z wstrzykiwanym generatorem (bez czekania).
- `test/phishing-campaigns.e2e-spec.ts`: API, `sendOne` (w tym równoległe wywołania, ponowienia, timeout, koniec okna,
  usunięty pracownik), `reconcile`, izolacja organizacji A/B, RLS i ograniczenia w bazie. Kolejka i transport to atrapy.
- `test/phishing-campaigns-queue.e2e-spec.ts`: jeden test z prawdziwym BullMQ/Redisem (własny `JOBS_QUEUE_PREFIX`,
  opóźnienie ~300 ms, deduplikacja, usuwanie zadań).
