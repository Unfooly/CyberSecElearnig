#!/usr/bin/env bash
# Próba odtworzenia kopii zapasowej (B-117, D-136, runbook: docs/ops/BACKUP.md) - NIGDY nie dotyka bazy produkcyjnej.
#
# Uruchamiasz tam, gdzie jest klucz PRYWATNY age (komputer właściciela; nie VPS): pobiera wskazaną kopię z bucketu (albo bierze plik
# lokalny), odszyfrowuje STRUMIENIEM prosto do pg_restore (jawny zrzut nie trafia na dysk) w jednorazowym kontenerze i wypisuje liczbę
# wierszy w każdej tabeli schematu public. Kontener: dane wyłącznie w RAM (--tmpfs - obraz postgres deklaruje VOLUME, bez tego Docker
# utworzyłby anonimowy wolumen z pełną, jawną bazą), bez sieci (--network none), bez portów; usuwany na końcu razem z wolumenami (rm -v).
#
#   bash scripts/ops/db-restore-check.sh db/cyberszkolo-20261008T021500Z.dump.age   # z bucketu
#   bash scripts/ops/db-restore-check.sh ./cyberszkolo-20261008T021500Z.dump.age    # plik lokalny (zaszyfrowany)
#
# Konfiguracja: .env.backup w katalogu repo (albo BACKUP_ENV_FILE), uprawnienia 600: BACKUP_AGE_IDENTITY (plik klucza prywatnego - zalecany
# zaszyfrowany hasłem, age zapyta o nie), a przy pobieraniu z bucketu BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET i token TYLKO DO ODCZYTU
# BACKUP_S3_READ_ACCESS_KEY_ID / BACKUP_S3_READ_SECRET_ACCESS_KEY. Linux, macOS, WSL albo Git Bash (Windows).
set -Eeuo pipefail

# Ten sam obraz co usługa postgres w docker-compose.prod.yml (test db-backup.test.mjs pilnuje zgodności) - pg_restore starszej wersji
# nie przeczyta zrzutu z nowszej.
PG_IMAGE="postgres:16-alpine"

log() { echo "[db-restore-check] $*"; }

source_ref="${1:-}"
if [ -z "$source_ref" ]; then
  log "Użycie: db-restore-check.sh <klucz w bucketcie db/....dump.age | plik lokalny .dump.age>" >&2
  exit 2
fi
repo="$(cd "$(dirname "$0")/../.." && pwd)"

ENV_FILE="${BACKUP_ENV_FILE:-$repo/.env.backup}"
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -c '%a' "$ENV_FILE" 2> /dev/null || stat -f '%Lp' "$ENV_FILE")"
  case "$mode" in
    600 | 400) ;;
    *)
      # Git Bash (NTFS) nie ma uprawnień POSIX - tam zawsze 644; ostrzeżenie zamiast błędu.
      if [ "$(uname -o 2> /dev/null)" = "Msys" ]; then log "UWAGA: $ENV_FILE - chroń plik uprawnieniami NTFS (tylko Twoje konto)" >&2
      else log "BŁĄD: $ENV_FILE ma uprawnienia $mode - ustaw chmod 600" >&2; exit 2; fi
      ;;
  esac
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
if [ -z "${BACKUP_AGE_IDENTITY:-}" ] || [ ! -f "$BACKUP_AGE_IDENTITY" ]; then
  log "BŁĄD: BACKUP_AGE_IDENTITY musi wskazywać plik z kluczem prywatnym age" >&2
  exit 2
fi
command -v age > /dev/null || { log "BŁĄD: brak programu age" >&2; exit 2; }
command -v docker > /dev/null || { log "BŁĄD: brak dockera" >&2; exit 2; }

workdir="$(mktemp -d "${TMPDIR:-/tmp}/unfooly-restore.XXXXXX")"
chmod 700 "$workdir"
container="unfooly-restore-check-$$"
cleanup() {
  docker rm -f -v "$container" > /dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

encrypted="$source_ref"
if [ ! -f "$source_ref" ]; then
  for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_READ_ACCESS_KEY_ID BACKUP_S3_READ_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || { log "BŁĄD: brak $name (pobieranie z bucketu)" >&2; exit 2; }
  done
  case "$source_ref" in
    db/*.dump.age) ;;
    *) log "BŁĄD: klucz kopii ma postać db/<nazwa>.dump.age" >&2; exit 2 ;;
  esac
  encrypted="$workdir/backup.dump.age"
  curl_config="$workdir/curl.conf"
  ( umask 077 && printf 'user = "%s:%s"\n' "$BACKUP_S3_READ_ACCESS_KEY_ID" "$BACKUP_S3_READ_SECRET_ACCESS_KEY" > "$curl_config" )
  log "pobieranie $source_ref..."
  curl -fsS -m 600 --retry 3 --config "$curl_config" --aws-sigv4 "aws:amz:auto:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
    -o "$encrypted" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET/$source_ref"
fi

# MSYS_NO_PATHCONV: Git Bash przerobiłby ścieżkę w --tmpfs na ścieżkę Windows. Hasło losowe tylko dla initdb (bez sieci i tak niedostępne).
password="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
MSYS_NO_PATHCONV=1 docker run -d --name "$container" --network none --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=restore_check "$PG_IMAGE" > /dev/null
# Gotowość przez TCP (127.0.0.1 w kontenerze): serwer tymczasowy entrypointu (initdb) słucha tylko na gnieździe, więc pg_isready przez
# gniazdo odpowiedziałby za wcześnie - zanim serwer zostanie zatrzymany i uruchomiony właściwy.
ready=0
for _ in $(seq 1 90); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d restore_check > /dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { log "BŁĄD: postgres w kontenerze nie wstał w 90 s" >&2; exit 1; }

# Odszyfrowanie strumieniem do pg_restore - jawny zrzut nigdzie nie leży. --no-owner/--no-privileges: w kontenerze nie ma ról produkcyjnych
# (cyberszkolo_app); sprawdzamy dane i schemat, nie uprawnienia.
age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$encrypted" \
  | docker exec -i "$container" pg_restore --username=postgres --dbname=restore_check --no-owner --no-privileges --exit-on-error
log "odtworzono - liczba wierszy w tabelach:"
# Wewnętrzny `docker exec` BEZ -i: z -i zjadłby stdin pętli (resztę listy zapytań).
docker exec "$container" psql -U postgres -d restore_check -v ON_ERROR_STOP=1 -At -c "
  SELECT format('SELECT %L AS tabela, count(*) FROM public.%I', tablename, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" \
  | while read -r query; do docker exec "$container" psql -U postgres -d restore_check -At -F ' ' -c "$query"; done
organizations="$(docker exec "$container" psql -U postgres -d restore_check -At -c 'SELECT count(*) FROM public.organizations')"
migrations="$(docker exec "$container" psql -U postgres -d restore_check -At -c 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL')"
log "OK: kopia odtwarza się (organizacje: $organizations, zastosowane migracje: $migrations)"
