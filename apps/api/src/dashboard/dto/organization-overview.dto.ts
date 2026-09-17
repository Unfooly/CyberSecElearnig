import { Plan } from '@prisma/client';

export class OrganizationOverviewDto {
  id!: string;
  name!: string;
  plan!: Plan;
  seatsLimit!: number;
  userCount!: number;
  completionRate!: number | null;
  // Najpóźniejszy completedAt wśród przypisań tej organizacji - jedyny
  // realny sygnał aktywności, jaki dziś przechowuje schemat (brak
  // updatedAt na CourseAssignment, brak śledzenia logowań). null, gdy
  // organizacja niczego jeszcze nie ukończyła.
  lastCourseCompletionAt!: Date | null;
}
