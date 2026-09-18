import type { ComplianceStatus } from '../dashboard-metrics';

export class UserStatusRowDto {
  id!: string;
  firstName!: string | null;
  lastName!: string | null;
  email!: string;
  departmentId!: string | null;
  departmentName!: string | null;
  completedMandatoryCoursesCount!: number;
  totalMandatoryCoursesCount!: number;
  // null = brak obowiązkowych przypisań.
  completionPercentage!: number | null;
  complianceStatus!: ComplianceStatus;
  lastActivityAt!: Date | null;
}
