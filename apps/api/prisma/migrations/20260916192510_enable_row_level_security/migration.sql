-- Zasada nr 1 z CLAUDE.md: RLS jako druga linia obrony izolacji tenantów,
-- niezależna od filtrów `where: { organizationId }` w kodzie aplikacji.
--
-- Kontekst tenanta ustawiany jest per-transakcja przez TenantPrismaService
-- (apps/api/src/prisma/tenant-prisma.service.ts) poleceniem:
--   SELECT set_config('app.current_org_id', '<uuid>', true)
--
-- Polityka: jeśli kontekst jest ustawiony, wiersz musi należeć do tej
-- organizacji. Jeśli kontekst NIE jest ustawiony (current_setting zwraca
-- NULL), wiersze pozostają widoczne — to świadomy wyjątek wyłącznie dla
-- wąskich, ręcznie zweryfikowanych zapytań auth (login/refresh po globalnie
-- unikalnym e-mailu, gdzie organizationId nie jest jeszcze znane). Każdy
-- endpoint dotykający danych klienckich MUSI przechodzić przez
-- TenantPrismaService, żeby RLS faktycznie ograniczał dostęp — patrz README.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_users" ON "users"
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_departments" ON "departments"
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );
