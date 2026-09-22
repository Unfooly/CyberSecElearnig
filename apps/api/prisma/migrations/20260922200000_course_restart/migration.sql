-- D-069: "Rozpocznij od nowa" (powtórka własnego ukończonego przypisania kursu).
-- Stare przypisanie zostaje w bazie z archivedAt ustawionym (historia, raporty, XP/odznaki bez zmian) zamiast być
-- kasowane; powstaje nowe, aktywne przypisanie tego samego kursu.

-- Istniejące wiersze: NULL = aktywne (nic się dla nich nie zmienia).
ALTER TABLE "course_assignments" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Pełny unikat (userId, courseId) już nie obowiązuje - restart tworzy kolejny wiersz dla tej samej pary. Zastępuje
-- go zwykły (nieunikalny) indeks o tej samej nazwie kolumn co @@index([userId, courseId]) w schema.prisma - do
-- wyszukiwań po CAŁEJ historii (wszystkie wiersze, nie tylko aktywny).
DROP INDEX "course_assignments_userId_courseId_key";
CREATE INDEX "course_assignments_userId_courseId_idx" ON "course_assignments"("userId", "courseId");

-- Prisma nie umie wyrazić częściowego indeksu (WHERE) w @@unique, więc ta reguła istnieje tylko tutaj: jedno
-- AKTYWNE (archivedAt IS NULL) przypisanie na (organizationId, userId, courseId).
CREATE UNIQUE INDEX "course_assignments_active_org_user_course_key"
  ON "course_assignments"("organizationId", "userId", "courseId")
  WHERE "archivedAt" IS NULL;
