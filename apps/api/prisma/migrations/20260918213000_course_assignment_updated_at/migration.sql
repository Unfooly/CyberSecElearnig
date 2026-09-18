-- Dashboard dla zarządu (GET /dashboard/users-status): "ostatnia aktywność"
-- pracownika = max(updatedAt) jego przypisań, które nie są NOT_STARTED.
-- Backfill: dla istniejących wierszy najlepsze dostępne przybliżenie to
-- moment ukończenia albo utworzenia przypisania.
ALTER TABLE "course_assignments" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "course_assignments" SET "updatedAt" = COALESCE("completedAt", "createdAt");
