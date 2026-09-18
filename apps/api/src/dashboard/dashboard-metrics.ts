// Czysta logika metryk dashboardu zarządu (bez dostępu do bazy) - wydzielona,
// żeby granice miesięcy, statusy zgodności i sortowanie były testowalne
// jednostkowo. DashboardService tylko pobiera dane (zawsze z organizationId).

export type ComplianceStatus = 'COMPLIANT' | 'OVERDUE' | 'IN_PROGRESS' | 'NO_ASSIGNMENTS';

export interface TrendPoint {
  // 'YYYY-MM' (UTC).
  month: string;
  // null = w tym miesiącu nie istniały jeszcze żadne obowiązkowe przypisania.
  completionRate: number | null;
  mandatoryTotal: number;
  mandatoryCompleted: number;
}

export interface TrendAssignment {
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Trend ukończenia szkoleń obowiązkowych: dla KOŃCA każdego z ostatnich
 * `months` miesięcy (UTC; bieżący miesiąc - do `now`) liczy, jaki odsetek
 * istniejących wtedy obowiązkowych przypisań był już ukończony. Przypisanie
 * utworzone PO końcu miesiąca nie wchodzi do jego mianownika, więc późniejsze
 * przypisania nie zaniżają historycznych punktów.
 */
export function buildMonthlyTrend(assignments: TrendAssignment[], now: Date, months = 6): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1);
    const monthEnd = offset === 0 ? now.getTime() : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1) - 1;

    let total = 0;
    let completed = 0;
    for (const assignment of assignments) {
      if (assignment.createdAt.getTime() > monthEnd) {
        continue;
      }
      total += 1;
      if (assignment.completedAt && assignment.completedAt.getTime() <= monthEnd) {
        completed += 1;
      }
    }

    const start = new Date(monthStart);
    points.push({
      month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
      mandatoryTotal: total,
      mandatoryCompleted: completed,
    });
  }
  return points;
}

export interface UserAssignmentInput {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';
  dueDate: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  mandatory: boolean;
}

export interface UserSummary {
  completedMandatoryCoursesCount: number;
  totalMandatoryCoursesCount: number;
  // null = brak obowiązkowych przypisań (nie ma z czego liczyć procentu).
  completionPercentage: number | null;
  complianceStatus: ComplianceStatus;
  lastActivityAt: Date | null;
}

export function summarizeUser(assignments: UserAssignmentInput[], now: Date): UserSummary {
  const mandatory = assignments.filter((assignment) => assignment.mandatory);
  const completed = mandatory.filter((assignment) => assignment.status === 'COMPLETED').length;
  const total = mandatory.length;

  const overdue = mandatory.some(
    (assignment) =>
      assignment.status === 'OVERDUE' ||
      (assignment.status !== 'COMPLETED' && assignment.dueDate !== null && assignment.dueDate.getTime() < now.getTime()),
  );

  let complianceStatus: ComplianceStatus;
  if (total === 0) {
    complianceStatus = 'NO_ASSIGNMENTS';
  } else if (completed === total) {
    complianceStatus = 'COMPLIANT';
  } else if (overdue) {
    complianceStatus = 'OVERDUE';
  } else {
    complianceStatus = 'IN_PROGRESS';
  }

  // Aktywność = ostatnia zmiana przypisania, które użytkownik faktycznie
  // ruszył. NOT_STARTED pomijamy: samo przypisanie kursu przez admina nie
  // jest aktywnością pracownika.
  let lastActivityAt: Date | null = null;
  for (const assignment of assignments) {
    if (assignment.status === 'NOT_STARTED') {
      continue;
    }
    if (!lastActivityAt || assignment.updatedAt > lastActivityAt) {
      lastActivityAt = assignment.updatedAt;
    }
  }

  return {
    completedMandatoryCoursesCount: completed,
    totalMandatoryCoursesCount: total,
    completionPercentage: total > 0 ? Math.round((completed / total) * 100) : null,
    complianceStatus,
    lastActivityAt,
  };
}

export const USERS_STATUS_SORT_FIELDS = ['name', 'email', 'department', 'completion', 'lastActivity'] as const;
export type UsersStatusSortField = (typeof USERS_STATUS_SORT_FIELDS)[number];

export interface SortableRow {
  firstName: string | null;
  lastName: string | null;
  email: string;
  departmentName: string | null;
  completionPercentage: number | null;
  lastActivityAt: Date | null;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'pl', { sensitivity: 'base' });
}

// Wartości brakujące (null) trafiają na koniec przy rosnącym sortowaniu
// tekstów, a przy procentach/aktywności są traktowane jako "najniższe".
export function sortRows<T extends SortableRow>(rows: T[], sortBy: UsersStatusSortField, direction: 'asc' | 'desc'): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  const nameOf = (row: SortableRow) => `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim() || row.email;

  const compare = (a: T, b: T): number => {
    switch (sortBy) {
      case 'name':
        return compareText(nameOf(a), nameOf(b));
      case 'email':
        return compareText(a.email, b.email);
      case 'department':
        if (a.departmentName === null || b.departmentName === null) {
          return (a.departmentName === null ? 1 : 0) - (b.departmentName === null ? 1 : 0);
        }
        return compareText(a.departmentName, b.departmentName);
      case 'completion':
        return (a.completionPercentage ?? -1) - (b.completionPercentage ?? -1);
      case 'lastActivity':
        return (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0);
    }
  };

  // Stabilny remis po e-mailu - inaczej strony przy paginacji mogłyby
  // powtarzać/gubić wiersze o równych wartościach.
  return [...rows].sort((a, b) => factor * compare(a, b) || compareText(a.email, b.email));
}
