-- Osobny sentinel dla lookupu tokenu śledzenia (poprawka do 20260920022533_phishing_tracking).
--
-- Poprzednia polityka SELECT używała wspólnego sentinela app.bypass_tenant_rls, więc KAŻDY kod wołający
-- TenantPrismaService.runCrossOrgQuery (dashboard SUPER_ADMIN, sprzątanie refresh tokenów) zyskiwał odczyt odbiorców
-- kampanii wszystkich organizacji (tokenHash, clickedAt, submittedAt) - wyniki behawioralne pracowników. Teraz polityka
-- SELECT honoruje WYŁĄCZNIE app.bypass_tracking_lookup, ustawiany tylko przez TenantPrismaService.runTrackingTokenLookup
-- (sztywny findUnique po tokenHash, wąski select). runCrossOrgQuery nie widzi odbiorców. Bypass nadal tylko w SELECT
-- (INSERT/UPDATE/DELETE bez bypassu).
DROP POLICY "phishing_campaign_recipients_select" ON "phishing_campaign_recipients";
CREATE POLICY "phishing_campaign_recipients_select" ON "phishing_campaign_recipients" FOR SELECT
  USING ("organizationId" = current_setting('app.current_org_id', true) OR current_setting('app.bypass_tracking_lookup', true) = 'on');
