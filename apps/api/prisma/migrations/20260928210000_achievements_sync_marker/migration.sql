-- D-111, poprawki z review (zadanie X, część 2):
-- (1) Znacznik przyznania wstecznego per użytkownik: backfill (GamificationService.syncAchievements) biegnie raz na wersję
--     zasad (ACHIEVEMENTS_SYNC_VERSION), nie przy każdym wejściu na profil. `users` ma już RLS - kolumna polityk nie zmienia.
-- (2) Grafika zablokowanego TAJNEGO osiągnięcia ma neutralną nazwę pliku: idzie do klienta przed zdobyciem, a dawna nazwa
--     (osiagniecie-ciekawski-detektyw-zablokowane) zdradzała, co to za osiągnięcie.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "achievementsSyncVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "badges" SET "lockedIcon" = 'osiagniecie-tajne-zablokowane' WHERE "code" = 'curious-detective';
