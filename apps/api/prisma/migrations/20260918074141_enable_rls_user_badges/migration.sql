-- RLS dla user_badges (Zasada nr 1, CLAUDE.md) — fail-closed od razu (brak
-- kontekstu app.current_org_id = zero wierszy), dokładnie jak
-- course_assignments. Bez wyjątku app.bypass_tenant_rls — w przeciwieństwie
-- do users/password_reset_tokens, nie ma tu żadnej ścieżki, która musiałaby
-- odnaleźć wiersz PRZED poznaniem organizationId (odznaki zawsze
-- przyznawane/odczytywane w kontekście zalogowanego, znanego usera z JWT).
--
-- badges celowo BEZ RLS — to globalny katalog definicji odznak (jak
-- courses), nie dane per-tenant, brak kolumny organizationId.

ALTER TABLE "user_badges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_badges" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_user_badges" ON "user_badges"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
  );
