import { AssignmentStatus, Prisma } from '@prisma/client';

export class CourseDetailDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  contentBlocks!: Prisma.JsonValue;
  // Cele/zadania wersji przypisania (D-081): tekst i opcjonalnie id bloków, których ukończenie odhacza zadanie (liczy klient).
  objectives!: { text: string; completeWhen?: string[] }[];
  progress!: Prisma.JsonValue;
}
