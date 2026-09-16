-- RLS dla course_assignments (Zasada nr 1, CLAUDE.md) — fail-closed od razu
-- (brak kontekstu app.current_org_id = zero wierszy), tak jak users/
-- departments po naprawie z *_rls_fail_closed. W przeciwieństwie do users,
-- tu NIE MA wyjątku app.bypass_tenant_rls — nie istnieje żadna wąska,
-- ręcznie zweryfikowana ścieżka (analogiczna do login/refresh), która
-- musiałaby czytać course_assignments bez znanego organizationId. Każde
-- zapytanie musi iść przez TenantPrismaService.runInOrgContext.
--
-- courses celowo BEZ RLS — to globalny katalog treści (jak organizations),
-- nie dane per-tenant, brak kolumny organizationId.
--
-- Grant dla cyberszkolo_app nie wymaga osobnej migracji — obejmuje go
-- ALTER DEFAULT PRIVILEGES z *_grant_app_role_privileges dla wszystkich
-- tabel tworzonych przez rolę cyberszkolo.

ALTER TABLE "course_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_course_assignments" ON "course_assignments"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
