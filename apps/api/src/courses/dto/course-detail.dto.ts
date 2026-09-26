import { AssignmentStatus, Prisma } from '@prisma/client';

export class CourseDetailDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  contentBlocks!: Prisma.JsonValue;
  progress!: Prisma.JsonValue;
}
