# Kopia zapasowa bazy - runbook (B-117, D-136)

Codzienny zrzut bazy produkcyjnej (`postgres_data`) do prywatnego bucketu poza VPS, zaszyfrowany kluczem, którego nie ma na serwerze.
Awaria dysku, `down -v`, `volume prune` albo zła migracja przestają oznaczać utratę danych klientów - tracimy najwyżej dobę.

## Jak to działa

| element | co robi |
|---|---|
| `docker/postgres-init/02-create-backup-role.sh` | rola `cyberszkolo_backup`: tylko odczyt (`pg_read_all_data`), `BYPASSRLS` (kopia obejmuje wszystkie organizacje - wyjątek od Zasady nr 1, CLAUDE.md), bez superusera, **bez hasła** (logowanie tylko gniazdem w kontenerze przez `docker compose exec`; przez sieć scram bez hasła jest odrzucany) |
| `scripts/ops/db-backup.sh` | kontrola miejsca → `pg_dump` tą rolą → kontrola zrzutu (`pg_restore --list`, dane `organizations`) → szyfrowanie `age` kluczem **publicznym** → usunięcie zrzutu → wysyłka do bucketu (`curl --aws-sigv4`) → ping alarmu; błąd (także konfiguracji) → ping `/fail` |
| `scripts/ops/db-restore-check.sh` | na komputerze z kluczem prywatnym: pobranie (token tylko do odczytu), odszyfrowanie **strumieniem** do `pg_restore` w jednorazowym kontenerze (dane w RAM - `--tmpfs`, bez sieci, bez portów, usuwany z wolumenami), liczba wierszy w tabelach |
| `scripts/ops/db-backup.test.mjs` | test w CI: rola tylko do odczytu, szyfrowanie przed wysyłką, sekrety poza logami/argumentami/środowiskiem, alarm obowiązkowy, próba odtworzenia bez śladów i bez produkcji, ten sam obraz postgres co produkcja |
| bucket (R2) | prywatny, **jurysdykcja UE**, **inny** niż bucket treści; cykl życia: usuwanie `db/` po 14 dniach; **blokada obiektów** `db/` na 13 dni (krótsza od cyklu życia - zablokowanego obiektu cykl życia nie usunie, a kasuje z opóźnieniem; razem najpóźniej 14 dni) |

Dlaczego blokada obiektów: token zapisu R2 („Object Read & Write”) umie też kasować i nadpisywać - R2 nie ma uprawnienia „tylko zapis”.
Ktoś, kto przejmie VPS, nie odczyta kopii (nie ma klucza prywatnego), ale bez blokady mógłby je skasować przed zniszczeniem bazy. Blokada
(Bucket Lock) uniemożliwia skasowanie i nadpisanie obiektu przed upływem 13 dni - także temu tokenowi.

## Klucz prywatny (właściciel)

- Klucz prywatny `age` **zaszyfrowany hasłem** (niżej, krok 1); jawny plik klucza nie leży na żadnym dysku poza chwilą próby odtworzenia.
- **Dwie kopie:** menedżer haseł właściciela i **druga kopia u wskazanej zaufanej osoby albo w sejfie firmowym** (decyzja właściciela
  2026-10-11) - żeby bazę dało się odtworzyć, gdy właściciel jest niedostępny. Hasło klucza przekazane osobno od pliku. Kto ma drugą kopię -
  zapisane poza repo (np. w dokumentacji ciągłości działania firmy).
- Utrata obu kopii klucza = wszystkie kopie bezużyteczne. Przejęcie VPS nie daje odczytu kopii.

**Rotacja klucza** (raz w roku albo po podejrzeniu wycieku): nowa para (krok 1), nowy `BACKUP_AGE_RECIPIENT` w `.env.backup` na VPS,
pierwsza kopia ręcznie i próba odtworzenia nowym kluczem; stary klucz prywatny trzymaj jeszcze **14 dni** (do wygaśnięcia kopii nim
zaszyfrowanych), potem usuń obie jego kopie.

**Rotacja tokenów R2** (raz w roku): nowy token w Cloudflare, podmiana w `.env.backup`, ręczna kopia (krok 7), unieważnienie starego.

**Przejęcie VPS (podejrzenie):** natychmiast unieważnij token zapisu R2 kopii (Cloudflare → R2 → API tokens); kopie w buckecie są chronione
blokadą i szyfrowaniem. Nowy token dopiero na odbudowanym serwerze.

## Wdrożenie (jednorazowo - ręcznie, nie robi tego żaden skrypt)

1. **Klucze age (komputer właściciela):**

   ```bash
   age-keygen | age --passphrase --armor > unfooly-backup.agekey.age   # klucz prywatny od razu zaszyfrowany hasłem
   age --decrypt unfooly-backup.agekey.age | age-keygen -y              # wypisuje klucz publiczny age1... (BACKUP_AGE_RECIPIENT)
   ```

   Plik `unfooly-backup.agekey.age` + hasło: menedżer haseł i druga kopia (sekcja wyżej). Nigdy na VPS. `age -d -i` czyta taki
   zaszyfrowany plik klucza i pyta o hasło.
2. **Bucket R2:** nowy, prywatny bucket (np. `unfooly-db-backup`) z **Jurisdiction: European Union** (sama „location hint” EEUR nie
   gwarantuje przechowywania w UE). Endpoint takiego bucketu: `https://<account-id>.eu.r2.cloudflarestorage.com`. Reguły bucketu:
   cykl życia - prefiks `db/`, usuwanie po 14 dniach; **Bucket Lock** - prefiks `db/`, 13 dni. Dwa tokeny API R2 ograniczone do tego
   bucketu: **Object Read & Write** (VPS, wysyłka) i **Object Read** (odtworzenie).
3. **Alarm (obowiązkowy - bez niego skrypt nie wystartuje):** sprawdzenie w usłudze typu healthchecks.io (okres 1 dzień, tolerancja 2 h,
   powiadomienie e-mailem) - adres pingu to `BACKUP_HEALTHCHECK_URL`. Alarm przychodzi po błędzie (`/fail`, także gdy brakuje konfiguracji)
   i gdy pingu nie ma wcale (padnięty cron, wyłączony serwer, brak pliku `.env.backup`).
4. **VPS - narzędzia:** `sudo apt install age` (curl 8.0+ - Ubuntu 24.04 ma 8.5; skrypt to sprawdza).
5. **VPS - konfiguracja:** w katalogu repo `cp .env.backup.example .env.backup && chmod 600 .env.backup`, uzupełnij sekcję „wysyłka”.
6. **VPS - rola w istniejącej bazie** (nowe wolumeny dostają ją same przy inicjalizacji):

   ```bash
   git pull
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres sh /docker-entrypoint-initdb.d/02-create-backup-role.sh
   ```

7. **Pierwsza kopia ręcznie:** `bash scripts/ops/db-backup.sh` → `OK: db/cyberszkolo-<czas>.dump.age`; w usłudze alarmowej pojawia się ping.
8. **Cron** (crontab użytkownika z dostępem do dockera, codziennie 2:15 UTC niezależnie od strefy serwera, wynik do dziennika):

   ```
   CRON_TZ=UTC
   15 2 * * * cd /home/<użytkownik>/unfooly && bash scripts/ops/db-backup.sh 2>&1 | logger -t db-backup
   ```

9. **Próba odtworzenia** (niżej) na pierwszej kopii z crona - dopiero wtedy kopia jest „sprawdzona”.

## Próba odtworzenia (co miesiąc i po każdej zmianie skryptów)

Na komputerze właściciela (Linux, macOS, WSL albo Git Bash na Windows; Docker, `age` - Windows: `winget install FiloSottile.age`;
`.env.backup` z sekcją „odtworzenie”, `BACKUP_AGE_IDENTITY` wskazuje zaszyfrowany plik klucza):

```bash
bash scripts/ops/db-restore-check.sh db/cyberszkolo-20261008T021500Z.dump.age
```

Windows: uruchamiaj z Windows Terminal (albo WSL) - w samym oknie Git Bash (mintty) `age` może nie móc zapytać o hasło klucza; wtedy
`winpty bash scripts/ops/db-restore-check.sh …`. Kontener trzyma bazę w RAM - Docker potrzebuje wolnej pamięci rzędu rozmiaru bazy
z indeksami (dziś kilkadziesiąt MB; przy dużej bazie zwiększ pamięć maszyny Docker Desktop).

Wynik: liczba wierszy w każdej tabeli i `OK: kopia odtwarza się (organizacje: N, zastosowane migracje: M)`. Kopia jest odszyfrowywana
strumieniem prosto do kontenera z danymi w RAM - po zakończeniu nie zostaje ani plik, ani wolumen. Porównaj liczbę organizacji i migracji z
produkcją (panel SUPER_ADMIN / `apps/api/prisma/migrations`) - to też wykrywa podłożoną fałszywą kopię (klucz publiczny nie jest tajny).

## Odtworzenie produkcji (awaria) - procedura ręczna, nie skrypt

Świadomie bez skryptu: to jedyna operacja, która nadpisuje bazę produkcyjną; każdy krok robi człowiek. `C` niżej to
`docker compose --env-file .env.prod -f docker-compose.prod.yml` (na VPS, w katalogu repo).

1. **Zatrzymaj ruch:** `$C stop api web` (jeśli stack działa).
2. **Kopia bieżącego stanu** (jeśli baza jeszcze działa): `bash scripts/ops/db-backup.sh`. Gdy baza jest uszkodzona, ten krok zawiedzie i
   wyśle `/fail` - to oczekiwane, pomiń go.
3. **Wolumen zniknął** (nowy serwer, `down -v`): uruchom **tylko** postgres - `$C up -d postgres` (initdb tworzy pustą bazę i role z
   `docker/postgres-init`; wymaga `APP_DB_PASSWORD` w `.env.prod`). **Nie** pełne `up`: `migrate` utworzyłby pusty schemat, a `api`
   zacząłby przyjmować ruch na pustej bazie.
4. **Odtwórz do nowej bazy obok**, strumieniem z komputera z kluczem (jawny zrzut nigdzie nie leży):

   ```bash
   # na VPS
   $C exec -T postgres createdb -U cyberszkolo cyberszkolo_restored
   # na komputerze z kluczem
   age --decrypt -i unfooly-backup.agekey.age cyberszkolo-<czas>.dump.age \
     | ssh <vps> 'cd ~/unfooly && docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres pg_restore -U cyberszkolo -d cyberszkolo_restored --exit-on-error'
   ```

   Kontrola na VPS: liczba organizacji, użytkowników, ostatnia migracja w `cyberszkolo_restored`.
5. **Podmień bazy** - zmiana nazwy wymaga braku połączeń do obu baz:

   ```bash
   $C exec -T postgres psql -U cyberszkolo -d postgres -c "ALTER DATABASE cyberszkolo ALLOW_CONNECTIONS false"
   $C exec -T postgres psql -U cyberszkolo -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('cyberszkolo', 'cyberszkolo_restored') AND pid <> pg_backend_pid()"
   $C exec -T postgres psql -U cyberszkolo -d postgres -c "ALTER DATABASE cyberszkolo RENAME TO cyberszkolo_broken"
   $C exec -T postgres psql -U cyberszkolo -d postgres -c "ALTER DATABASE cyberszkolo_restored RENAME TO cyberszkolo"
   ```

   (Po kroku 3 baza `cyberszkolo` jest pusta - też ją przemianuj, żeby `cyberszkolo_restored` zajęła jej nazwę.) Role
   `cyberszkolo_app` i `cyberszkolo_backup` są globalne (poza zrzutem bazy); uprawnienia `cyberszkolo_app` przychodzą ze zrzutu.
6. **Unieważnij sesje i tokeny z kopii** - odtworzona baza ma stan sprzed awarii: refresh tokeny unieważnione później (wylogowanie,
   zmiana hasła, dezaktywacja zwolnionego pracownika) wróciłyby do życia razem ze starymi hasłami:

   ```bash
   $C exec -T postgres psql -U cyberszkolo -d cyberszkolo -c "DELETE FROM refresh_tokens; DELETE FROM password_reset_tokens; DELETE FROM email_verification_tokens;"
   ```

   Wszyscy logują się ponownie (tokeny dostępu wygasają same w ciągu minut). Administratorom organizacji przekaż, że zmiany kont z okresu
   między kopią a awarią (dezaktywacje, zmiany ról, zaproszenia) trzeba powtórzyć, a użytkownikom - że hasło zmienione w tym okresie
   wróciło do poprzedniego (reset hasła).
7. `$C up -d` (migracje dogonią ewentualne nowsze wersje), sprawdź logowanie i panel, potem
   `$C exec -T postgres dropdb -U cyberszkolo cyberszkolo_broken`.
8. Zgłoszenia/dane z okresu między kopią a awarią są utracone - poinformuj klientów (RODO: naruszenie dostępności, ocena w 72 h). Dane,
   których usunięcia zażądano po wykonaniu kopii, usuń ponownie.

## RODO

Kopie zawierają wszystkie dane osobowe z bazy, zaszyfrowane kluczem, którego nie ma Cloudflare (podmiot przetwarzający przechowuje tylko
szyfrogram), w buckecie z jurysdykcją UE. Retencja 14 dni: dane usunięte w aplikacji (konto, organizacja PENDING po 14 dniach) znikają z kopii
najpóźniej po 14 dniach. Cloudflare jako podprzetwarzający - rejestr i DPA z klientami B2B. Wpis: `docs/legal/privacy-policy-checklist.md`.
