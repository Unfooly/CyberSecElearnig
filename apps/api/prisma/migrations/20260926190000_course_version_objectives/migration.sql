-- Cele modułu przy WERSJI treści (D-081): od schemaVersion 5 cel może mieć `completeWhen` (id bloków), a id bloków należą do
-- konkretnej wersji - Course.objectives (jedna kolumna na kurs, nadpisywana każdym importem) nie może ich opisywać dla
-- przypisań przypiętych do starszej wersji. Course.objectives zostaje (katalog kursów, same teksty); usunięcie: backlog B-107.
-- course_versions to tabela globalna bez RLS (katalog treści, nie dane klienta), jak courses.

ALTER TABLE "course_versions" ADD COLUMN "objectives" JSONB;

-- Backfill: istniejące wersje dostają cele swojego kursu w chwili migracji (dotąd jedyne źródło, same teksty z
-- schemaVersion 4 - bez completeWhen, więc nic nie wskazuje bloków, których w danej wersji mogłoby nie być).
UPDATE "course_versions" AS cv
SET "objectives" = c."objectives"
FROM "courses" AS c
WHERE cv."courseId" = c."id" AND c."objectives" IS NOT NULL;
