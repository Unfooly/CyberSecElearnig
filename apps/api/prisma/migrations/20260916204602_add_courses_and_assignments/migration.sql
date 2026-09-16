-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('PHISHING_SOCIAL_ENGINEERING', 'EMAIL_SECURITY', 'IT_HYGIENE', 'INCIDENT_RESPONSE', 'MALWARE', 'GENERAL_AWARENESS');

-- CreateEnum
CREATE TYPE "ContentBlockType" AS ENUM ('VIDEO', 'QUIZ', 'BRANCHING_SCENARIO', 'DRAG_AND_DROP');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "contentBlocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentBlockIndex" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "score" INTEGER,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_assignments_organizationId_idx" ON "course_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "course_assignments_userId_idx" ON "course_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "course_assignments_userId_courseId_key" ON "course_assignments"("userId", "courseId");

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
