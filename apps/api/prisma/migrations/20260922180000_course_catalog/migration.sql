-- Katalog kursów (hotfix widoczności zaimportowanego kursu): metadane modułu do wyświetlenia w katalogu
-- (Course.subtitle/level/objectives - schemaVersion 4, dotąd walidowane przez content-import, ale nigdzie nie
-- zapisywane - B-087) oraz `mandatory` per przypisanie (CourseAssignment.mandatory) - samodzielny start kursu z
-- katalogu jest ZAWSZE nieobowiązkowy, niezależnie od Course.mandatory (ten zostaje wyłącznie domyślną wartością
-- przy przyszłym ręcznym przypisaniu przez ORG_ADMIN).

ALTER TABLE "courses" ADD COLUMN "subtitle" VARCHAR(300);
ALTER TABLE "courses" ADD COLUMN "level" VARCHAR(20);
ALTER TABLE "courses" ADD COLUMN "objectives" JSONB;

ALTER TABLE "course_assignments" ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT false;
-- Backfill: istniejące przypisania (dziś jedyne źródło produkcyjne to TrackingService.assignFollowUpCourse) mają
-- zachować dokładnie to samo, wyświetlane dotąd zachowanie (mandatory liczone z course.mandatory w locie) - kopiujemy
-- wartość z kursu w chwili migracji. Od teraz każdy TWÓRCA przypisania ustawia to pole jawnie.
UPDATE "course_assignments" AS ca
SET "mandatory" = c."mandatory"
FROM "courses" AS c
WHERE ca."courseId" = c."id";
