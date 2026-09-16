-- Rola cyberszkolo_app (tworzona przez docker-entrypoint-initdb.d, patrz
-- docker-compose.yml i docker/postgres-init/01-create-app-role.sh) to
-- runtime backendu — celowo NIE superuser i NIE właściciel tabel, żeby RLS
-- (Zasada nr 1, CLAUDE.md) faktycznie ją ograniczał. Ta migracja, jak
-- wszystkie, działa jako rola-właściciel (DDL), więc może nadawać
-- uprawnienia bez ich posiadania samej w sobie.
--
-- ALTER DEFAULT PRIVILEGES obejmuje też tabele, które dopiero powstaną w
-- kolejnych migracjach tej roli — nowa tabela z danymi klienckimi nie
-- wymaga osobnego GRANT, żeby backend mógł jej normalnie używać.
--
-- Świadomie: brak GRANT na CREATE/DDL, brak BYPASSRLS, brak członkostwa w
-- roli właściciela — cyberszkolo_app ma tylko to, czego runtime potrzebuje.

GRANT USAGE ON SCHEMA public TO "cyberszkolo_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "cyberszkolo_app";

ALTER DEFAULT PRIVILEGES FOR ROLE "cyberszkolo" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "cyberszkolo_app";
