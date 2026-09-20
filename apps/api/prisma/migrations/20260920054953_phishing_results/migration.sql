-- Wyniki symulacji (commit 5/5): ustawienia widoczności wyników osobowych i dziennik dostępu.
--
-- (Wygenerowane przez `prisma migrate dev` linie DROP CONSTRAINT dla SQL-only złożonych FK zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateEnum
CREATE TYPE "PhishingVisibilityAction" AS ENUM ('ENABLED', 'DISABLED', 'VIEWED', 'EXPORTED');

-- CreateTable
CREATE TABLE "phishing_result_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personalResultsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "justification" VARCHAR(500),
    "changedByEmail" VARCHAR(254) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phishing_result_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phishing_result_visibility_audit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" "PhishingVisibilityAction" NOT NULL,
    "justification" VARCHAR(500),
    "campaignId" TEXT,
    "filter" VARCHAR(20),
    "rowCount" INTEGER,
    "actorUserId" TEXT,
    "actorEmail" VARCHAR(254) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phishing_result_visibility_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phishing_result_settings_organizationId_key" ON "phishing_result_settings"("organizationId");

-- CreateIndex
CREATE INDEX "phishing_result_visibility_audit_organizationId_createdAt_idx" ON "phishing_result_visibility_audit"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "phishing_result_settings" ADD CONSTRAINT "phishing_result_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phishing_result_visibility_audit" ADD CONSTRAINT "phishing_result_visibility_audit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only złożone FK: aktor musi należeć do TEJ SAMEJ organizacji (FK omijają RLS); usunięcie konta zeruje wyłącznie
-- actorUserId (PG15+), wiersz audytu i kopia e-maila zostają.
ALTER TABLE "phishing_result_visibility_audit" ADD CONSTRAINT "phishing_result_visibility_audit_organizationId_actorUserId_fkey"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("actorUserId") ON UPDATE NO ACTION;

-- Włączenie wyników osobowych wymaga uzasadnienia (min. 20 znaków po obcięciu spacji) - w ustawieniach i w audycie.
-- COALESCE jest konieczne: CHECK z wartością NULL przechodzi, więc samo char_length(NULL) >= 20 przepuściłoby brak uzasadnienia.
ALTER TABLE "phishing_result_settings" ADD CONSTRAINT "phishing_result_settings_justification_check"
  CHECK ("personalResultsEnabled" = false OR COALESCE(char_length(btrim("justification")), 0) >= 20);
ALTER TABLE "phishing_result_visibility_audit" ADD CONSTRAINT "phishing_result_visibility_audit_justification_check"
  CHECK ("action" <> 'ENABLED' OR COALESCE(char_length(btrim("justification")), 0) >= 20);

-- RLS (Zasada nr 1), FORCE, fail-closed; bez bypassu. Polityki per komenda (USING nie szersze niż WITH CHECK).
ALTER TABLE "phishing_result_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_result_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "phishing_result_settings_select" ON "phishing_result_settings" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_result_settings_insert" ON "phishing_result_settings" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_result_settings_update" ON "phishing_result_settings" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_result_settings_delete" ON "phishing_result_settings" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- Dziennik: tylko odczyt i dopisywanie (jak phishing_template_edits) - rola aplikacji nie może zmienić ani usunąć wpisu.
ALTER TABLE "phishing_result_visibility_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_result_visibility_audit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "phishing_result_visibility_audit_select" ON "phishing_result_visibility_audit" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_result_visibility_audit_insert" ON "phishing_result_visibility_audit" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "phishing_result_visibility_audit" FROM "cyberszkolo_app";
