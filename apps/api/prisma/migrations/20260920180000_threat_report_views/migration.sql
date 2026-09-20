-- Zgłoszenia: dziennik wglądów ORG_ADMIN w szczegóły zgłoszenia (kto, kiedy, które zgłoszenie) - decyzja właściciela produktu.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateTable
CREATE TABLE "threat_report_views" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" VARCHAR(254) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_report_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "threat_report_views_organizationId_reportId_createdAt_idx" ON "threat_report_views"("organizationId", "reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "threat_report_views" ADD CONSTRAINT "threat_report_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threat_report_views" ADD CONSTRAINT "threat_report_views_organizationId_reportId_fkey" FOREIGN KEY ("organizationId", "reportId") REFERENCES "threat_reports"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- SQL-only złożone FK: autor wglądu musi należeć do TEJ SAMEJ organizacji (FK omijają RLS); usunięcie konta zeruje wyłącznie
-- actorUserId (PG15+), wpis i kopia e-maila zostają.
ALTER TABLE "threat_report_views" ADD CONSTRAINT "threat_report_views_organizationId_actorUserId_fkey"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("actorUserId") ON UPDATE NO ACTION;

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Dziennik: tylko odczyt i dopisywanie - rola aplikacji nie może zmienić ani usunąć wpisu.
ALTER TABLE "threat_report_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "threat_report_views" FORCE ROW LEVEL SECURITY;
CREATE POLICY "threat_report_views_select" ON "threat_report_views" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_report_views_insert" ON "threat_report_views" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "threat_report_views" FROM "cyberszkolo_app";
