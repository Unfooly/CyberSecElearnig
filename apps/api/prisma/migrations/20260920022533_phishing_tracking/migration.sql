-- Śledzenie symulacji (commit 4/5): znaczniki kliknięcia i wysłania formularza, lookup po hashu tokenu,
-- złożone FK przypisań kursów.
--
-- (Wygenerowane przez `prisma migrate dev` linie DROP CONSTRAINT dla SQL-only złożonych FK
-- (users_organizationId_departmentId_fkey, phishing_*_fkey) zostały USUNIĘTE ręcznie - Prisma ich nie potrafi
-- wyrazić; patrz README, "Backlog bazy danych". Zostaje tylko wymiana FK course_assignments -> users.)

-- AlterTable
ALTER TABLE "phishing_campaign_recipients" ADD COLUMN     "clickedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- Kliknięcie wymaga wcześniejszego zajęcia (istnieje token), wysłanie formularza wymaga kliknięcia.
ALTER TABLE "phishing_campaign_recipients" ADD CONSTRAINT "phishing_campaign_recipients_tracking_check"
  CHECK (("clickedAt" IS NULL OR "tokenHash" IS NOT NULL) AND ("submittedAt" IS NULL OR "clickedAt" IS NOT NULL));

-- Przypisanie kursu: użytkownik musi należeć do TEJ SAMEJ organizacji (FK omijają RLS).
ALTER TABLE "course_assignments" DROP CONSTRAINT "course_assignments_userId_fkey";
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "users"("organizationId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Wąski wyjątek od Zasady nr 1 (piąty lookup po hashu tokenu, jak refresh_tokens): publiczny endpoint śledzenia
-- (POST /t/:token/view|submit) zna tylko token z linku, a organizację dopiero z wiersza odbiorcy. Bypass
-- app.bypass_tenant_rls dopisujemy WYŁĄCZNIE do polityki SELECT (USING) - INSERT/UPDATE/DELETE zostają
-- ograniczone do własnej organizacji, więc pod bypassem nie da się niczego zapisać ani usunąć.
-- Jedyny konsument: TenantPrismaService.runTrackingTokenLookup (sztywny findUnique po tokenHash, wąski select).
DROP POLICY "phishing_campaign_recipients_select" ON "phishing_campaign_recipients";
CREATE POLICY "phishing_campaign_recipients_select" ON "phishing_campaign_recipients" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true) OR current_setting('app.bypass_tenant_rls', true) = 'on');
