-- Zgłoszenia (commit 3/5): dziennik zdarzeń zgłoszenia (zmiany statusu, notatki) i stan powiadomień mailowych.
--
-- (Wygenerowane przez `prisma migrate diff` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateEnum
CREATE TYPE "ThreatReportEventType" AS ENUM ('STATUS_CHANGED', 'NOTE_ADDED');

-- AlterTable
ALTER TABLE "threat_reports" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- Zgłoszenia sprzed tej migracji uznajemy za "już powiadomione" - po wdrożeniu nie wysyłamy maila o starych zgłoszeniach.
-- threat_reports ma FORCE ROW LEVEL SECURITY, a migracja nie ustawia kontekstu organizacji: rola migracji bez BYPASSRLS
-- (właściciel, nie superużytkownik - np. część konfiguracji RDS) widziałaby 0 wierszy i UPDATE po cichu nic by nie zrobił.
-- Dlatego na czas tego jednego UPDATE zdejmujemy FORCE (właściciel tabeli omija wtedy RLS) i od razu go przywracamy.
ALTER TABLE "threat_reports" NO FORCE ROW LEVEL SECURITY;
UPDATE "threat_reports" SET "notifiedAt" = "createdAt" WHERE "kind" = 'REAL' AND "notifiedAt" IS NULL;
ALTER TABLE "threat_reports" FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "threat_report_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "ThreatReportEventType" NOT NULL,
    "fromStatus" "ThreatReportStatus",
    "toStatus" "ThreatReportStatus",
    "note" VARCHAR(1000),
    "actorUserId" TEXT,
    "actorEmail" VARCHAR(254) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_report_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threat_report_notification_state" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threat_report_notification_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "threat_report_events_organizationId_reportId_createdAt_idx" ON "threat_report_events"("organizationId", "reportId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "threat_report_notification_state_organizationId_key" ON "threat_report_notification_state"("organizationId");

-- CreateIndex
CREATE INDEX "threat_reports_organizationId_kind_notifiedAt_idx" ON "threat_reports"("organizationId", "kind", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "threat_reports_organizationId_id_key" ON "threat_reports"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "threat_report_events" ADD CONSTRAINT "threat_report_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threat_report_events" ADD CONSTRAINT "threat_report_events_organizationId_reportId_fkey" FOREIGN KEY ("organizationId", "reportId") REFERENCES "threat_reports"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threat_report_notification_state" ADD CONSTRAINT "threat_report_notification_state_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only złożone FK: autor zdarzenia musi należeć do TEJ SAMEJ organizacji (FK omijają RLS); usunięcie konta zeruje wyłącznie
-- actorUserId (PG15+), zdarzenie i kopia e-maila zostają.
ALTER TABLE "threat_report_events" ADD CONSTRAINT "threat_report_events_organizationId_actorUserId_fkey"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("actorUserId") ON UPDATE NO ACTION;

-- Zmiana statusu ma nowy status; zdarzenie notatki nie ma statusów. (Treść notatki bywa NULL po retencji, więc nie jest wymagana.)
ALTER TABLE "threat_report_events" ADD CONSTRAINT "threat_report_events_shape_check"
  CHECK (("type" = 'STATUS_CHANGED' AND "toStatus" IS NOT NULL AND "note" IS NULL)
      OR ("type" = 'NOTE_ADDED' AND "fromStatus" IS NULL AND "toStatus" IS NULL));

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Dziennik: odczyt i dopisywanie; UPDATE wyłącznie kolumny "note" (retencja
-- czyści treść notatek po 90 dniach razem z treścią zgłoszenia) - nie da się zmienić autora, czasu ani statusów. Bez DELETE.
ALTER TABLE "threat_report_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "threat_report_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "threat_report_events_select" ON "threat_report_events" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_report_events_insert" ON "threat_report_events" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_report_events_update" ON "threat_report_events" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "threat_report_events" FROM "cyberszkolo_app";
GRANT UPDATE ("note") ON TABLE "threat_report_events" TO "cyberszkolo_app";

-- Stan powiadomień: odczyt, wstawienie i aktualizacja w obrębie organizacji; bez DELETE.
ALTER TABLE "threat_report_notification_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "threat_report_notification_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY "threat_report_notification_state_select" ON "threat_report_notification_state" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_report_notification_state_insert" ON "threat_report_notification_state" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "threat_report_notification_state_update" ON "threat_report_notification_state" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
REVOKE DELETE, TRUNCATE ON TABLE "threat_report_notification_state" FROM "cyberszkolo_app";
