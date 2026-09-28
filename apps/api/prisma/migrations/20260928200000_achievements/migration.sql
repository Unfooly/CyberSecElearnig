-- D-111 (zadanie X, część 2): osiągnięcia zamiast dotychczasowych pięciu odznak. Rozszerza istniejący katalog `badges`
-- (globalny, bez organizationId i bez RLS - jak `courses`) i istniejące `user_badges` (RLS per organizacja, bez zmian).
--
-- (1) Nowe kolumny katalogu: ranga, tajność, zakres (moduł / globalne), grafika zablokowana, warunek do UI, kolejność,
--     data wycofania. Addytywnie: istniejące wiersze dostają wartości domyślne.
-- (2) Stare odznaki (FIRST_STEP, PERFECT_SCORE, KNOWLEDGE_HUNTER, PHISHING_SPOTTER, SPEED_DEMON) są WYCOFANE (`retiredAt`):
--     znikają z UI, ale zdobyte wiersze `user_badges` i przyznane XP zostają (decyzja właściciela).
-- (3) Trzy osiągnięcia wstawia TA migracja (idempotentnie po `code`), nie seed: `seed:badges` nie jest częścią wdrożenia,
--     a przyznawanie w kodzie (GamificationService) po cichu pomija nieistniejący wpis katalogu.
-- Backfill (kto już spełnia warunek - także wyróżnienie easter egga z Q) NIE jest w tej migracji: `user_badges` ma FORCE RLS
-- bez wyjątku bypass, więc przyznanie wsteczne robi serwis per użytkownik w jego kontekście organizacji
-- (GamificationService.syncAchievements, idempotentnie) - bez nowego wyjątku od Zasady nr 1.

-- CreateEnum
CREATE TYPE "AchievementRank" AS ENUM ('SECRET', 'LEGENDARY', 'MILESTONE');

-- CreateEnum
CREATE TYPE "AchievementScope" AS ENUM ('MODULE', 'GLOBAL');

-- AlterTable
ALTER TABLE "badges" ADD COLUMN "lockedIcon" TEXT,
ADD COLUMN "rank" "AchievementRank",
ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "scope" "AchievementScope" NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN "moduleSlug" TEXT,
ADD COLUMN "conditionText" TEXT,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retiredAt" TIMESTAMP(3);

-- Stare odznaki: wycofane (bez usuwania - zdobyte wiersze zostają).
UPDATE "badges" SET "retiredAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('FIRST_STEP', 'PERFECT_SCORE', 'KNOWLEDGE_HUNTER', 'PHISHING_SPOTTER', 'SPEED_DEMON') AND "retiredAt" IS NULL;

-- Katalog osiągnięć (nazwy i rangi po angielsku jak na grafikach, opisy i warunki po polsku).
INSERT INTO "badges" ("id", "code", "title", "description", "icon", "lockedIcon", "xpReward", "rank", "hidden", "scope", "moduleSlug", "conditionText", "sortOrder")
VALUES
  (gen_random_uuid()::text, 'first-case-closed', 'First Case Closed', 'Twoja pierwsza zamknięta sprawa.',
   'osiagniecie-pierwsza-sprawa', 'osiagniecie-pierwsza-sprawa-zablokowane', 50, 'MILESTONE', false, 'GLOBAL', NULL,
   'Ukończ dowolne szkolenie.', 1),
  (gen_random_uuid()::text, 'flawless-case', 'Flawless Case', 'Zamknąłeś sprawę bez jednego przeoczonego śladu.',
   'osiagniecie-perfekcyjne-sledztwo', 'osiagniecie-perfekcyjne-sledztwo-zablokowane', 50, 'LEGENDARY', false, 'MODULE', 'wyludzone-haslo',
   'Zbierz wszystkie dowody (23/23) i zdobądź 100% za zadania w jednym podejściu do sprawy „Wyłudzone hasło”.', 2),
  (gen_random_uuid()::text, 'curious-detective', 'Curious Detective', 'Otworzyłeś podejrzaną grę na pulpicie Anny. Na szczęście tylko w ćwiczeniu.',
   'osiagniecie-ciekawski-detektyw', 'osiagniecie-ciekawski-detektyw-zablokowane', 0, 'SECRET', true, 'MODULE', 'wyludzone-haslo',
   'Otwórz podejrzaną grę na pulpicie Anny w sprawie „Wyłudzone hasło”.', 3)
ON CONFLICT ("code") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "lockedIcon" = EXCLUDED."lockedIcon",
  "xpReward" = EXCLUDED."xpReward",
  "rank" = EXCLUDED."rank",
  "hidden" = EXCLUDED."hidden",
  "scope" = EXCLUDED."scope",
  "moduleSlug" = EXCLUDED."moduleSlug",
  "conditionText" = EXCLUDED."conditionText",
  "sortOrder" = EXCLUDED."sortOrder",
  "retiredAt" = NULL;
