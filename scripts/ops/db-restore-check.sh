#!/usr/bin/env bash
# Próba odtworzenia kopii zapasowej (B-117, D-136, runbook: docs/ops/BACKUP.md) - NIGDY nie dotyka bazy produkcyjnej.
#
# Uruchamiasz tam, gdzie jest klucz PRYWATNY age (komputer właściciela; nie VPS): pobiera wskazaną kopię z bucketu (albo bierze plik
# lokalny), odszyfrowuje, odtwarza do jednorazowego kontenera postgres:16-alpine (bez wolumenu, bez portów, usuwany na końcu) i wypisuje
# liczbę wierszy w każdej tabeli schematu public. Niezaszyfrowany zrzut leży tylko w katalogu tymczasowym 700 i jest usuwany na końcu.
#
#   bash scripts/ops/db-restore-check.sh db/cyberszkolo-20261008T020000Z.dump.age   # z bucketu
#   bash scripts/ops/db-restore-check.sh ./cyberszkolo-20261008T020000Z.dump.age    # plik lokalny
#
# Konfiguracja (.env.backup albo BACKUP_ENV_FILE): BACKUP_AGE_IDENTITY (ścieżka do pliku z kluczem prywatnym), a przy pobieraniu z bucketu
# BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET i klucz tylko do odczytu BACKUP_S3_READ_ACCESS_KEY_ID / BACKUP_S3_READ_SECRET_ACCESS_KEY.
set -Eeuo pipefail

log() { echo "[db-restore-check] $*"; }

source_ref="${1:-}"
if [ -z "$source_ref" ]; then
  log "Użycie: db-restore-check.sh <klucz w bucketcie db/....dump.age | plik lokalny .dump.age>" >&2
  exit 2
fi

ENV_FILE="${BACKUP_ENV_FILE:-.env.backup}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
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
  docker rm -f "$container" > /dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

encrypted="$workdir/backup.dump.age"
if [ -f "$source_ref" ]; then
  cp "$source_ref" "$encrypted"
else
  for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_READ_ACCESS_KEY_ID BACKUP_S3_READ_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || { log "BŁĄD: brak $name (pobieranie z bucketu)" >&2; exit 2; }
  done
  case "$source_ref" in
    db/*.dump.age) ;;
    *) log "BŁĄD: klucz kopii ma postać db/<nazwa>.dump.age" >&2; exit 2 ;;
  esac
  curl_config="$workdir/curl.conf"
  ( umask 077 && printf 'user = "%s:%s"\n' "$BACKUP_S3_READ_ACCESS_KEY_ID" "$BACKUP_S3_READ_SECRET_ACCESS_KEY" > "$curl_config" )
  log "pobieranie $source_ref..."
  curl -fsS -m 600 --retry 3 --config "$curl_config" --aws-sigv4 "aws:amz:auto:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
    -o "$encrypted" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET/$source_ref"
fi

dump="$workdir/backup.dump"
age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$dump" "$encrypted"
log "odszyfrowano ($(wc -c < "$dump" | tr -d ' ') B)"

# Jednorazowy kontener: bez -v (żadnego wolumenu), bez -p (żadnego portu), hasło losowe tylko dla initdb.
docker run -d --name "$container" -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" -e POSTGRES_DB=restore_check \
  postgres:16-alpine > /dev/null
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d restore_check > /dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d restore_check > /dev/null

# --no-owner/--no-privileges: w kontenerze nie ma ról produkcyjnych (cyberszkolo_app); sprawdzamy dane i schemat, nie uprawnienia.
docker exec -i "$container" pg_restore --username=postgres --dbname=restore_check --no-owner --no-privileges --exit-on-error < "$dump"
log "odtworzono - liczba wierszy w tabelach:"
docker exec "$container" psql -U postgres -d restore_check -v ON_ERROR_STOP=1 -At -c "
  SELECT format('SELECT %L AS tabela, count(*) FROM public.%I', tablename, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" \
  | while read -r query; do docker exec "$container" psql -U postgres -d restore_check -At -F ' ' -c "$query"; done
organizations="$(docker exec "$container" psql -U postgres -d restore_check -At -c 'SELECT count(*) FROM public.organizations')"
migrations="$(docker exec "$container" psql -U postgres -d restore_check -At -c 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL')"
log "OK: kopia odtwarza się (organizacje: $organizations, zastosowane migracje: $migrations)"
