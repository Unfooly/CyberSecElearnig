-- RLS dla password_reset_tokens (Zasada nr 1, CLAUDE.md) — fail-closed od
-- razu (brak kontekstu app.current_org_id = zero wierszy), jak
-- course_assignments. Bypass app.bypass_tenant_rls jest potrzebny, bo
-- /auth/reset-password musi odnaleźć rekord po globalnie unikalnym
-- tokenHash, ZANIM zna organizationId (dokładnie ten sam powód co
-- login/refresh po e-mailu) — jedyny konsument to
-- TenantPrismaService.runPasswordResetTokenLookup, wołany wyłącznie z
-- AuthService.resetPassword.
--
-- Zgodnie z późniejszą, bardziej defensywną wersją tego wzorca
-- (course_assignments_super_admin_read_bypass) bypass obejmuje TYLKO
-- klauzulę USING (odczyt). WITH CHECK (zapis) zostaje bez bypassu —
-- runPasswordResetTokenLookup i tak nigdy nie zapisuje, ale gdyby ktoś
-- kiedyś pomyłkowo spróbował zapisać pod bypass_tenant_rls, nie da się
-- tym zapisać wiersza w cudzej organizacji.

ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_password_reset_tokens" ON "password_reset_tokens"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
