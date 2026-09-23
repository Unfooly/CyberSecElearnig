-- Panel resellera, krok 1 (D-070, zgłoszenie B-092): partner obsługujący wiele organizacji klienckich.
-- Reseller jest ZWYKŁĄ organizacją z `kind = RESELLER`, więc logowanie, sesje, zaproszenia i RLS działają
-- bez nowego mechanizmu; różni się tylko rolą użytkowników (RESELLER_ADMIN) i tym, że nie ma pracowników.
--
-- UWAGA: `prisma migrate diff` wygenerował tu dodatkowo kilkanaście `DROP CONSTRAINT` dla złożonych kluczy
-- obcych ("organizationId", "userId") -> users("organizationId", "id"), których Prisma nie potrafi wyrazić
-- w schemacie. Zostały usunięte z tej migracji celowo (CLAUDE.md i README, sekcja „Backlog bazy danych”).

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('CLIENT', 'RESELLER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RESELLER_ADMIN';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "kind" "OrganizationKind" NOT NULL DEFAULT 'CLIENT';

-- CreateTable: kto obsługuje którą organizację kliencką. Tabela GLOBALNA (jak `organizations`), bez RLS:
-- to metadana platformy, nie dane klienckie. Najwyżej jeden reseller na organizację (UNIQUE po organizationId).
CREATE TABLE "reseller_assignments" (
    "id" TEXT NOT NULL,
    "resellerOrganizationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Kopia adresu operatora, który przypisał: przeżywa usunięcie jego konta (rozliczalność).
    "assignedByEmail" VARCHAR(254) NOT NULL,

    CONSTRAINT "reseller_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reseller_assignments_organizationId_key" ON "reseller_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "reseller_assignments_resellerOrganizationId_idx" ON "reseller_assignments"("resellerOrganizationId");

-- AddForeignKey
ALTER TABLE "reseller_assignments" ADD CONSTRAINT "reseller_assignments_resellerOrganizationId_fkey" FOREIGN KEY ("resellerOrganizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_assignments" ADD CONSTRAINT "reseller_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reseller nie może być sam swoim klientem (pętla w liście klientów i w metrykach).
ALTER TABLE "reseller_assignments" ADD CONSTRAINT "reseller_assignments_not_self"
  CHECK ("resellerOrganizationId" <> "organizationId");
