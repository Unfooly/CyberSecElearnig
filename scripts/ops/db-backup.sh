#!/usr/bin/env bash
# Codzienna kopia zapasowa bazy produkcyjnej (B-117, D-136, runbook: docs/ops/BACKUP.md). Uruchamiany z crona na VPS z katalogu repo.
#
# 1. pg_dump (format custom) rolą cyberszkolo_backup (tylko odczyt, BYPASSRLS - docker/postgres-init/02-create-backup-role.sh)
#    przez `docker compose exec` - baza nie wychodzi poza kontener inaczej niż strumieniem do pliku tymczasowego.
# 2. Kontrola zrzutu: niepusty, `pg_restore --list` go czyta i zawiera dane tabeli organizations.
# 3. Szyfrowanie kluczem PUBLICZNYM age (BACKUP_AGE_RECIPIENT) - klucz prywatny jest tylko u właściciela, poza VPS: przejęcie
#    serwera nie daje odczytu starych kopii. Niezaszyfrowany zrzut jest usuwany zaraz po zaszyfrowaniu (i przy każdym wyjściu).
# 4. Wysyłka do PRYWATNEGO bucketu (Cloudflare R2, API S3) przez curl --aws-sigv4 - bez dodatkowych obrazów i narzędzi.
#    Retencja (14 dni) to reguła cyklu życia bucketu, nie ten skrypt - token kopii nie musi umieć kasować.
# 5. Alarm: ping BACKUP_HEALTHCHECK_URL po sukcesie, <URL>/fail po błędzie (usługa typu healthchecks.io powiadamia też wtedy, gdy
#    ping nie przyjdzie wcale - padnięty cron, wyłączony serwer).
#
# Konfiguracja: plik .env.backup (wzór: .env.backup.example, uprawnienia 600) w katalogu repo albo BACKUP_ENV_FILE.
# Nigdy nie wypisuje sekretów (bez `set -x`; dane dostępu do bucketu idą do curl przez plik konfiguracyjny 600, nie argumenty).
set -Eeuo pipefail  # -E: pułapka ERR (alarm /fail) także w funkcjach i podpowłokach

cd "$(dirname "$0")/../.."

log() { echo "[db-backup] $*"; }

ENV_FILE="${BACKUP_ENV_FILE:-.env.backup}"
if [ ! -f "$ENV_FILE" ]; then
  log "BŁĄD: brak pliku konfiguracji $ENV_FILE (wzór: .env.backup.example)" >&2
  exit 2
fi
mode="$(stat -c '%a' "$ENV_FILE")"
case "$mode" in
  600 | 400) ;;
  *)
    log "BŁĄD: $ENV_FILE ma uprawnienia $mode - zawiera klucze bucketu, ustaw chmod 600" >&2
    exit 2
    ;;
esac
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

missing=()
for name in BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then missing+=("$name"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  log "BŁĄD: brak zmiennych w $ENV_FILE: ${missing[*]}" >&2
  exit 2
fi
case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *)
    log "BŁĄD: BACKUP_AGE_RECIPIENT to nie klucz publiczny age (age1...) - nigdy nie wpisuj tu klucza prywatnego" >&2
    exit 2
    ;;
esac
command -v age > /dev/null || { log "BŁĄD: brak programu age na hoście (sudo apt install age)" >&2; exit 2; }
# --aws-sigv4 jest w curl od 7.75.
curl_version="$(curl --version | head -n 1 | cut -d ' ' -f 2)"
if [ "$(printf '%s\n7.75.0\n' "$curl_version" | sort -V | head -n 1)" != "7.75.0" ]; then
  log "BŁĄD: curl $curl_version - potrzebny 7.75+ (--aws-sigv4)" >&2
  exit 2
fi

ping_healthcheck() {
  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}$1" || log "UWAGA: ping alarmu nie dotarł ($1)" >&2
  fi
}

workdir="$(mktemp -d /var/tmp/unfooly-backup.XXXXXX)"
chmod 700 "$workdir"
cleanup() { rm -rf "$workdir"; }
on_error() {
  log "BŁĄD: kopia NIE powstała (linia $1)" >&2
  ping_healthcheck /fail
}
trap cleanup EXIT
trap 'on_error $LINENO' ERR

COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$workdir/cyberszkolo-$stamp.dump"
encrypted="$dump.age"
key="db/cyberszkolo-$stamp.dump.age"

log "zrzut bazy..."
"${COMPOSE[@]}" exec -T postgres pg_dump --username=cyberszkolo_backup --dbname=cyberszkolo --format=custom --compress=6 > "$dump"
[ -s "$dump" ] || { log "BŁĄD: pusty zrzut" >&2; false; }
# Lista do pliku, nie `| grep -q` - grep kończący się przy pierwszym trafieniu zabiłby pg_restore SIGPIPE-em (pipefail = fałszywy błąd).
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$dump" > "$workdir/list.txt"
grep -q 'TABLE DATA public organizations' "$workdir/list.txt" \
  || { log "BŁĄD: zrzut nie zawiera danych tabeli organizations" >&2; false; }

age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$dump"
rm -f "$dump"

log "wysyłka $key ($(stat -c '%s' "$encrypted") B)..."
curl_config="$workdir/curl.conf"
( umask 077 && printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" > "$curl_config" )
# x-amz-content-sha256 jawnie (API S3 go wymaga; UNSIGNED-PAYLOAD - podpisany jest nagłówek, nie treść; integralność treści daje age).
curl -fsS -m 600 --retry 3 --config "$curl_config" --aws-sigv4 "aws:amz:auto:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
  --upload-file "$encrypted" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET/$key" -o /dev/null

ping_healthcheck ""
log "OK: $key"
