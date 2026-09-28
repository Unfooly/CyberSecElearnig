-- D-112 (zadanie X, część 3): przypięte osiągnięcia i przełącznik rankingu organizacji. Addytywnie, z wartościami
-- domyślnymi dla istniejących wierszy; polityki RLS bez zmian (`users` ma RLS per organizacja; `organizations` jest globalna
-- - zapytania filtrują po id organizacji z JWT, jak dotąd).

-- Kody przypiętych osiągnięć (maks. 3, kolejność = kolejność na profilu). Walidacja (tylko zdobyte, bez duplikatów) w serwisie.
ALTER TABLE "users" ADD COLUMN "pinnedAchievements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Ranking pracowników organizacji - domyślnie włączony, admin organizacji może go wyłączyć w ustawieniach.
ALTER TABLE "organizations" ADD COLUMN "leaderboardEnabled" BOOLEAN NOT NULL DEFAULT true;
