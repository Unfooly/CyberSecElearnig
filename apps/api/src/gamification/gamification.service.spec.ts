import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { GamificationService } from './gamification.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BADGE_CODES } from './gamification.constants';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('GamificationService', () => {
  let service: GamificationService;
  let runInOrgContext: jest.Mock;

  beforeEach(async () => {
    runInOrgContext = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [GamificationService, { provide: TenantPrismaService, useValue: { runInOrgContext } }],
    }).compile();

    service = module.get(GamificationService);
  });

  describe('awardCourseCompletion', () => {
    function buildTx(options: {
      completedCount: number;
      phishingTotal?: number;
      phishingCompleted?: number;
      existingBadgeCodes?: string[];
      userXpBefore?: number;
      userLevelBefore?: number;
    }) {
      const {
        completedCount,
        phishingTotal = 0,
        phishingCompleted = 0,
        existingBadgeCodes = [],
        userXpBefore = 0,
        userLevelBefore = 1,
      } = options;

      let currentXp = userXpBefore;
      let currentLevel = userLevelBefore;

      const badgesByCode: Record<string, { id: string; code: string; xpReward: number }> = {
        [BADGE_CODES.FIRST_STEP]: { id: 'badge-first-step', code: BADGE_CODES.FIRST_STEP, xpReward: 50 },
        [BADGE_CODES.PERFECT_SCORE]: { id: 'badge-perfect-score', code: BADGE_CODES.PERFECT_SCORE, xpReward: 50 },
        [BADGE_CODES.KNOWLEDGE_HUNTER]: {
          id: 'badge-knowledge-hunter',
          code: BADGE_CODES.KNOWLEDGE_HUNTER,
          xpReward: 100,
        },
        [BADGE_CODES.PHISHING_SPOTTER]: {
          id: 'badge-phishing-spotter',
          code: BADGE_CODES.PHISHING_SPOTTER,
          xpReward: 75,
        },
      };

      const alreadyUnlocked = new Set(existingBadgeCodes);

      const tx = {
        courseAssignment: {
          count: jest.fn((args: { where: Record<string, unknown> }) => {
            // Rozróżnia licznik "wszystkie COMPLETED" od liczników phishing
            // po obecności zagnieżdżonego filtra `course`.
            if (args.where.course) {
              return args.where.status ? phishingCompleted : phishingTotal;
            }
            return completedCount;
          }),
        },
        badge: {
          findUnique: jest.fn(({ where: { code } }: { where: { code: string } }) => badgesByCode[code] ?? null),
        },
        userBadge: {
          create: jest.fn(({ data }: { data: { badgeId: string } }) => {
            const badge = Object.values(badgesByCode).find((b) => b.id === data.badgeId)!;
            if (alreadyUnlocked.has(badge.code)) {
              throw uniqueConstraintError();
            }
            alreadyUnlocked.add(badge.code);
            return { id: 'user-badge-1' };
          }),
        },
        user: {
          update: jest.fn(({ data }: { data: { xp?: { increment: number }; level?: number } }) => {
            if (data.xp) {
              currentXp += data.xp.increment;
            }
            if (data.level !== undefined) {
              currentLevel = data.level;
            }
            return { id: 'user-1', xp: currentXp, level: currentLevel };
          }),
        },
      };

      return tx;
    }

    it('przyznaje bazowe +100 XP za ukończenie kursu bez perfekcyjnego wyniku', async () => {
      const tx = buildTx({ completedCount: 2 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.xpGained).toBe(100);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { xp: { increment: 100 } },
      });
    });

    it('dolicza bonusowe +50 XP za wynik 100%', async () => {
      const tx = buildTx({ completedCount: 2 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 100 });

      // +100 bazowe +50 za perfect score +50 xpReward odznaki PERFECT_SCORE = 200
      expect(result.xpGained).toBe(200);
      expect(result.unlockedBadges.map((b) => b.code)).toContain(BADGE_CODES.PERFECT_SCORE);
    });

    it('odblokowuje FIRST_STEP przy pierwszym ukończonym kursie (completedCount===1)', async () => {
      const tx = buildTx({ completedCount: 1 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.unlockedBadges.map((b) => b.code)).toContain(BADGE_CODES.FIRST_STEP);
    });

    it('NIE odblokowuje FIRST_STEP drugi raz (unique constraint -> pomijane, bez podwójnego XP)', async () => {
      const tx = buildTx({ completedCount: 1, existingBadgeCodes: [BADGE_CODES.FIRST_STEP] });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.unlockedBadges.map((b) => b.code)).not.toContain(BADGE_CODES.FIRST_STEP);
      expect(result.xpGained).toBe(100);
    });

    it('odblokowuje KNOWLEDGE_HUNTER dokładnie przy 5. ukończonym kursie', async () => {
      const tx = buildTx({ completedCount: 5 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.unlockedBadges.map((b) => b.code)).toContain(BADGE_CODES.KNOWLEDGE_HUNTER);
    });

    it('odblokowuje PHISHING_SPOTTER, gdy wszystkie przypisane kursy phishingowe są ukończone', async () => {
      const tx = buildTx({ completedCount: 3, phishingTotal: 2, phishingCompleted: 2 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.unlockedBadges.map((b) => b.code)).toContain(BADGE_CODES.PHISHING_SPOTTER);
    });

    it('NIE odblokowuje PHISHING_SPOTTER, gdy user nie ma żadnego przypisanego kursu phishingowego', async () => {
      const tx = buildTx({ completedCount: 3, phishingTotal: 0, phishingCompleted: 0 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.unlockedBadges.map((b) => b.code)).not.toContain(BADGE_CODES.PHISHING_SPOTTER);
    });

    it('awansuje na wyższy poziom po przekroczeniu progu XP (level 1 -> 2 przy xp>=100)', async () => {
      const tx = buildTx({ completedCount: 2, userXpBefore: 0, userLevelBefore: 1 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 80 });

      expect(result.newLevel).toBe(2);
      expect(result.leveledUp).toBe(true);
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { level: 2 } });
    });

    it('NIE zapisuje poziomu drugi raz, jeśli XP nie przekroczyło progu następnego levelu, i leveledUp=false', async () => {
      const tx = buildTx({ completedCount: 2, userXpBefore: 500, userLevelBefore: 3 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', { score: 50 });

      expect(result.leveledUp).toBe(false);
      const levelUpdateCalls = tx.user.update.mock.calls.filter((call) => call[0].data.level !== undefined);
      expect(levelUpdateCalls).toHaveLength(0);
    });
  });

  describe('getMyGamificationSummary', () => {
    it('liczy nextLevelXp i currentLevelProgressPercent zgodnie z formułą levelu', async () => {
      const tx = {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ xp: 250, level: 2, avatarUrl: 'fox' }) },
        userBadge: { findMany: jest.fn().mockResolvedValue([]) },
      };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.getMyGamificationSummary('org-1', 'user-1');

      expect(result.xp).toBe(250);
      expect(result.level).toBe(2);
      expect(result.nextLevelXp).toBe(400); // 2^2 * 100
      expect(result.currentLevelProgressPercent).toBe(50); // (250-100)/(400-100)
      expect(result.avatarUrl).toBe('fox');
    });
  });

  describe('listBadgesWithUnlockStatus', () => {
    it('oznacza isUnlocked=true wyłącznie dla odznak, które user faktycznie odblokował', async () => {
      const tx = {
        badge: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'badge-1', code: 'FIRST_STEP', title: 'A', description: 'a', icon: 'a', xpReward: 50, createdAt: new Date() },
            { id: 'badge-2', code: 'PERFECT_SCORE', title: 'B', description: 'b', icon: 'b', xpReward: 50, createdAt: new Date() },
          ]),
        },
        userBadge: {
          findMany: jest.fn().mockResolvedValue([{ badgeId: 'badge-1', unlockedAt: new Date('2026-01-01') }]),
        },
      };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.listBadgesWithUnlockStatus('org-1', 'user-1');

      expect(result.find((b) => b.code === 'FIRST_STEP')?.isUnlocked).toBe(true);
      expect(result.find((b) => b.code === 'PERFECT_SCORE')?.isUnlocked).toBe(false);
      expect(result.find((b) => b.code === 'PERFECT_SCORE')?.unlockedAt).toBeNull();
    });
  });

  describe('getLeaderboard', () => {
    it('filtruje WYŁĄCZNIE po organizationId przekazanym z JWT (scope=organization)', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const tx = { user: { findMany, findUniqueOrThrow: jest.fn() } };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      await service.getLeaderboard('org-1', 'user-1', 'organization');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });

    it('zwraca pusty ranking (nie błąd) dla scope=department, gdy requester nie ma przypisanego działu', async () => {
      const tx = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ departmentId: null }),
          findMany: jest.fn(),
        },
      };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.getLeaderboard('org-1', 'user-1', 'department');

      expect(result).toEqual([]);
      expect(tx.user.findMany).not.toHaveBeenCalled();
    });

    it('dla scope=department filtruje po departmentId REQUESTERA, nie po żadnym wejściu klienta', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const tx = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ departmentId: 'dept-1' }),
          findMany,
        },
      };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      await service.getLeaderboard('org-1', 'user-1', 'department');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', departmentId: 'dept-1' } }),
      );
    });

    it('używa inicjałów z e-maila, gdy firstName/lastName są puste', async () => {
      const tx = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'user-1',
              firstName: null,
              lastName: null,
              email: 'jan.kowalski@example.test',
              avatarUrl: null,
              level: 1,
              xp: 0,
              department: null,
            },
          ]),
          findUniqueOrThrow: jest.fn(),
        },
      };
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      const [entry] = await service.getLeaderboard('org-1', 'user-1', 'organization');

      expect(entry.firstName).toBe('J');
      expect(entry.lastName).toBe('K');
      expect(entry.rank).toBe(1);
    });
  });
});
