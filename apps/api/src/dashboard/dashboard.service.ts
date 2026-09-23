import { BadRequestException, Injectable } from '@nestjs/common';
import { AssignmentStatus } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PhishingResultsService } from '../phishing/results/phishing-results.service';
import { DashboardOverviewDto } from './dto/dashboard-overview.dto';
import { DepartmentCompletionDto } from './dto/department-completion.dto';
import { OrganizationOverviewDto } from './dto/organization-overview.dto';
import { TrendPointDto } from './dto/trend-point.dto';
import { UserStatusRowDto } from './dto/user-status-row.dto';
import { UsersStatusResponseDto } from './dto/users-status-response.dto';
import {
  USERS_STATUS_DEFAULT_PAGE_SIZE,
  UsersStatusQueryDto,
} from './dto/users-status-query.dto';
import { buildMonthlyTrend, sortRows, summarizeUser } from './dashboard-metrics';

const NO_DEPARTMENT_LABEL = 'Brak działu';

function percentage(completed: number, total: number): number | null {
  return total > 0 ? Math.round((completed / total) * 100) : null;
}

export function escapeCsvField(value: string): string {
  // Formula injection: pole zaczynające się od = + - @ (lub tab/CR) Excel
  // wykona jako formułę - dopisujemy apostrof, żeby traktował to jako tekst.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

function latestDate(dates: Date[]): Date | null {
  return dates.reduce<Date | null>(
    (latest, date) => (!latest || date > latest ? date : latest),
    null,
  );
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly phishingResults: PhishingResultsService,
  ) {}

  /**
   * organizationId pochodzi WYŁĄCZNIE z tokena JWT wywołującego (zob.
   * DashboardController) — endpointy świadomie nie przyjmują go od klienta.
   */
  async getOverview(organizationId: string): Promise<DashboardOverviewDto> {
    // KPI symulacji: tylko zagregowany procent całej organizacji z progiem minimalnej liczebności (null = za mało
    // danych albo brak kampanii); żadnych danych osobowych.
    const phishing = await this.phishingResults.susceptibilityKpi(organizationId);
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Wszędzie niżej: tylko AKTYWNE przypisania (D-069) - to jest zdjęcie BIEŻĄCEGO stanu zgodności/aktywności, nie
      // historii. Przypisanie zarchiwizowane restartem (nawet jeśli było OVERDUE/COMPLETED) jest zastąpione nowym,
      // aktywnym wierszem, który ma tu się liczyć - stare już nie (inaczej restart kursu obowiązkowego podwoiłby
      // mandatoryTotal). Wyjątek: getCompletionTrends (historyczny trend) - patrz komentarz tam.
      const [totalUsers, mandatoryTotal, mandatoryCompleted, overdueCount, activeUserRows] =
        await Promise.all([
          tx.user.count({ where: { organizationId } }),
          tx.courseAssignment.count({ where: { organizationId, mandatory: true, archivedAt: null } }),
          tx.courseAssignment.count({
            where: {
              organizationId,
              mandatory: true,
              status: AssignmentStatus.COMPLETED,
              archivedAt: null,
            },
          }),
          tx.courseAssignment.count({
            where: { organizationId, status: AssignmentStatus.OVERDUE, archivedAt: null },
          }),
          tx.courseAssignment.findMany({
            where: {
              organizationId,
              status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED] },
              archivedAt: null,
            },
            select: { userId: true },
            distinct: ['userId'],
          }),
        ]);

      return {
        completionRate: percentage(mandatoryCompleted, mandatoryTotal),
        activeUsers: { count: activeUserRows.length, total: totalUsers },
        overdueCount,
        phishingClickRate: phishing.clickRate,
        phishingSubmitRate: phishing.submitRate,
        phishingReportRate: phishing.reportRate,
      };
    });
  }

  async getDepartmentBreakdown(organizationId: string): Promise<DepartmentCompletionDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const [departments, assignments] = await Promise.all([
        tx.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
        // Tylko AKTYWNE (D-069) - patrz komentarz w getOverview.
        tx.courseAssignment.findMany({
          where: { organizationId, mandatory: true, archivedAt: null },
          select: { status: true, user: { select: { departmentId: true } } },
        }),
      ]);

      const buckets = new Map<string | null, { total: number; completed: number }>();
      for (const department of departments) {
        buckets.set(department.id, { total: 0, completed: 0 });
      }

      for (const assignment of assignments) {
        const key = assignment.user.departmentId;
        const bucket = buckets.get(key) ?? { total: 0, completed: 0 };
        bucket.total += 1;
        if (assignment.status === AssignmentStatus.COMPLETED) {
          bucket.completed += 1;
        }
        buckets.set(key, bucket);
      }

      const nameById = new Map(departments.map((department) => [department.id, department.name]));

      const result: DepartmentCompletionDto[] = Array.from(buckets.entries()).map(
        ([departmentId, bucket]) => ({
          departmentId,
          departmentName: departmentId === null ? NO_DEPARTMENT_LABEL : nameById.get(departmentId)!,
          completionRate: percentage(bucket.completed, bucket.total),
          mandatoryTotal: bucket.total,
          mandatoryCompleted: bucket.completed,
        }),
      );

      // Rosnąco wg completionRate - najniższy (najwyższe ryzyko) pierwszy.
      // Brak danych (null) traktowany jako "nieznane ryzyko", nie
      // "najwyższe" ani "najniższe" - zawsze na końcu.
      result.sort((a, b) => {
        if (a.completionRate === null) return b.completionRate === null ? 0 : 1;
        if (b.completionRate === null) return -1;
        return a.completionRate - b.completionRate;
      });

      return result;
    });
  }

  /**
   * Trend ukończenia szkoleń obowiązkowych z ostatnich 6 miesięcy
   * (organizationId WYŁĄCZNIE z JWT - patrz DashboardController).
   */
  async getCompletionTrends(organizationId: string, now: Date = new Date()): Promise<TrendPointDto[]> {
    // Świadomy WYJĄTEK od "tylko aktywne" (D-069): to jest trend HISTORYCZNY, nie zdjęcie bieżącego stanu - przypisanie
    // zarchiwizowane restartem naprawdę BYŁO ukończone w danym miesiącu i musi zostać w danych za ten miesiąc
    // (archiwizacja to nie kasowanie, patrz D-069). Nowe przypisanie po restarcie dolicza się do mianownika od
    // miesiąca restartu, więc trend nigdy się nie zmniejsza wstecznie.
    const assignments = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.courseAssignment.findMany({
        where: { organizationId, mandatory: true },
        select: { createdAt: true, completedAt: true },
      }),
    );
    return buildMonthlyTrend(assignments, now);
  }

  /**
   * Lista pracowników z podsumowaniem postępu w szkoleniach obowiązkowych.
   * `completionPercentage` jest polem wyliczanym, więc filtrowanie (search,
   * dział) idzie w bazie, a sortowanie/paginacja w pamięci po wyliczeniu -
   * świadomy kompromis na skalę MVP (patrz README).
   */
  async getUsersStatus(
    organizationId: string,
    query: UsersStatusQueryDto,
    now: Date = new Date(),
  ): Promise<UsersStatusResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? USERS_STATUS_DEFAULT_PAGE_SIZE;
    const search = query.search?.trim();

    const users = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.findMany({
        where: {
          organizationId,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(search
            ? {
                OR: [
                  { email: { contains: search, mode: 'insensitive' as const } },
                  { firstName: { contains: search, mode: 'insensitive' as const } },
                  { lastName: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          department: { select: { id: true, name: true } },
          // Tylko AKTYWNE (D-069) - patrz komentarz w getOverview; status zgodności pracownika liczy się z jego
          // BIEŻĄCYCH przypisań, nie z historii sprzed restartu.
          courseAssignments: {
            where: { organizationId, archivedAt: null },
            select: {
              status: true,
              dueDate: true,
              completedAt: true,
              updatedAt: true,
              mandatory: true,
            },
          },
        },
      }),
    );

    const rows: UserStatusRowDto[] = users.map((user) => {
      const summary = summarizeUser(
        user.courseAssignments.map((assignment) => ({
          status: assignment.status,
          dueDate: assignment.dueDate,
          completedAt: assignment.completedAt,
          updatedAt: assignment.updatedAt,
          mandatory: assignment.mandatory,
        })),
        now,
      );
      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        departmentId: user.department?.id ?? null,
        departmentName: user.department?.name ?? null,
        ...summary,
      };
    });

    const sorted = sortRows(rows, query.sortBy ?? 'name', query.sortDir ?? 'asc');
    const start = (page - 1) * pageSize;
    return { items: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize };
  }

  async exportCsv(organizationId: string, format: 'csv' = 'csv'): Promise<string> {
    // ExportQueryDto/ValidationPipe już odrzuca (400) każdy format poza
    // "csv" na wejściu do kontrolera - to dodatkowa, jawna asercja na
    // poziomie serwisu, żeby nie polegać wyłącznie na warstwie HTTP.
    if (format !== 'csv') {
      throw new BadRequestException('Nieobsługiwany format eksportu');
    }
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const users = await tx.user.findMany({
        where: { organizationId },
        select: {
          email: true,
          department: { select: { name: true } },
          courseAssignments: {
            select: {
              status: true,
              completedAt: true,
              mandatory: true,
              archivedAt: true,
            },
          },
        },
        orderBy: { email: 'asc' },
      });

      const header = ['Email', 'Dział', 'Ukończone/Wszystkie obowiązkowe', 'Ostatnie ukończenie kursu'];
      const rows = users.map((user) => {
        // "Ukończone/Wszystkie obowiązkowe" celowo liczy się TYLKO z kursów
        // obowiązkowych (compliance) i tylko AKTYWNYCH przypisań (D-069 - to
        // bieżący stan, przypisanie zarchiwizowane restartem już się nie liczy) -
        // ale "Ostatnie ukończenie kursu" to sygnał ogólnej aktywności usera w
        // CAŁEJ historii (też opcjonalne, też zarchiwizowane restartem - to
        // ukończenie naprawdę się zdarzyło i restart go nie unieważnia). To ta
        // sama definicja, co w getOrganizationsOverview - patrz komentarz tam.
        const mandatoryAssignments = user.courseAssignments.filter((a) => a.mandatory && a.archivedAt === null);
        const mandatoryCompleted = mandatoryAssignments.filter(
          (a) => a.status === AssignmentStatus.COMPLETED,
        ).length;

        const completionDates = user.courseAssignments
          .map((a) => a.completedAt)
          .filter((date): date is Date => date !== null);
        const lastCourseCompletionAt = latestDate(completionDates)?.toISOString() ?? '';

        return [
          user.email,
          user.department?.name ?? NO_DEPARTMENT_LABEL,
          `${mandatoryCompleted}/${mandatoryAssignments.length}`,
          lastCourseCompletionAt,
        ];
      });

      return toCsv([header, ...rows]);
    });
  }

  /**
   * Jedyna metoda w projekcie czytająca dane wielu organizacji naraz -
   * WYŁĄCZNIE dla GET /dashboard/admin/organizations (SUPER_ADMIN).
   * Kontroler musi sprawdzić rolę PRZED wywołaniem (RolesGuard) - ta
   * metoda sama w sobie nie jest kontrolą dostępu.
   */
  async getOrganizationsOverview(): Promise<OrganizationOverviewDto[]> {
    const { organizations, users, assignments } = await this.tenantPrisma.runCrossOrgQuery(async (tx) => {
      const [organizations, users, assignments] = await Promise.all([
        tx.organization.findMany({
          select: { id: true, name: true, plan: true, seatsLimit: true },
          orderBy: { name: 'asc' },
        }),
        tx.user.findMany({ select: { organizationId: true } }),
        // Nieprzefiltrowane po mandatory - completionRate poniżej świadomie
        // liczy się tylko z obowiązkowych (compliance), ale
        // lastCourseCompletionAt to sygnał ogólnej aktywności organizacji,
        // więc musi widzieć też ukończenia kursów opcjonalnych - tak samo
        // jak analogiczna kolumna w exportCsv. archivedAt pobrane, ale NIE
        // wchodzi do filtra zapytania (świadomie: filtrowanie po nim jest w
        // pętli niżej, osobno dla completionRate i lastCourseCompletionAt - D-069).
        tx.courseAssignment.findMany({
          select: {
            organizationId: true,
            status: true,
            completedAt: true,
            mandatory: true,
            archivedAt: true,
          },
        }),
      ]);
      return { organizations, users, assignments };
    });

    const userCountByOrg = new Map<string, number>();
    for (const user of users) {
      userCountByOrg.set(user.organizationId, (userCountByOrg.get(user.organizationId) ?? 0) + 1);
    }

    const statsByOrg = new Map<
      string,
      { mandatoryTotal: number; mandatoryCompleted: number; completionDates: Date[] }
    >();
    for (const assignment of assignments) {
      const stats = statsByOrg.get(assignment.organizationId) ?? {
        mandatoryTotal: 0,
        mandatoryCompleted: 0,
        completionDates: [],
      };
      // completionRate: tylko AKTYWNE (D-069, bieżący stan compliance - patrz DashboardService.getOverview).
      // lastCourseCompletionAt (niżej, poza tym if) celowo bierze WSZYSTKIE, też zarchiwizowane - historia.
      if (assignment.mandatory && assignment.archivedAt === null) {
        stats.mandatoryTotal += 1;
        if (assignment.status === AssignmentStatus.COMPLETED) {
          stats.mandatoryCompleted += 1;
        }
      }
      if (assignment.completedAt) {
        stats.completionDates.push(assignment.completedAt);
      }
      statsByOrg.set(assignment.organizationId, stats);
    }

    return organizations.map((organization) => {
      const stats = statsByOrg.get(organization.id);
      return {
        id: organization.id,
        name: organization.name,
        plan: organization.plan,
        seatsLimit: organization.seatsLimit,
        userCount: userCountByOrg.get(organization.id) ?? 0,
        completionRate: stats ? percentage(stats.mandatoryCompleted, stats.mandatoryTotal) : null,
        lastCourseCompletionAt: stats ? latestDate(stats.completionDates) : null,
      };
    });
  }
}
