-- D-202: trzy osiągnięcia w katalogu `badges` (globalny, bez RLS - jak `courses`): „Najpierw pytam IT” (moduł 4 „Shadow IT” na 100%),
-- „Trzy sprawy” (trzy różne ukończone szkolenia) i „Komplet” (wszystkie szkolenia z katalogu). Tylko wpisy katalogu - bez zmian schematu
-- i bez danych użytkowników. Idempotentnie po `code` (jak 20260929200100_module2_achievements).
--
-- Przyznanie (także wsteczne - kto już spełnił warunek) robi serwis w kontekście organizacji użytkownika (GamificationService,
-- ACHIEVEMENTS_SYNC_VERSION 4) - `user_badges` ma FORCE RLS bez wyjątku bypass, więc backfill nie może iść z migracji.
--
-- Odwracalność: `UPDATE "badges" SET "retiredAt" = now() WHERE "code" IN ('ask-it-first', 'three-cases', 'all-cases')` (wycofanie bez
-- utraty zdobytych wpisów); `DELETE` kasuje też zdobyte wpisy `user_badges` (kaskada), a XP przyznane za nie zostaje w `users.xp`.

INSERT INTO "badges" ("id", "code", "title", "description", "icon", "lockedIcon", "xpReward", "rank", "hidden", "scope", "moduleSlug", "conditionText", "sortOrder")
VALUES
  (gen_random_uuid()::text, 'ask-it-first', 'Najpierw pytam IT', 'Każde narzędzie do pracy najpierw przez IT. Ani jednej drogi na skróty.',
   'osiagniecie-najpierw-pytam-it', 'osiagniecie-najpierw-pytam-it-zablokowane', 50, 'LEGENDARY', false, 'MODULE', 'na-skroty',
   'Odpowiedz dobrze za pierwszym razem na wszystkie pytania w jednym podejściu do sprawy „Shadow IT”.', 8),
  (gen_random_uuid()::text, 'three-cases', 'Trzy sprawy', 'Trzy zamknięte sprawy. Wiesz już, jak działają przestępcy.',
   'osiagniecie-trzy-sprawy', 'osiagniecie-trzy-sprawy-zablokowane', 50, 'MILESTONE', false, 'GLOBAL', NULL,
   'Ukończ trzy różne szkolenia.', 9),
  (gen_random_uuid()::text, 'all-cases', 'Komplet', 'Wszystkie sprawy zamknięte. Żadna sztuczka Cię już nie zaskoczy.',
   'osiagniecie-komplet', 'osiagniecie-komplet-zablokowane', 100, 'LEGENDARY', false, 'GLOBAL', NULL,
   'Ukończ wszystkie szkolenia z katalogu.', 10)
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
