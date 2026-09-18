import { ASSIGNABLE_ROLES, Role, UserStatus } from '@cyberszkolo/shared';

// Ręcznie odwzorowane DTO z apps/api/src/users/dto/ - ten sam, udokumentowany
// dług techniczny co przy kursach/dashboardzie (patrz apps/web/src/lib/courses-types.ts).
// Role/UserStatus/ASSIGNABLE_ROLES same są już współdzielone przez
// @cyberszkolo/shared (patrz packages/shared) - nie duplikujemy ich tutaj.

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export { ASSIGNABLE_ROLES };
export type { UserStatus };

export const ROLE_LABELS: Record<AssignableRole, string> = {
  [Role.ORG_ADMIN]: 'Administrator organizacji',
  [Role.DEPARTMENT_MANAGER]: 'Kierownik działu',
  [Role.EMPLOYEE]: 'Pracownik',
};

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface UserListItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: AssignableRole;
  status: UserStatus;
  department: DepartmentOption | null;
  createdAt: string;
}

export interface InviteUserResult extends UserListItem {
  inviteEmailSent: boolean;
}

export interface UsersListResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportCsvRowError {
  line: number;
  email: string;
  reason: string;
}

export interface ImportCsvReport {
  successCount: number;
  failedCount: number;
  emailFailedCount: number;
  errors: ImportCsvRowError[];
}
