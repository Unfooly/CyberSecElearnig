import { AssignmentStatus, CourseCategory } from '@prisma/client';

export class CourseAssignmentSummaryDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  // Ścieżka zasobu miniatury (D-084) - klient składa adres z CONTENT_BASE_URL (contentAssetUrl); null = karta bez miniatury.
  thumbnail!: string | null;
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
