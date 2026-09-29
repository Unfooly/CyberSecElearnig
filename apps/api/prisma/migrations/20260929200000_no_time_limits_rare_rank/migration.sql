-- D-124 (moduł 2, fazy 1e i 1f), część 1 z 2: kolumna ustawienia dostępności i nowa ranga osiągnięć. Addytywnie, bez przepisywania danych.
--
-- (1) `users.noTimeLimits` (WCAG 2.2.1): „Bez limitów czasu” w rozmowie na żywo (LIVE_CALL). Domyślnie false - dotychczasowe konta
--     zachowują się jak dziś (limit działa, gracz może go wyłączyć przełącznikiem przed połączeniem). `users` ma już RLS - kolumna
--     polityk nie zmienia.
-- (2) Ranga `RARE` w enumie `AchievementRank` (osiągnięcia Dead Air i Perfect Pitch). Nowej wartości enuma Postgres nie pozwala użyć w tej
--     samej transakcji, w której ją dodano, więc wpisy katalogu z tą rangą wstawia osobna, następna migracja
--     (20260929200100_module2_achievements).
--
-- Odwracalność: kolumnę można usunąć (`ALTER TABLE "users" DROP COLUMN "noTimeLimits"`) - traci się tylko ustawienia użytkowników.
-- Wartości enuma Postgres nie usuwa wprost: cofnięcie wymaga wcześniejszego usunięcia wpisów z rangą RARE i odtworzenia typu bez niej.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "noTimeLimits" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum
ALTER TYPE "AchievementRank" ADD VALUE 'RARE';
