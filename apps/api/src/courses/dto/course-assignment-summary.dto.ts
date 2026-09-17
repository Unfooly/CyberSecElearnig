import { AssignmentStatus, CourseCategory } from '@prisma/client';

export class CourseAssignmentSummaryDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  category!: CourseCategory;
  durationMinutes!: number;
  mandatory!: boolean;
  status!: AssignmentStatus;
  score!: number | null;
  dueDate!: Date | null;
  completedAt!: Date | null;
  // Do wyliczenia paska postępu na liście kursów bez wołania /start.
  currentBlockIndex!: number;
  totalBlocks!: number;
}
