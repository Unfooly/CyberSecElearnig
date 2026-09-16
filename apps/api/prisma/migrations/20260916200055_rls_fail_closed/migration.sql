-- Zasada nr 1 (CLAUDE.md): RLS jako druga linia obrony musi być fail-closed.
--
-- Poprzednia polityka (20260916192510_enable_row_level_security) przepuszczała
-- WSZYSTKIE wiersze, gdy kontekst app.current_org_id nie był ustawiony. To
-- odwracało sens "drugiej linii obrony": dokładnie scenariusz, przed którym
-- RLS miał chronić (developer pominął TenantPrismaService, zapomniał
-- where: organizationId) nie był łapany — brak kontekstu = pełny dostęp.
--
-- Nowa polityka: brak kontekstu = zero wierszy. Jedyny świadomy wyjątek to
-- wąska ścieżka auth (login/refresh po globalnie unikalnym e-mailu, zanim
-- organizationId jest znane) — realizowana przez jawny, osobny sentinel
-- app.bypass_tenant_rls, ustawiany WYŁĄCZNIE przez
-- TenantPrismaService.runAuthLookup (apps/api/src/prisma/tenant-prisma.service.ts)
-- i używany tylko w AuthService.login / AuthService.refresh.

DROP POLICY "tenant_isolation_users" ON "users";
CREATE POLICY "tenant_isolation_users" ON "users"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  );

DROP POLICY "tenant_isolation_departments" ON "departments";
CREATE POLICY "tenant_isolation_departments" ON "departments"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  );
