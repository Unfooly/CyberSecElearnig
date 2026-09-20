-- Zgłaszanie podejrzanych wiadomości (commit 1/5 modułu zgłoszeń): tabela threat_reports i znacznik reportedAt odbiorcy.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateEnum
CREATE TYPE "ThreatReportKind" AS ENUM ('SIMULATION', 'REAL');

-- CreateEnum
CREATE TYPE "ThreatReportStatus" AS ENUM ('NEW', 'IN_REVIEW', 'THREAT', 'SAFE');

-- CreateEnum
CREATE TYPE "ThreatReportMatchMethod" AS ENUM ('TOKEN', 'SENDER_SUBJECT');

-- AlterTable
ALTER TABLE "phishing_campaign_recipients" ADD COLUMN     "reportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "threat_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reporterDepartmentId" TEXT,
    "kind" "ThreatReportKind" NOT NULL,
    "status" "ThreatReportStatus" NOT NULL DEFAULT 'NEW',
    "senderText" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "body" TEXT,
    "headers" TEXT,
    "comment" VARCHAR(1000),
    "matchedRecipientId" TEXT,
    "matchMethod" "ThreatReportMatchMethod",
    "contentPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "threat_reports_organizationId_createdAt_idx" ON "threat_reports"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "threat_reports_organizationId_reporterUserId_createdAt_idx" ON "threat_reports"("organizationId", "reporterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "threat_reports_organizationId_kind_status_idx" ON "threat_reports"("organizationId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "phishing_campaign_recipients_organizationId_id_key" ON "phishing_campaign_recipients"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only złożone FK (FK omijają RLS, więc wymuszamy TĘ SAMĄ organizację): zgłaszający, jego dział i dopasowany odbiorca.
-- Usunięcie konta / działu / odbiorcy zeruje wyłącznie tę jedną kolumnę (PG15+), zgłoszenie zostaje.
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_organizationId_reporterUserId_fkey"
  FOREIGN KEY ("organizationId", "reporterUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("reporterUserId") ON UPDATE NO ACTION;
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_organizationId_reporterDepartmentId_fkey"
  FOREIGN KEY ("organizationId", "reporterDepartmentId") REFERENCES "departments"("organizationId", "id") ON DELETE SET NULL ("reporterDepartmentId") ON UPDATE NO ACTION;
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_organizationId_matchedRecipientId_fkey"
  FOREIGN KEY ("organizationId", "matchedRecipientId") REFERENCES "phishing_campaign_recipients"("organizationId", "id") ON DELETE SET NULL ("matchedRecipientId") ON UPDATE NO ACTION;

-- Zgłoszenie dopasowane do symulacji NIGDY nie przechowuje treści (body, headers, comment) - gwarancja na poziomie bazy,
-- nie tylko kodu. Tryb dopasowania jest ustawiony wtedy i tylko wtedy, gdy zgłoszenie jest symulacyjne.
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_simulation_no_content_check"
  CHECK ("kind" = 'REAL' OR ("body" IS NULL AND "headers" IS NULL AND "comment" IS NULL));
ALTER TABLE "threat_reports" ADD CONSTRAINT "threat_reports_match_method_check"
  CHECK (("kind" = 'SIMULATION') = ("matchMethod" IS NOT NULL));

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Polityki per komenda. Brak polityki DELETE: rola aplikacji nie usuwa
-- zgłoszeń (usunięcie organizacji działa kaskadą FK, która omija RLS); treść czyści retencja przez UPDATE.
ALTER TABLE "threat_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "threat_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "threat_reports_select" ON "threat_reports" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_reports_insert" ON "threat_reports" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_reports_update" ON "threat_reports" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
REVOKE DELETE, TRUNCATE ON TABLE "threat_reports" FROM "cyberszkolo_app";
