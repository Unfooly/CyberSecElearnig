-- Wersje treści kursów (silnik scen): niemutowalny zapis treści + przypięcie wersji do przypisania, żeby zmiana treści nie
-- przesuwała bloków pracownikowi będącemu w połowie kursu. Dodatkowo B-032: usunięcie kursu/wersji nie może kasować wyników
-- (RESTRICT zamiast CASCADE z course_assignments).
--
-- course_versions celowo BEZ RLS i BEZ organizationId - to globalny katalog treści (jak `courses`), nie dane klienta.
-- Nie ma tu backfillu course_assignments.courseVersionId: course_assignments ma FORCE RLS, więc migracja nie zmieni cudzych
-- wierszy bez kontekstu organizacji. NULL znaczy "jeszcze nie przypięta" i jest rozwiązywane leniwie w CoursesService
-- (rozpoczęte przed migracją -> wersja 1 z Course.contentBlocks, nowe -> najnowsza).
--
-- Wygenerowane przez `prisma migrate diff`; pominięto DropForeignKey złożonych kluczy tenantowych (istnieją tylko w SQL,
-- Prisma ich nie modeluje; patrz komentarz przy modelu User w schema.prisma).

-- DropForeignKey
ALTER TABLE "course_assignments" DROP CONSTRAINT "course_assignments_courseId_fkey";

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "courseVersionId" TEXT;

-- CreateTable
CREATE TABLE "course_versions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "contentHash" VARCHAR(80) NOT NULL,
    "contentBlocks" JSONB NOT NULL,
    "blockCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_courseId_version_key" ON "course_versions"("courseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_courseId_contentHash_key" ON "course_versions"("courseId", "contentHash");

-- CreateIndex
CREATE INDEX "course_assignments_courseVersionId_idx" ON "course_assignments"("courseVersionId");

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
