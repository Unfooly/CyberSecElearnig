#!/bin/sh
set -e

# Rola kopii zapasowej (B-117, D-136): `pg_dump` całej bazy dla scripts/ops/db-backup.sh.
#
# - NOSUPERUSER, tylko odczyt (`pg_read_all_data`, PostgreSQL 14+) - kopia nie może niczego zmienić w bazie.
# - BYPASSRLS - kopia obejmuje dane WSZYSTKICH organizacji, więc omija RLS (bez tego `pg_dump` z row_security=off kończy się
#   błędem na tabelach z politykami). To świadomy wyjątek od Zasady nr 1 (CLAUDE.md, lista wyjątków): rola istnieje tylko w bazie,
#   aplikacja nigdy się nią nie łączy.
# - BEZ HASŁA: logowanie wyłącznie przez gniazdo lokalne WEWNĄTRZ kontenera postgres (pg_hba obrazu: `local all all trust`), czyli
#   przez `docker compose exec` na hoście. Połączenia sieciowe (scram) bez hasła są odrzucane - nie ma czego wykraść z .env.
#
# Idempotentny: tworzy rolę albo poprawia jej atrybuty. Dla istniejącej bazy (VPS) uruchom raz ręcznie - docs/ops/BACKUP.md:
#   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres sh /docker-entrypoint-initdb.d/02-create-backup-role.sh

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cyberszkolo_backup') THEN
      CREATE ROLE cyberszkolo_backup LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    ELSE
      ALTER ROLE cyberszkolo_backup WITH LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
  END
  \$\$;
  GRANT pg_read_all_data TO cyberszkolo_backup;
EOSQL
