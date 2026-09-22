import { OrganizationStatus } from '@prisma/client';

/** Organizacja kliencka w panelu operatora, z informacją, kto ją dziś obsługuje (D-069). */
export class AssignableOrganizationDto {
  id!: string;
  name!: string;
  status!: OrganizationStatus;
  /** null = nikt jej nie obsługuje. */
  resellerId!: string | null;
  resellerName!: string | null;
}
