import { AssignmentStatus, Prisma } from '@prisma/client';

export class CourseDetailDto {
  assignmentId!: string;
  courseId!: string;
  title!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  /** Pierwsze rozpoczęcie i ukończenie przypisania - czas śledztwa na ekranie zamknięcia sprawy (D-089); null = nieznane / jeszcze nie. */
  startedAt!: Date | null;
  completedAt!: Date | null;
  contentBlocks!: Prisma.JsonValue;
  progress!: Prisma.JsonValue;
  /** Tryb prosty wersji treści (D-132): odtwarzacz dla osób nietechnicznych, ocena każdego kliknięcia przez /check. */
  simpleMode!: boolean;
}
