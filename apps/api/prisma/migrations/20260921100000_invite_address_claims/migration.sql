-- Import i zaproszenia bez sondy istnienia kont (adres zajęty w innej organizacji) oraz wygasanie zaproszeń.
--
-- Uwaga: nowa wartość enuma UserImportInviteStatus (EXPIRED) NIE jest użyta w tej migracji (PostgreSQL nie pozwala jej używać
-- w tej samej transakcji, w której została dodana) - żadne CHECK ani DEFAULT się do niej nie odwołuje.

-- AlterEnum
ALTER TYPE "UserImportInviteStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "user_import_rows" ADD COLUMN     "addressTaken" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "invite_notices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_notices_organizationId_createdAt_idx" ON "invite_notices"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "invite_notices" ADD CONSTRAINT "invite_notices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wiersz z zajętym adresem nie ma konta w tej organizacji, ale dla administratora jest "utworzony" (accountResult CREATED).
-- IS NOT DISTINCT FROM: CHECK przepuszcza NULL, więc porównanie z NULL musi być jawne.
ALTER TABLE "user_import_rows" ADD CONSTRAINT "user_import_rows_address_taken_check"
  CHECK (NOT "addressTaken" OR ("userId" IS NULL AND "accountResult" IS NOT DISTINCT FROM 'CREATED'));

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Dziennik jest tylko dopisywany i czytany w obrębie organizacji (limit dobowy).
ALTER TABLE "invite_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invite_notices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invite_notices_select" ON "invite_notices" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "invite_notices_insert" ON "invite_notices" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "invite_notices_delete" ON "invite_notices" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));
