-- Wersja 1 (format sprzed silnika scen: bloki bez `id`) dla kursów, które już istnieją. Dzięki temu przypisanie rozpoczęte przed
-- migracją (courseVersionId = NULL) rozwiązuje się do WERSJI 1 (najniższej), nawet gdy później import doda nowszą wersję kursu.
-- course_versions jest globalne (bez RLS), więc tę część można wykonać w migracji; samych przypisań (FORCE RLS) nie ruszamy.
-- Skrót ma prefiks "legacy:" (md5 jsonb) i nie jest zgodny z hashContent z packages/content - używany tylko do unikalności.
INSERT INTO "course_versions" ("id", "courseId", "version", "schemaVersion", "contentHash", "contentBlocks", "blockCount")
SELECT
  'legacy_' || c."id",
  c."id",
  1,
  1,
  'legacy:' || md5(c."contentBlocks"::text),
  c."contentBlocks",
  CASE WHEN jsonb_typeof(c."contentBlocks") = 'array' THEN jsonb_array_length(c."contentBlocks") ELSE 0 END
FROM "courses" c
ON CONFLICT DO NOTHING;
