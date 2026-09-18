// Ręcznie odwzorowane DTO z apps/api/src/dashboard/dto/ - ten sam,
// udokumentowany dług techniczny co przy kursach/użytkownikach.

export type ComplianceStatus = 'COMPLIANT' | 'OVERDUE' | 'IN_PROGRESS' | 'NO_ASSIGNMENTS';

export interface TrendPoint {
  // 'YYYY-MM' (UTC)
  month: string;
  completionRate: number | null;
  mandatoryTotal: number;
  mandatoryCompleted: number;
}

export const USERS_STATUS_SORT_FIELDS = ['name', 'email', 'department', 'completion', 'lastActivity'] as const;
export type UsersStatusSortField = (typeof USERS_STATUS_SORT_FIELDS)[number];

export interface UserStatusRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  completedMandatoryCoursesCount: number;
  totalMandatoryCoursesCount: number;
  completionPercentage: number | null;
  complianceStatus: ComplianceStatus;
  lastActivityAt: string | null;
}

export interface UsersStatusResponse {
  items: UserStatusRow[];
  total: number;
  page: number;
  pageSize: number;
}
