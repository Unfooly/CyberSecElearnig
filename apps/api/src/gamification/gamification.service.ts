import { Injectable } from '@nestjs/common';
import { AssignmentStatus, Badge, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { evidenceSummary } from '../courses/client-view';
import { toResolved } from '../courses/course-versions';
import { readProgress } from '../courses/progress';
import { initialsFromEmail } from './initials.util';
import { currentLevelProgressPercent, levelForXp, xpForNextLevel } from './level.util';
import { completionAchievements, easterEggAchievements } from './achievements';
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENTS_SYNC_VERSION,
  AchievementCode,
  COURSE_COMPLETION_XP,
  LEADERBOARD_LIMIT,
  LeaderboardScope,
  MODULE_1_SLUG,
  PERFECT_SCORE_XP,
} from './gamification.constants';
import { BadgeListItemDto } from './dto/badge-list-item.dto';
import { LeaderboardEntryDto } from './dto/leaderboard-entry.dto';
import { UserGamificationSummaryDto } from './dto/user-gamification-summary.dto';

/** Data z postępu albo null (brak, śmieci albo data „zero” z formatu sprzed silnika - readProgress wstawia wtedy 1970). */
function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? null : date;
}

export interface CourseCompletionResult {
  xpGained: number;
  newLevel: number;
  // Poziom SPRZED tego przyznania XP (fix/course-finish-flow) - front pokazuje "Poziom {previousLevel}" obok paska,
  // a przy awansie osobno "Poziom {newLevel}". Nie zakładamy newLevel-1: przy bardzo niskim poziomie start (progi
  // level.util.ts rosną kwadratowo) pojedyncze ukończenie kursu w teorii mogłoby przeskoczyć więcej niż jeden poziom.
  previousLevel: number;
  // true tylko gdy newLevel > poziom SPRZED tego przyznania XP - front (karta nagrody na SummaryScreen,
  // fix/course-finish-flow) pokazuje osobny komunikat o awansie tylko wtedy.
  leveledUp: boolean;
  unlockedBadges: Badge[];
  // Pasek poziomu "przed -> po" (fix/course-finish-flow, SummaryScreen): procent 0..100 w SKALI POZIOMU SPRZED tego
  // przyznania XP - przy awansie `After` jest przycięty do 100 (pasek "napełnia się" do końca starego poziomu;
  // sam awans i numer nowego poziomu pokazuje osobny komunikat z `leveledUp`/`newLevel`, nie ten pasek). Liczone tu
  // (nie na froncie), żeby wzór poziomu (level.util.ts) miał jedno źródło prawdy.
  levelProgressBeforePercent: number;
  levelProgressAfterPercent: number;
}

@Injectable()
export class GamificationService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Wołane WYŁĄCZNIE z CoursesService.submitBlockProgress, w TEJ SAMEJ
   * transakcji co oznaczenie CourseAssignment jako COMPLETED (stąd `tx`
   * przekazany z zewnątrz, nie własny runInOrgContext) - XP/level/odznaki
   * muszą być spójne z faktem ukończenia kursu, nie osobnym, potencjalnie
   * niespójnym krokiem (patrz plan architektury z tej sesji: świadomie NIE
   * event emitter, dokładnie z tego powodu).
   */
  async awardCourseCompletion(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    options: {
      score: number | null;
      courseSlug: string | null;
      evidence: { collected: number; total: number };
      // Przypisanie właśnie ukończone - wyłączone z przyznania wstecznego (jego osiągnięcia idą niżej, „na żywo”, z XP).
      assignmentId: string;
    },
  ): Promise<CourseCompletionResult> {
    const { assignmentId, ...facts } = options;
    let xpGained = COURSE_COMPLETION_XP;
    if (facts.score === 100) {
      xpGained += PERFECT_SCORE_XP;
    }

    // Najpierw przyznanie wsteczne z WCZEŚNIEJSZYCH podejść (bez XP): kto ukończył kurs przed wdrożeniem osiągnięć, dostaje
    // First Case Closed z tamtą datą i bez XP - tak samo, jak gdyby najpierw wszedł na profil.
    await this.syncAchievements(tx, organizationId, userId, assignmentId);

    // Liczony PO tym, jak CoursesService.submitBlockProgress już zapisał ten CourseAssignment jako COMPLETED (ta sama
    // transakcja, ta kolejność) - właśnie ukończony kurs jest wliczony. Bez filtra archivedAt (D-069): historia ukończeń.
    const completedCount = await tx.courseAssignment.count({
      where: { organizationId, userId, status: AssignmentStatus.COMPLETED },
    });
    const candidateCodes = completionAchievements({ completedCount, ...facts });

    const unlockedBadges: Badge[] = [];
    for (const code of candidateCodes) {
      const badge = await this.tryUnlockBadge(tx, organizationId, userId, code);
      if (badge) {
        unlockedBadges.push(badge);
        xpGained += badge.xpReward;
      }
    }

    // `data` poniżej celowo nie dotyka `level` - `updatedUser.level` w
    // odpowiedzi to więc wciąż poziom SPRZED tego przyznania XP, bez
    // potrzeby osobnego odczytu przed update'em.
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { xp: { increment: xpGained } },
    });
    const previousLevel = updatedUser.level;
    const newLevel = levelForXp(updatedUser.xp);
    if (newLevel !== previousLevel) {
      await tx.user.update({ where: { id: userId }, data: { level: newLevel } });
    }

    const xpBefore = updatedUser.xp - xpGained;
    const levelProgressBeforePercent = currentLevelProgressPercent(xpBefore, previousLevel);
    const levelProgressAfterPercent =
      newLevel > previousLevel ? 100 : currentLevelProgressPercent(updatedUser.xp, previousLevel);

    return {
      xpGained,
      newLevel,
      previousLevel,
      leveledUp: newLevel > previousLevel,
      unlockedBadges,
      levelProgressBeforePercent,
      levelProgressAfterPercent,
    };
  }

  async getMyGamificationSummary(organizationId: string, userId: string): Promise<UserGamificationSummaryDto> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Karta na /courses pokazuje osiągnięcia - przyznanie wsteczne także tu (raz na użytkownika), nie dopiero na profilu.
      await this.syncAchievements(tx, organizationId, userId);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { xp: true, level: true, avatarUrl: true },
      });
      // Wycofane odznaki sprzed D-111 znikają z UI (wiersze i XP zostają).
      const unlocked = await tx.userBadge.findMany({
        where: { organizationId, userId, badge: { retiredAt: null } },
        include: { badge: true },
        orderBy: { unlockedAt: 'desc' },
      });

      return {
        avatarUrl: user.avatarUrl,
        xp: user.xp,
        level: user.level,
        nextLevelXp: xpForNextLevel(user.level),
        currentLevelProgressPercent: currentLevelProgressPercent(user.xp, user.level),
        badges: unlocked.map((userBadge) => ({
          code: userBadge.badge.code,
          title: userBadge.badge.title,
          description: userBadge.badge.description,
          icon: userBadge.badge.icon,
          xpReward: userBadge.badge.xpReward,
          unlockedAt: userBadge.unlockedAt,
        })),
      };
    });
  }

  /**
   * Osiągnięcia (D-111) ze stanem zdobycia. Najpierw przyznanie wsteczne (syncAchievements) - tak użytkownik, który spełnił
   * warunek przed wdrożeniem osiągnięć (także wyróżnienie easter egga z Q), widzi je od pierwszego wejścia na profil.
   * Tajne i niezdobyte: bez kodu, nazwy, opisu, warunku i grafiki zdobytej - tylko ranga i grafika zablokowana („???”).
   */
  async listBadgesWithUnlockStatus(organizationId: string, userId: string): Promise<BadgeListItemDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      await this.syncAchievements(tx, organizationId, userId);
      const [badges, unlockedRows] = await Promise.all([
        tx.badge.findMany({ where: { retiredAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        tx.userBadge.findMany({ where: { organizationId, userId } }),
      ]);
      const unlockedByBadgeId = new Map(unlockedRows.map((row) => [row.badgeId, row.unlockedAt]));

      return badges.map((badge, index): BadgeListItemDto => {
        const unlockedAt = unlockedByBadgeId.get(badge.id) ?? null;
        const common = { rank: badge.rank, hidden: badge.hidden, xpReward: badge.xpReward, isUnlocked: unlockedAt !== null, unlockedAt };
        if (badge.hidden && unlockedAt === null) {
          return {
            ...common,
            code: `secret-${index + 1}`,
            title: null,
            description: null,
            conditionText: null,
            scope: null,
            // Grafika zablokowana tajnego ma neutralną nazwę pliku (osiagniecie-tajne-zablokowane) - nazwa nic nie zdradza.
            icon: badge.lockedIcon ?? badge.icon,
            lockedIcon: badge.lockedIcon,
            xpReward: 0,
          };
        }
        return {
          ...common,
          code: badge.code,
          title: badge.title,
          description: badge.description,
          conditionText: badge.conditionText,
          scope: badge.scope,
          icon: badge.icon,
          lockedIcon: badge.lockedIcon,
        };
      });
    });
  }

  /**
   * Osiągnięcia za wyróżnienia easter egga zapisane TYM zapisem bloku (CoursesService.submitBlockProgress, ta sama
   * transakcja). Bez XP (easter egg nie wpływa na wynik ani XP, D-100). Zwraca nowo zdobyte (testy; odpowiedź API ich nie
   * niesie - komunikat w playerze pokazuje outro easter egga jeszcze przed zapisem bloku).
   */
  async awardEasterEggAchievements(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseSlug: string | null,
    easterEggs: readonly string[] | undefined,
  ): Promise<Badge[]> {
    const unlocked: Badge[] = [];
    for (const code of easterEggAchievements(courseSlug, easterEggs)) {
      const badge = await this.tryUnlockBadge(tx, organizationId, userId, code);
      if (badge) unlocked.push(badge);
    }
    return unlocked;
  }

  /**
   * Przyznanie wsteczne (backfill, D-111): osiągnięcia, których warunek użytkownik spełnił PRZED wdrożeniem osiągnięć (także
   * wyróżnienie easter egga z Q). Raz na użytkownika i wersję zasad (`users.achievementsSyncVersion`) - potem wszystko
   * przyznaje ścieżka „na żywo”, więc wejście na profil nie czyta za każdym razem historii przypisań. Idempotentne
   * (unikalność userId+badgeId, ON CONFLICT DO NOTHING), bez XP (XP za te ukończenia przyznano już wtedy), data zdobycia =
   * moment spełnienia warunku. Wyłącznie w kontekście organizacji użytkownika (RLS; `user_badges` ma FORCE RLS bez wyjątku
   * bypass) - bez zapytań międzyorganizacyjnych.
   *
   * `excludeAssignmentId`: przypisanie właśnie ukończone (awardCourseCompletion) - osiągnięcia za JEGO ukończenie idą „na żywo”
   * (z XP), a backfill ukończeń obejmuje tylko wcześniejsze podejścia (easter egg z bieżącego - tak, bez XP). Dzięki temu XP i data nie zależą od tego, czy użytkownik po wdrożeniu
   * najpierw wszedł na profil, czy ukończył kolejny kurs.
   */
  async syncAchievements(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    excludeAssignmentId?: string,
  ): Promise<void> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { achievementsSyncVersion: true } });
    if (user.achievementsSyncVersion >= ACHIEVEMENTS_SYNC_VERSION) return;

    const owned = await tx.userBadge.findMany({ where: { organizationId, userId }, select: { badge: { select: { code: true } } } });
    const have = new Set(owned.map((row) => row.badge.code));
    const missing = Object.values(ACHIEVEMENT_CODES).filter((code) => !have.has(code));

    if (missing.length > 0) {
      // Historia przypisań (także zarchiwizowanych restartem, D-069): ukończone oraz wszystkie z modułu 1 (easter egg można
      // znaleźć bez ukończenia kursu).
      const assignments = await tx.courseAssignment.findMany({
        where: {
          organizationId,
          userId,
          OR: [{ status: AssignmentStatus.COMPLETED }, { course: { slug: MODULE_1_SLUG } }],
        },
        select: {
          id: true,
          status: true,
          score: true,
          progress: true,
          completedAt: true,
          updatedAt: true,
          courseVersionId: true,
          course: { select: { slug: true } },
        },
      });

      const earnedAt = new Map<AchievementCode, Date>();
      const earn = (code: AchievementCode, at: Date) => {
        const current = earnedAt.get(code);
        if (!current || at < current) earnedAt.set(code, at);
      };

      for (const assignment of assignments) {
        const slug = assignment.course.slug;
        const progress = readProgress(assignment.progress);
        for (const entry of Object.values(progress.blocks) as unknown[]) {
          // Postęp zapisuje serwer, ale czytamy go obronnie: uszkodzony wpis nie może zablokować profilu (500 przy każdym wejściu).
          if (typeof entry !== 'object' || entry === null) continue;
          const { easterEggs, answeredAt } = entry as { easterEggs?: unknown; answeredAt?: unknown };
          if (!Array.isArray(easterEggs)) continue;
          const at = validDate(answeredAt) ?? assignment.updatedAt;
          for (const code of easterEggAchievements(slug, easterEggs.filter((id): id is string => typeof id === 'string'))) earn(code, at);
        }
        // Bieżące (właśnie ukończone) przypisanie: jego ukończenie idzie „na żywo” (z XP), ale easter egg zapisany w nim PRZED
        // wdrożeniem osiągnięć (wyżej) przyznajemy tu - ścieżka „na żywo” sprawdza przy ukończeniu tylko warunki ukończenia.
        const isCurrent = excludeAssignmentId !== undefined && assignment.id === excludeAssignmentId;
        if (assignment.status !== AssignmentStatus.COMPLETED || isCurrent) continue;
        const completedAt = assignment.completedAt ?? assignment.updatedAt;
        // Sprawa bez skazy wymaga treści (dowody liczy serwer z treści wersji przypiętej do tego podejścia); pozostałe nie.
        // Przypisanie bez przypiętej wersji (sprzed silnika treści) nie jest modułem 1 - pomijamy.
        let evidence = { collected: 0, total: 0 };
        if (missing.includes(ACHIEVEMENT_CODES.FLAWLESS_CASE) && slug === MODULE_1_SLUG && assignment.score === 100 && assignment.courseVersionId) {
          const version = await tx.courseVersion.findUnique({ where: { id: assignment.courseVersionId } });
          try {
            if (version) evidence = evidenceSummary(progress, toResolved(version).blocks);
          } catch {
            // Uszkodzona treść wersji: bez sprawy bez skazy z tego podejścia, ale reszta przyznania działa.
          }
        }
        for (const code of completionAchievements({ completedCount: 1, score: assignment.score, courseSlug: slug, evidence })) {
          earn(code, completedAt);
        }
      }

      for (const code of missing) {
        const at = earnedAt.get(code);
        if (at) await this.tryUnlockBadge(tx, organizationId, userId, code, at);
      }
    }

    await tx.user.update({ where: { id: userId }, data: { achievementsSyncVersion: ACHIEVEMENTS_SYNC_VERSION } });
  }

  /**
   * organizationId i userId (requestera) pochodzą WYŁĄCZNIE z JWT
   * (GamificationController) - nigdy z query. `scope=department` filtruje
   * dodatkowo po dziale REQUESTERA (nie przyjmuje departmentId od klienta),
   * a brak działu daje pusty ranking, nie błąd.
   */
  async getLeaderboard(
    organizationId: string,
    userId: string,
    scope: LeaderboardScope,
  ): Promise<LeaderboardEntryDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      let departmentId: string | undefined;
      if (scope === 'department') {
        const requester = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { departmentId: true },
        });
        if (!requester.departmentId) {
          return [];
        }
        departmentId = requester.departmentId;
      }

      const topUsers = await tx.user.findMany({
        where: { organizationId, ...(departmentId ? { departmentId } : {}) },
        // xp desc jako główne kryterium, createdAt asc jako deterministyczny
        // tie-break (bez tego kolejność remisów byłaby niezdefiniowana i
        // migotałaby między odświeżeniami).
        orderBy: [{ xp: 'desc' }, { createdAt: 'asc' }],
        take: LEADERBOARD_LIMIT,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatarUrl: true,
          level: true,
          xp: true,
          department: { select: { name: true } },
        },
      });

      return topUsers.map((user, index) => {
        const fallback = user.firstName && user.lastName ? null : initialsFromEmail(user.email);
        return {
          rank: index + 1,
          userId: user.id,
          firstName: user.firstName ?? fallback!.firstName,
          lastName: user.lastName ?? fallback!.lastName,
          avatarUrl: user.avatarUrl,
          level: user.level,
          xp: user.xp,
          departmentName: user.department?.name ?? null,
        };
      });
    });
  }

  /**
   * Zwraca osiągnięcie, jeśli udało się je PIERWSZY RAZ przyznać temu userowi, albo null (brak w katalogu, wycofane albo
   * już zdobyte). `skipDuplicates` (ON CONFLICT DO NOTHING) zamiast łapania P2002: błąd unikalności w Postgresie przerywa
   * całą transakcję, a współbieżne przyznanie tego samego osiągnięcia (np. dwa kursy ukończone naraz) jest tu normalne -
   * licznik wstawionych wierszy mówi, kto faktycznie przyznał (i tylko ten dolicza XP).
   */
  private async tryUnlockBadge(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    code: string,
    unlockedAt?: Date,
  ): Promise<Badge | null> {
    const badge = await tx.badge.findUnique({ where: { code } });
    if (!badge || badge.retiredAt) {
      return null;
    }
    const created = await tx.userBadge.createMany({
      data: [{ userId, badgeId: badge.id, organizationId, ...(unlockedAt ? { unlockedAt } : {}) }],
      skipDuplicates: true,
    });
    return created.count === 1 ? badge : null;
  }
}
