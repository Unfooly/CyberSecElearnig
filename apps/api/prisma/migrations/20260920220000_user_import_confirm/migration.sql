-- Import pracowników z CSV, krok 2 (commit 5/5): potwierdzenie, wynik utworzenia kont i kolejka zaproszeń z tempem.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)
--
-- Uwaga: nowe wartości enuma UserImportBatchStatus (PROCESSING, COMPLETED) NIE są użyte w tej migracji (PostgreSQL nie pozwala
-- ich używać w tej samej transakcji, w której zostały dodane) - żadne CHECK ani DEFAULT się do nich nie odwołuje.

-- CreateEnum
CREATE TYPE "UserImportAccountResult" AS ENUM ('CREATED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserImportInviteStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "UserImportBatchStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "UserImportBatchStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "user_import_batches" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedByEmail" VARCHAR(254);

-- AlterTable
ALTER TABLE "user_import_rows" ADD COLUMN     "accountReason" VARCHAR(200),
ADD COLUMN     "accountResult" "UserImportAccountResult",
ADD COLUMN     "inviteClaimedAt" TIMESTAMP(3),
ADD COLUMN     "inviteReason" VARCHAR(200),
ADD COLUMN     "inviteSentAt" TIMESTAMP(3),
ADD COLUMN     "inviteStatus" "UserImportInviteStatus",
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "user_import_batches_organizationId_status_idx" ON "user_import_batches"("organizationId", "status");

-- CreateIndex
CREATE INDEX "user_import_rows_organizationId_batchId_inviteStatus_idx" ON "user_import_rows"("organizationId", "batchId", "inviteStatus");

-- SQL-only złożone FK: konto utworzone przez import musi należeć do TEJ SAMEJ organizacji (FK omijają RLS); usunięcie konta
-- zeruje wyłącznie userId (PG15+), wiersz raportu zostaje.
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_organizationId_userId_fkey"
  FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("userId") ON UPDATE NO ACTION;

-- Spójność wyniku: wynik konta mają wyłącznie wiersze VALID; porażka zawsze ma powód; zaproszenie dotyczy tylko utworzonego konta.
-- IS NOT DISTINCT FROM zamiast "=": CHECK z wartością NULL przechodzi, więc samo "accountResult" = 'CREATED' przepuściłoby
-- zaproszenie dla wiersza BEZ wyniku konta.
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_account_result_check"
  CHECK (("accountResult" IS NULL OR "status" = 'VALID')
     AND ("accountResult" IS DISTINCT FROM 'FAILED' OR "accountReason" IS NOT NULL)
     AND ("inviteStatus" IS NULL OR "accountResult" IS NOT DISTINCT FROM 'CREATED'));
