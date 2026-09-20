-- Import pracowników z CSV, krok 1 (commit 4/5): partie podglądu z walidacją per wiersz.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateEnum
CREATE TYPE "UserImportBatchStatus" AS ENUM ('PREVIEW');

-- CreateEnum
CREATE TYPE "UserImportRowStatus" AS ENUM ('VALID', 'EXISTING', 'ERROR');

-- CreateTable
CREATE TABLE "user_import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByEmail" VARCHAR(254) NOT NULL,
    "status" "UserImportBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "fileName" VARCHAR(200),
    "delimiter" VARCHAR(1) NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validCount" INTEGER NOT NULL,
    "existingCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "skippedEmpty" INTEGER NOT NULL,
    "ignoredColumns" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_import_rows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "departmentName" VARCHAR(100),
    "status" "UserImportRowStatus" NOT NULL,
    "reason" VARCHAR(200),

    CONSTRAINT "user_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_import_batches_organizationId_createdAt_idx" ON "user_import_batches"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "user_import_batches_expiresAt_idx" ON "user_import_batches"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_import_batches_organizationId_id_key" ON "user_import_batches"("organizationId", "id");

-- CreateIndex
CREATE INDEX "user_import_rows_organizationId_batchId_status_idx" ON "user_import_rows"("organizationId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_import_rows_batchId_line_key" ON "user_import_rows"("batchId", "line");

-- AddForeignKey
ALTER TABLE "user_import_batches" ADD CONSTRAINT "user_import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_organizationId_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "user_import_batches"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- SQL-only złożone FK: autor partii musi należeć do TEJ SAMEJ organizacji (FK omijają RLS); usunięcie konta zeruje wyłącznie
-- createdByUserId (PG15+), partia i kopia e-maila zostają.
ALTER TABLE "user_import_batches" ADD CONSTRAINT "user_import_batches_organizationId_createdByUserId_fkey"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("createdByUserId") ON UPDATE NO ACTION;

-- Spójność liczników i limit rozmiaru partii (5000 wierszy danych) także na poziomie bazy.
ALTER TABLE "user_import_batches" ADD CONSTRAINT "user_import_batches_counts_check"
  CHECK ("totalRows" = "validCount" + "existingCount" + "errorCount"
     AND "totalRows" >= 0 AND "totalRows" <= 5000 AND "validCount" >= 0 AND "existingCount" >= 0 AND "errorCount" >= 0 AND "skippedEmpty" >= 0);
-- Wiersz z błędem zawsze ma powód (COALESCE nie jest potrzebny: warunek dotyczy statusu, a NULL powodu jest testowany jawnie).
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_error_reason_check"
  CHECK ("status" <> 'ERROR' OR "reason" IS NOT NULL);

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Polityki per komenda (USING nie szersze niż WITH CHECK). DELETE dozwolone
-- w obrębie organizacji: anulowanie podglądu, zastąpienie go nowym i job sprzątania wygasłych partii.
ALTER TABLE "user_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_import_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_import_batches_select" ON "user_import_batches" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_batches_insert" ON "user_import_batches" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_batches_update" ON "user_import_batches" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_batches_delete" ON "user_import_batches" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "user_import_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_import_rows" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_import_rows_select" ON "user_import_rows" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_rows_insert" ON "user_import_rows" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_rows_update" ON "user_import_rows" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "user_import_rows_delete" ON "user_import_rows" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));
