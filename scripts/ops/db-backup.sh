#!/usr/bin/env bash
# Codzienna kopia zapasowa bazy produkcyjnej (B-117, D-136, runbook: docs/ops/BACKUP.md). Uruchamiany z crona na VPS z katalogu repo.
#
# 1. pg_dump (format custom) rolą cyberszkolo_backup (tylko odczyt, BYPASSRLS - docker/postgres-init/02-create-backup-role.sh)
#    przez `docker compose exec`, do pliku w katalogu tymczasowym 700 (po kontroli wolnego miejsca).
# 2. Kontrola zrzutu: niepusty, `pg_restore --list` go czyta i zawiera dane tabeli organizations.
# 3. Szyfrowanie kluczem PUBLICZNYM age (BACKUP_AGE_RECIPIENT) - klucz prywatny jest tylko u właściciela, poza VPS: przejęcie
#    serwera nie daje odczytu starych kopii. Niezaszyfrowany zrzut jest usuwany zaraz po zaszyfrowaniu, przy każdym wyjściu, a katalogi
#    po przerwanym biegu (SIGKILL, OOM, restart - pułapka EXIT się wtedy nie wykona) - na starcie następnego.
# 4. Wysyłka do PRYWATNEGO bucketu (Cloudflare R2, jurysdykcja UE, API S3) przez curl --aws-sigv4 - bez dodatkowych obrazów i narzędzi.
#    Retencja 14 dni i ochrona przed skasowaniem (token zapisu R2 umie też kasować) to reguły bucketu: cykl życia + blokada obiektów.
# 5. Alarm (obowiązkowy): ping BACKUP_HEALTHCHECK_URL po sukcesie, <URL>/fail po błędzie - także konfiguracji (usługa typu
#    healthchecks.io powiadamia też wtedy, gdy ping nie przyjdzie wcale - padnięty cron, wyłączony serwer).
#
# Konfiguracja: plik .env.backup (wzór: .env.backup.example, uprawnienia 600) w katalogu repo albo BACKUP_ENV_FILE.
# Nigdy nie wypisuje sekretów (bez `set -x`); dane dostępu do bucketu i adres alarmu idą do curl przez plik konfiguracyjny / stdin, nie
# argumenty (widoczne w `ps`), a zmienne z .env.backup nie są eksportowane do procesów potomnych.
set -Eeuo pipefail  # -E: pułapka ERR (alarm /fail) także w funkcjach

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
# Bez `set -a`: zmienne potrzebne tylko temu skryptowi, nie trafiają do środowiska docker/age/curl.
# shellcheck disable=SC1090
. "$ENV_FILE"

ping_healthcheck() {
  # Adres przez stdin (-K -), nie argument: inny użytkownik VPS widziałby go w `ps` i mógłby wyciszać alarm fałszywymi pingami.
  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
    printf 'url = "%s%s"\n' "$BACKUP_HEALTHCHECK_URL" "$1" | curl -fsS -m 10 --retry 3 -o /dev/null -K - \
      || log "UWAGA: ping alarmu nie dotarł ($1)" >&2
  fi
}
config_error() {
  log "BŁĄD: $*" >&2
  ping_healthcheck /fail
  exit 2
}

[ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || config_error "brak BACKUP_HEALTHCHECK_URL w $ENV_FILE - alarm jest obowiązkowy (docs/ops/BACKUP.md)"
missing=()
for name in BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then missing+=("$name"); fi
done
[ "${#missing[@]}" -eq 0 ] || config_error "brak zmiennych w $ENV_FILE: ${missing[*]}"
case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *) config_error "BACKUP_AGE_RECIPIENT to nie klucz publiczny age (age1...) - nigdy nie wpisuj tu klucza prywatnego" ;;
esac
# Plik konfiguracyjny curl (`user = "..."`) - cudzysłów albo backslash w sekrecie by go rozbił; tokeny R2 są alfanumeryczne.
for name in BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_HEALTHCHECK_URL; do
  case "${!name}" in *'"'* | *'\'*) config_error "$name zawiera cudzysłów albo backslash" ;; esac
done
command -v age > /dev/null || config_error "brak programu age na hoście (sudo apt install age)"
# --aws-sigv4 z jawnym x-amz-content-sha256 przy wysyłce pliku: curl 8.0+ (Ubuntu 24.04 ma 8.5).
curl_version="$(curl --version | head -n 1 | cut -d ' ' -f 2)"
if [ "$(printf '%s\n8.0.0\n' "$curl_version" | sort -V | head -n 1)" != "8.0.0" ]; then
  config_error "curl $curl_version - potrzebny 8.0+ (podpis SigV4 dla S3)"
fi

# Jeden bieg naraz (cron i ręczny): drugi kończy się bez błędu - pierwszy wyśle ping. VPS ma 1 GB RAM, dwa zrzuty naraz to zbędne ryzyko.
exec 9> /var/tmp/unfooly-backup.lock
if ! flock -n 9; then
  log "inny bieg kopii trwa - pomijam"
  exit 0
fi

# Katalogi po przerwanym biegu (pułapka EXIT się nie wykonała) - mogą zawierać jawny zrzut.
find /var/tmp -maxdepth 1 -type d -name 'unfooly-backup.*' -mmin +120 -exec rm -rf {} + 2> /dev/null || true

workdir="$(mktemp -d /var/tmp/unfooly-backup.XXXXXX)"
chmod 700 "$workdir"
cleanup() { rm -rf "$workdir"; }
on_error() {
  # set -E dziedziczy pułapkę do podstawień $(...): błąd w podpowłoce i tak zatrzyma skrypt - alarm raz, z głównej powłoki.
  [ "$BASH_SUBSHELL" -eq 0 ] || return 0
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

# Miejsce: zrzut i jego wersja zaszyfrowana leżą chwilę obok siebie - potrzeba co najmniej 2x rozmiar bazy (zrzut jest mniejszy od bazy).
db_bytes="$("${COMPOSE[@]}" exec -T postgres psql --username=cyberszkolo_backup --dbname=cyberszkolo -At -c 'SELECT pg_database_size(current_database())')"
free_bytes="$(df --output=avail -B1 /var/tmp | tail -n 1 | tr -d ' ')"
if [ "$free_bytes" -lt $((2 * db_bytes)) ]; then
  log "BŁĄD: za mało miejsca w /var/tmp ($free_bytes B wolne, baza $db_bytes B) - docs/ops/DISK.md" >&2
  false
fi

log "zrzut bazy..."
# --lock-wait-timeout: nie czekamy w nieskończoność na blokadę (np. trwająca migracja); kopia z alarmem /fail zamiast zawieszenia.
"${COMPOSE[@]}" exec -T postgres pg_dump --username=cyberszkolo_backup --dbname=cyberszkolo --format=custom --compress=6 \
  --lock-wait-timeout=120s > "$dump"
[ -s "$dump" ] || { log "BŁĄD: pusty zrzut" >&2; false; }
# Lista do pliku, nie `| grep -q` - grep kończący się przy pierwszym trafieniu zabiłby pg_restore SIGPIPE-em (pipefail = fałszywy błąd).
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$dump" > "$workdir/list.txt"
grep -q 'TABLE DATA public organizations' "$workdir/list.txt" \
  || { log "BŁĄD: zrzut nie zawiera danych tabeli organizations" >&2; false; }

age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$dump"
rm -f "$dump"

size="$(stat -c '%s' "$encrypted")"
log "wysyłka $key ($size B)..."
curl_config="$workdir/curl.conf"
( umask 077 && printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" > "$curl_config" )
# x-amz-content-sha256 jawnie (API S3 go wymaga; UNSIGNED-PAYLOAD - podpisany jest nagłówek, nie treść; integralność treści daje age).
curl -fsS -m 600 --retry 3 --config "$curl_config" --aws-sigv4 "aws:amz:auto:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
  --upload-file "$encrypted" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET/$key" -o /dev/null

ping_healthcheck ""
log "OK: $key"
