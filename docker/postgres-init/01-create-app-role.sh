#!/bin/sh
set -e

# Rola dla runtime backendu (Zasada nr 1, CLAUDE.md: RLS jako druga linia
# obrony izolacji tenantów działa tylko wtedy, gdy łącząca się rola NIE jest
# superuserem ani właścicielem tabel — obie te role domyślnie omijają RLS,
# nawet z ALTER TABLE ... FORCE ROW LEVEL SECURITY).
#
# Migracje (`prisma migrate`) nadal działają jako POSTGRES_USER — potrzebują
# uprawnień DDL, których cyberszkolo_app celowo nie ma. Nie "upraszczaj" tego
# z powrotem do jednej roli — patrz README "Dwie role Postgresa: migracje
# vs runtime".
#
# Hasło pochodzi WYŁĄCZNIE ze zmiennej środowiskowej APP_DB_PASSWORD (.env /
# .env.test na hoście, przekazywana tu przez docker-compose.yml) — nigdy nie
# jest hardkodowane w tym skrypcie ani w żadnej migracji SQL.

if [ -z "$APP_DB_PASSWORD" ]; then
  echo "APP_DB_PASSWORD nie jest ustawione — pomijam tworzenie roli cyberszkolo_app." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cyberszkolo_app') THEN
      CREATE ROLE cyberszkolo_app
        LOGIN
        PASSWORD '${APP_DB_PASSWORD}'
        NOSUPERUSER
        NOCREATEDB
        NOCREATEROLE
        NOBYPASSRLS;
    ELSE
      ALTER ROLE cyberszkolo_app WITH PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;
EOSQL
