-- Strefa czasowa organizacji (IANA): UI formatuje daty wg niej, niezależnie od strefy serwera i przeglądarki.
-- Domyślnie Europe/Warsaw (istniejące organizacje dostają ją przy dodaniu kolumny).
--
-- (Wygenerowane przez `prisma migrate dev` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Warsaw';

-- Kształt nazwy IANA (np. "Europe/Warsaw", "America/Argentina/Buenos_Aires", "UTC"); poprawność nazwy sprawdza API (Intl).
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_timezone_format_check"
  CHECK ("timezone" ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$');
