-- Język szkoleń (D-133, i18n-1): ustawienie konta (NULL = wg przeglądarki, potem EN), języki, w których wersja kursu jest kompletna
-- (module.json `locales`), i tytuł modułu ze wszystkimi językami. Addytywnie: istniejące wersje (moduły 1 i 2) dostają ['pl'] i tytuł NULL
-- (tytuł z `courses.title`), konta - NULL.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "contentLocale" VARCHAR(8);

-- AlterTable
ALTER TABLE "course_versions" ADD COLUMN     "locales" TEXT[] DEFAULT ARRAY['pl']::TEXT[],
ADD COLUMN     "title" JSONB;
