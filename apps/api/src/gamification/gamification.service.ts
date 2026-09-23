import { Injectable } from '@nestjs/common';
import { AssignmentStatus, Badge, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { initialsFromEmail } from './initials.util';
import { currentLevelProgressPercent, levelForXp, xpForNextLevel } from './level.util';
import {
  BADGE_CODES,
  COURSE_COMPLETION_XP,
  KNOWLEDGE_HUNTER_THRESHOLD,
  LEADERBOARD_LIMIT,
  LeaderboardScope,
  PERFECT_SCORE_XP,
} from './gamification.constants';
import { BadgeListItemDto } from './dto/badge-list-item.dto';
import { LeaderboardEntryDto } from './dto/leaderboard-entry.dto';
import { UserGamificationSummaryDto } from './dto/user-gamification-summary.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface CourseCompletionResult {
  xpGained: number;
  newLevel: number;
  // true tylko gdy newLevel > poziom SPRZED tego przyznania XP - front
  // (CourseRewardModal) pokazuje osobny komunikat o awansie tylko wtedy.
  leveledUp: boolean;
  unlockedBadges: Badge[];
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
    options: { score: number | null },
  ): Promise<CourseCompletionResult> {
    let xpGained = COURSE_COMPLETION_XP;
    if (options.score === 100) {
      xpGained += PERFECT_SCORE_XP;
    }

    const candidateCodes = await this.determineCandidateBadgeCodes(tx, organizationId, userId, options);

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

    return { xpGained, newLevel, leveledUp: newLevel > previousLevel, unlockedBadges };
  }

  async getMyGamificationSummary(organizationId: string, userId: string): Promise<UserGamificationSummaryDto> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { xp: true, level: true, avatarUrl: true },
      });
      const unlocked = await tx.userBadge.findMany({
        where: { organizationId, userId },
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

  async listBadgesWithUnlockStatus(organizationId: string, userId: string): Promise<BadgeListItemDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const [badges, unlockedRows] = await Promise.all([
        tx.badge.findMany({ orderBy: { createdAt: 'asc' } }),
        tx.userBadge.findMany({ where: { organizationId, userId } }),
      ]);
      const unlockedByBadgeId = new Map(unlockedRows.map((row) => [row.badgeId, row.unlockedAt]));

      return badges.map((badge) => ({
        code: badge.code,
        title: badge.title,
        description: badge.description,
        icon: badge.icon,
        xpReward: badge.xpReward,
        isUnlocked: unlockedByBadgeId.has(badge.id),
        unlockedAt: unlockedByBadgeId.get(badge.id) ?? null,
      }));
    });
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

  private async determineCandidateBadgeCodes(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    options: { score: number | null },
  ): Promise<string[]> {
    const codes: string[] = [];

    // Liczony PO tym, jak CoursesService.submitBlockProgress już zapisał ten
    // CourseAssignment jako COMPLETED (wołane w tej samej transakcji, w tej
    // kolejności) - więc właśnie ukończony kurs jest już wliczony.
    //
    // Celowo BEZ filtra archivedAt (D-069): to licznik UKOŃCZEŃ w całej historii, nie "ile różnych kursów mam
    // teraz ukończonych" - powtórne ukończenie tego samego kursu po restarcie doliczy się tu ponownie, tak samo jak
    // już wcześniej (przed D-069) każde kolejne ukończenie zwiększało XP (GamificationService.awardCourseCompletion
    // nie ma parametru courseId - znany, udokumentowany kompromis, patrz B-091). Restart nie pogarsza tego stanu,
    // tylko go po raz pierwszy realnie udostępnia (wcześniej ten sam kurs nie dał się ukończyć dwa razy).
    const completedCount = await tx.courseAssignment.count({
      where: { organizationId, userId, status: AssignmentStatus.COMPLETED },
    });

    if (completedCount === 1) {
      codes.push(BADGE_CODES.FIRST_STEP);
    }
    if (options.score === 100) {
      codes.push(BADGE_CODES.PERFECT_SCORE);
    }
    if (completedCount === KNOWLEDGE_HUNTER_THRESHOLD) {
      codes.push(BADGE_CODES.KNOWLEDGE_HUNTER);
    }

    const phishingCategoryFilter = { course: { category: 'PHISHING_SOCIAL_ENGINEERING' as const } };
    const [phishingTotal, phishingCompleted] = await Promise.all([
      tx.courseAssignment.count({ where: { organizationId, userId, ...phishingCategoryFilter } }),
      tx.courseAssignment.count({
        where: { organizationId, userId, status: AssignmentStatus.COMPLETED, ...phishingCategoryFilter },
      }),
    ]);
    if (phishingTotal > 0 && phishingTotal === phishingCompleted) {
      codes.push(BADGE_CODES.PHISHING_SPOTTER);
    }

    return codes;
  }

  /**
   * Zwraca odznakę, jeśli udało się ją PIERWSZY RAZ przyznać temu userowi,
   * albo null (odznaka nieseedowana, albo już odblokowana wcześniej -
   * @@unique([userId, badgeId]) chroni przed duplikatem nawet przy
   * współbieżnych wywołaniach, nie tylko przez logiczny check wyżej).
   */
  private async tryUnlockBadge(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    code: string,
  ): Promise<Badge | null> {
    const badge = await tx.badge.findUnique({ where: { code } });
    if (!badge) {
      return null;
    }

    try {
      await tx.userBadge.create({ data: { userId, badgeId: badge.id, organizationId } });
      return badge;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return null;
      }
      throw error;
    }
  }
}
