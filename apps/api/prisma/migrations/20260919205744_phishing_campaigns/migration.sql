-- CreateEnum
CREATE TYPE "PhishingCampaignStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhishingAudienceType" AS ENUM ('ALL', 'DEPARTMENTS', 'USERS');

-- Kampanie symulacji phishingowych (commit 3/5).
--
-- (Wygenerowane przez `prisma migrate dev` linie DROP CONSTRAINT dla SQL-only złożonych FK
-- (users_organizationId_departmentId_fkey, phishing_template_edits_*) zostały USUNIĘTE ręcznie -
-- Prisma ich nie potrafi wyrazić; patrz README, "Backlog bazy danych".)

-- CreateTable
CREATE TABLE "phishing_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "PhishingCampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
    "audienceType" "PhishingAudienceType" NOT NULL,
    "templateId" TEXT,
    "templateName" VARCHAR(120) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "lessonHtml" TEXT NOT NULL,
    "senderName" VARCHAR(80) NOT NULL,
    "senderLocalPart" VARCHAR(64) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdByEmail" VARCHAR(254) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "phishing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phishing_campaign_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "departmentName" VARCHAR(255),
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" VARCHAR(40),
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" VARCHAR(200),
    "tokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phishing_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phishing_campaigns_organizationId_createdAt_idx" ON "phishing_campaigns"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "phishing_campaigns_status_windowEnd_idx" ON "phishing_campaigns"("status", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "phishing_campaigns_organizationId_id_key" ON "phishing_campaigns"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phishing_campaign_recipients_tokenHash_key" ON "phishing_campaign_recipients"("tokenHash");

-- CreateIndex
CREATE INDEX "phishing_campaign_recipients_organizationId_idx" ON "phishing_campaign_recipients"("organizationId");

-- CreateIndex
CREATE INDEX "phishing_campaign_recipients_campaignId_idx" ON "phishing_campaign_recipients"("campaignId");

-- CreateIndex
CREATE INDEX "phishing_campaign_recipients_scheduledAt_idx" ON "phishing_campaign_recipients"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "phishing_campaign_recipients_campaignId_userId_key" ON "phishing_campaign_recipients"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "phishing_campaigns" ADD CONSTRAINT "phishing_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_organizationId_campaignId_fkey" FOREIGN KEY ("organizationId", "campaignId") REFERENCES "phishing_campaigns"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- SQL-only złożone FK (Prisma ich nie wyraża): pracownik musi należeć do TEJ SAMEJ organizacji (FK omijają
-- RLS, więc bez tego kampania mogłaby wskazać użytkownika cudzej organizacji), a jego usunięcie zeruje
-- WYŁĄCZNIE kolumnę userId (nie organizationId - PG15+). Wyniki kampanii przeżywają usunięcie pracownika.
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_organizationId_userId_fkey"
  FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("userId") ON UPDATE NO ACTION;
ALTER TABLE "phishing_campaigns" ADD CONSTRAINT "phishing_campaigns_organizationId_createdByUserId_fkey"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE SET NULL ("createdByUserId") ON UPDATE NO ACTION;

-- Niezmienniki na poziomie bazy (obrona w głąb dla "co najwyżej raz").
ALTER TABLE "phishing_campaigns" ADD CONSTRAINT "phishing_campaigns_window_check" CHECK ("windowEnd" > "windowStart");
-- Wynik końcowy jest jeden: wysłano albo nieudane, nigdy oba; failedAt <=> failureCode.
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_single_outcome_check"
  CHECK (NOT ("sentAt" IS NOT NULL AND "failedAt" IS NOT NULL) AND (("failedAt" IS NULL) = ("failureCode" IS NULL)));
-- Wysłana wiadomość musi być wcześniej zajęta (claimedAt) i mieć token.
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_sent_claimed_check"
  CHECK ("sentAt" IS NULL OR ("claimedAt" IS NOT NULL AND "tokenHash" IS NOT NULL));
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_attempts_check" CHECK ("sendAttempts" >= 0);

-- RLS (Zasada nr 1), FORCE, fail-closed: brak app.current_org_id = zero wierszy. Polityki PER KOMENDA:
-- INSERT/UPDATE/DELETE wyłącznie własna organizacja (DELETE sprawdza tylko USING, więc USING dla zapisu
-- NIE zawiera bypassu). phishing_campaigns: SELECT dodatkowo pod bypassem app.bypass_tenant_rls - wyłącznie
-- dla joba uzgadniającego (CampaignReconcileService), który przez TenantPrismaService.runCrossOrgQuery
-- odczytuje id/organizationId AKTYWNYCH kampanii, żeby potem pracować w kontekście każdej organizacji.
-- phishing_campaign_recipients: ścisła izolacja, bez bypassu.
ALTER TABLE "phishing_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY "phishing_campaigns_select" ON "phishing_campaigns" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true) OR current_setting('app.bypass_tenant_rls', true) = 'on');
CREATE POLICY "phishing_campaigns_insert" ON "phishing_campaigns" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_campaigns_update" ON "phishing_campaigns" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_campaigns_delete" ON "phishing_campaigns" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "phishing_campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phishing_campaign_recipients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "phishing_campaign_recipients_select" ON "phishing_campaign_recipients" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_campaign_recipients_insert" ON "phishing_campaign_recipients" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_campaign_recipients_update" ON "phishing_campaign_recipients" FOR UPDATE
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "phishing_campaign_recipients_delete" ON "phishing_campaign_recipients" FOR DELETE
  USING ("organizationId" = current_setting('app.current_org_id', true));
