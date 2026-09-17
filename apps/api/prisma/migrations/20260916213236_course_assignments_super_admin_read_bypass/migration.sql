-- Wąski wyjątek od Zasady nr 1 (CLAUDE.md) dla panelu operacyjnego
-- SUPER_ADMIN (GET /dashboard/admin/organizations) — jedyny endpoint w
-- projekcie, który świadomie czyta dane wielu organizacji naraz. Ustawiany
-- WYŁĄCZNIE przez TenantPrismaService.runCrossOrgQuery
-- (apps/api/src/prisma/tenant-prisma.service.ts), do niczego innego.
--
-- W przeciwieństwie do analogicznego wyjątku na users/departments (który
-- obejmuje też WITH CHECK, bo login/refresh tam nic nie zapisuje poza
-- kontekstem organizacji), tu bypass dotyczy TYLKO klauzuli USING
-- (widoczność przy odczycie). WITH CHECK zostaje bez zmian — nawet gdyby
-- ktoś pomyłkowo użył tego samego sentinela w ścieżce zapisu do
-- course_assignments, nie da się nim zapisać wiersza w cudzej organizacji.

DROP POLICY "tenant_isolation_course_assignments" ON "course_assignments";
CREATE POLICY "tenant_isolation_course_assignments" ON "course_assignments"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR current_setting('app.bypass_tenant_rls', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
