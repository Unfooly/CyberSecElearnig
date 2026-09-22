-- Stabilny klucz kursu do upsertu przy imporcie treści (content-import, PR 4 D-051 pkt 11): NULLABLE, bo kursy sprzed
-- importu (utworzone wprost, testy) nie mają i nie potrzebują sluga. UNIQUE na kolumnie nullable pozwala na wiele NULL-i.
-- `courses` to tabela globalna bez RLS (katalog treści, nie dane klienckie) - jak reszta zmian w tej tabeli.

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "slug" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");
