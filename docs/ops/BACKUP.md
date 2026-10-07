# Kopia zapasowa bazy - runbook (B-117, D-136)

Codzienny zrzut bazy produkcyjnej (`postgres_data`) do prywatnego bucketu poza VPS, zaszyfrowany kluczem, którego nie ma na serwerze.
Awaria dysku, `down -v`, `volume prune` albo zła migracja przestają oznaczać utratę danych klientów - tracimy najwyżej dobę.

## Jak to działa

| element | co robi |
|---|---|
| `docker/postgres-init/02-create-backup-role.sh` | rola `cyberszkolo_backup`: tylko odczyt (`pg_read_all_data`), `BYPASSRLS` (kopia obejmuje wszystkie organizacje - wyjątek od Zasady nr 1, CLAUDE.md), bez superusera, **bez hasła** (logowanie tylko gniazdem w kontenerze przez `docker compose exec`) |
| `scripts/ops/db-backup.sh` | `pg_dump` tą rolą → kontrola zrzutu (`pg_restore --list`, dane `organizations`) → szyfrowanie `age` kluczem **publicznym** → usunięcie zrzutu → wysyłka do bucketu (`curl --aws-sigv4`) → ping alarmu |
| `scripts/ops/db-restore-check.sh` | na komputerze z kluczem prywatnym: pobranie, odszyfrowanie, odtworzenie w jednorazowym kontenerze (bez wolumenu i portów), liczba wierszy w tabelach |
| `scripts/ops/db-backup.test.mjs` | test w CI: rola tylko do odczytu, szyfrowanie przed wysyłką, sekrety poza logami i argumentami, próba odtworzenia nie dotyka produkcji |
| bucket (R2) | prywatny, **inny** niż bucket treści; reguła cyklu życia: usuwanie obiektów `db/` po 14 dniach |

Klucz prywatny `age` ma właściciel (menedżer haseł + drugi nośnik offline). Bez niego kopie są bezużyteczne - jego utrata = utrata
wszystkich kopii; przejęcie VPS nie daje odczytu kopii.

## Wdrożenie (jednorazowo - ręcznie, nie robi tego żaden skrypt)

1. **Klucze age (komputer właściciela):** `age-keygen -o unfooly-backup.agekey` → linia `# public key: age1...` to
   `BACKUP_AGE_RECIPIENT`. Plik `unfooly-backup.agekey` zapisz w menedżerze haseł i na drugim nośniku offline; **nigdy na VPS**.
2. **Bucket R2:** nowy, prywatny bucket (np. `unfooly-db-backup`, lokalizacja UE). Reguła cyklu życia: prefiks `db/`, usuwanie po
   14 dniach. Dwa tokeny API R2 ograniczone do tego bucketu: **Object Read & Write** (VPS, wysyłka) i **Object Read** (odtworzenie).
3. **Alarm:** sprawdzenie w usłudze typu healthchecks.io (okres 1 dzień, tolerancja 2 h, powiadomienie e-mailem) - adres pingu to
   `BACKUP_HEALTHCHECK_URL`. Alarm przychodzi i po błędzie (`/fail`), i gdy pingu nie ma wcale (padnięty cron, wyłączony serwer).
4. **VPS - narzędzia:** `sudo apt install age` (curl 7.75+ jest w systemie; skrypt to sprawdza).
5. **VPS - konfiguracja:** w katalogu repo `cp .env.backup.example .env.backup && chmod 600 .env.backup`, uzupełnij sekcję „wysyłka”.
6. **VPS - rola w istniejącej bazie** (nowe wolumeny dostają ją same przy inicjalizacji):

   ```bash
   git pull
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres sh /docker-entrypoint-initdb.d/02-create-backup-role.sh
   ```

7. **Pierwsza kopia ręcznie:** `bash scripts/ops/db-backup.sh` → `OK: db/cyberszkolo-<czas>.dump.age`; w usłudze alarmowej pojawia się ping.
8. **Cron** (crontab użytkownika z dostępem do dockera, codziennie 2:15 UTC, wynik do dziennika):

   ```
   15 2 * * * cd /home/<użytkownik>/unfooly && bash scripts/ops/db-backup.sh 2>&1 | logger -t db-backup
   ```

9. **Próba odtworzenia** (niżej) na pierwszej kopii z crona - dopiero wtedy kopia jest „sprawdzona”.

## Próba odtworzenia (co miesiąc i po każdej zmianie skryptów)

Na komputerze właściciela (Docker, `age`, `.env.backup` z sekcją „odtworzenie” i `BACKUP_AGE_IDENTITY` wskazującym plik klucza):

```bash
bash scripts/ops/db-restore-check.sh db/cyberszkolo-20261008T021500Z.dump.age
```

Wynik: liczba wierszy w każdej tabeli i `OK: kopia odtwarza się (organizacje: N, zastosowane migracje: M)`. Kontener i odszyfrowany
plik znikają na końcu. Porównaj liczbę organizacji i migracji z produkcją (panel SUPER_ADMIN / `apps/api/prisma/migrations`).

## Odtworzenie produkcji (awaria) - procedura ręczna, nie skrypt

Świadomie bez skryptu: to jedyna operacja, która nadpisuje bazę produkcyjną; każdy krok robi człowiek.

1. Zatrzymaj ruch: `docker compose --env-file .env.prod -f docker-compose.prod.yml stop api web`.
2. Pobierz i odszyfruj kopię na komputerze z kluczem (`age --decrypt -i unfooly-backup.agekey -o db.dump <plik>.dump.age`), przenieś
   `db.dump` na VPS (scp), po użyciu usuń z obu miejsc.
3. Jeśli wolumen `postgres_data` istnieje i baza działa: zapisz bieżący stan na wszelki wypadek (`bash scripts/ops/db-backup.sh`).
4. Odtwórz do **nowej** bazy obok, sprawdź, dopiero potem podmień:

   ```bash
   C="docker compose --env-file .env.prod -f docker-compose.prod.yml"
   $C exec -T postgres createdb -U cyberszkolo cyberszkolo_restored
   $C exec -T postgres pg_restore -U cyberszkolo -d cyberszkolo_restored --exit-on-error < db.dump
   # kontrola: liczba organizacji, użytkowników, ostatnia migracja
   $C exec -T postgres psql -U cyberszkolo -d postgres -c 'ALTER DATABASE cyberszkolo RENAME TO cyberszkolo_broken'
   $C exec -T postgres psql -U cyberszkolo -d postgres -c 'ALTER DATABASE cyberszkolo_restored RENAME TO cyberszkolo'
   ```

   Role `cyberszkolo_app` i `cyberszkolo_backup` są globalne (poza zrzutem bazy) - przy nowym wolumenie tworzą je skrypty
   `docker/postgres-init` (wymaga `APP_DB_PASSWORD` w `.env.prod`).
5. `$C up -d` (migracje dogonią ewentualne nowsze wersje), sprawdź logowanie i panel, potem usuń `cyberszkolo_broken` i `db.dump`.
6. Zgłoszenia/dane z okresu między kopią a awarią są utracone - poinformuj klientów (RODO: naruszenie dostępności, ocena w 72 h).

## RODO

Kopie zawierają wszystkie dane osobowe z bazy (szyfrowane, UE). Retencja 14 dni: dane usunięte w aplikacji (konto, organizacja PENDING
po 14 dniach) znikają z kopii najpóźniej po 14 dniach. Wpis: `docs/legal/privacy-policy-checklist.md`.
