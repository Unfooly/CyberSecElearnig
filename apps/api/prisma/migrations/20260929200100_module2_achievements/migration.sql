-- D-124 (moduł 2, faza 1f), część 2 z 2: cztery osiągnięcia sprawy „Głos z helpdesku” w katalogu `badges` (globalny, bez RLS - jak
-- `courses`). Tylko wpisy katalogu - bez zmian schematu i bez danych użytkowników. Idempotentnie po `code` (jak 20260928200000_achievements).
--
-- Przyznanie (także wsteczne - kto już spełnił warunek) robi serwis w kontekście organizacji użytkownika (GamificationService,
-- ACHIEVEMENTS_SYNC_VERSION 2) - `user_badges` ma FORCE RLS bez wyjątku bypass, więc backfill nie może iść z migracji.
-- Off the Record: tajne, bez XP i bez wpływu na wynik (jak easter egg, D-100/D-111; warunek z D-120).
--
-- Odwracalność: `DELETE FROM "badges" WHERE "code" IN ('dead-air', 'perfect-pitch', 'full-transcript', 'off-the-record')` - kasuje też
-- zdobyte wpisy `user_badges` (kaskada); XP przyznane za nie zostaje w `users.xp`. Bezpieczniej wycofać przez `retiredAt` (jak stare odznaki).

INSERT INTO "badges" ("id", "code", "title", "description", "icon", "lockedIcon", "xpReward", "rank", "hidden", "scope", "moduleSlug", "conditionText", "sortOrder")
VALUES
  (gen_random_uuid()::text, 'dead-air', 'Dead Air', 'Rozłączyłeś się, zanim oszust zdążył cokolwiek wyciągnąć.',
   'osiagniecie-cisza-na-linii', 'osiagniecie-cisza-na-linii-zablokowane', 25, 'RARE', false, 'MODULE', 'glos-z-helpdesku',
   'W rozmowie na żywo w sprawie „Głos z helpdesku” zakończ rozmowę dobrze w najwyżej trzech odpowiedziach, nie podając niczego.', 4),
  (gen_random_uuid()::text, 'perfect-pitch', 'Perfect Pitch', 'Wyłapałeś każdą manipulację. Bez jednego fałszywego alarmu.',
   'osiagniecie-czysty-odsluch', 'osiagniecie-czysty-odsluch-zablokowane', 25, 'RARE', false, 'MODULE', 'glos-z-helpdesku',
   'W odsłuchu nagrania w sprawie „Głos z helpdesku” zaznacz wszystkie czerwone flagi bez żadnego fałszywego alarmu.', 5),
  (gen_random_uuid()::text, 'full-transcript', 'Full Transcript', 'Cała rozmowa rozpisana co do słowa. Sprawa bez luk.',
   'osiagniecie-pelny-zapis', 'osiagniecie-pelny-zapis-zablokowane', 50, 'LEGENDARY', false, 'MODULE', 'glos-z-helpdesku',
   'Zbierz wszystkie dowody (także ukryte) i zdobądź 100% za zadania w jednym podejściu do sprawy „Głos z helpdesku”.', 6),
  (gen_random_uuid()::text, 'off-the-record', 'Off the Record', 'Wysłuchałeś webinaru do końca i usłyszałeś to, czego nie powinno tam być.',
   'osiagniecie-off-the-record', 'osiagniecie-tajne-zablokowane', 0, 'SECRET', true, 'MODULE', 'glos-z-helpdesku',
   'Wysłuchaj do końca webinaru na stronie firmy w sprawie „Głos z helpdesku”.', 7)
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
