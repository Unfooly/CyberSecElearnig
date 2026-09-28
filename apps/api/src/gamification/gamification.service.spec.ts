import { Test, TestingModule } from '@nestjs/testing';
import { GamificationService } from './gamification.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { completionAchievements, easterEggAchievements } from './achievements';
import { ACHIEVEMENT_CODES, ACHIEVEMENTS_SYNC_VERSION, MODULE_1_SLUG } from './gamification.constants';

/** Kontekst ukończenia: domyślnie kurs spoza modułu 1, bez dowodów. */
const opts = (overrides: { score: number | null; courseSlug?: string | null; evidence?: { collected: number; total: number } }) => ({
  courseSlug: null,
  evidence: { collected: 0, total: 0 },
  assignmentId: 'assignment-now',
  ...overrides,
});

/** Transakcja-atrapa: katalog osiągnięć, user_badges z ON CONFLICT DO NOTHING (skipDuplicates), XP/poziom użytkownika. */
function buildTx(options: {
  completedCount: number;
  existingBadgeCodes?: string[];
  retired?: string[];
  userXpBefore?: number;
  userLevelBefore?: number;
  // Wersja przyznania wstecznego użytkownika; domyślnie już przeszedł (backfill pomijany).
  syncVersion?: number;
}) {
  const { completedCount, existingBadgeCodes = [], retired = [], userXpBefore = 0, userLevelBefore = 1, syncVersion = 1 } = options;

  let currentXp = userXpBefore;
  let currentLevel = userLevelBefore;

  const catalog = [
    { id: 'badge-first-case', code: ACHIEVEMENT_CODES.FIRST_CASE_CLOSED, xpReward: 50 },
    { id: 'badge-flawless', code: ACHIEVEMENT_CODES.FLAWLESS_CASE, xpReward: 50 },
    { id: 'badge-curious', code: ACHIEVEMENT_CODES.CURIOUS_DETECTIVE, xpReward: 0 },
  ].map((badge) => ({ ...badge, retiredAt: retired.includes(badge.code) ? new Date() : null }));

  const alreadyUnlocked = new Set(existingBadgeCodes);

  return {
    courseAssignment: { count: jest.fn(() => completedCount) },
    badge: {
      findUnique: jest.fn(({ where: { code } }: { where: { code: string } }) => catalog.find((b) => b.code === code) ?? null),
    },
    userBadge: {
      createMany: jest.fn(({ data }: { data: { badgeId: string }[]; skipDuplicates: boolean }) => {
        const badge = catalog.find((b) => b.id === data[0].badgeId)!;
        if (alreadyUnlocked.has(badge.code)) return { count: 0 };
        alreadyUnlocked.add(badge.code);
        return { count: 1 };
      }),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ achievementsSyncVersion: syncVersion }),
      update: jest.fn(({ data }: { data: { xp?: { increment: number }; level?: number; achievementsSyncVersion?: number } }) => {
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
    it('przyznaje bazowe +100 XP za ukończenie kursu bez perfekcyjnego wyniku (pierwsza sprawa już zdobyta)', async () => {
      const tx = buildTx({ completedCount: 2, existingBadgeCodes: [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED] });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));

      expect(result.xpGained).toBe(100);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { xp: { increment: 100 } },
      });
    });

    it('dolicza bonusowe +50 XP za wynik 100% (bez osiągnięcia spoza modułu 1)', async () => {
      const tx = buildTx({ completedCount: 2, existingBadgeCodes: [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED] });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 100 }));

      expect(result.xpGained).toBe(150);
      expect(result.unlockedBadges).toEqual([]);
    });

    it('pierwsze ukończenie: First Case Closed (+50 XP osiągnięcia)', async () => {
      const tx = buildTx({ completedCount: 1 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));

      expect(result.unlockedBadges.map((b) => b.code)).toEqual([ACHIEVEMENT_CODES.FIRST_CASE_CLOSED]);
      expect(result.xpGained).toBe(150);
    });

    it('NIE przyznaje drugi raz (ON CONFLICT DO NOTHING -> pomijane, bez podwójnego XP)', async () => {
      const tx = buildTx({ completedCount: 1, existingBadgeCodes: [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED] });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));

      expect(result.unlockedBadges).toEqual([]);
      expect(result.xpGained).toBe(100);
    });

    it('moduł 1, komplet dowodów i 100%: Flawless Case; brak jednego dowodu - nie', async () => {
      const full = await service.awardCourseCompletion(
        buildTx({ completedCount: 1 }) as never,
        'org-1',
        'user-1',
        opts({ score: 100, courseSlug: MODULE_1_SLUG, evidence: { collected: 23, total: 23 } }),
      );
      expect(full.unlockedBadges.map((b) => b.code)).toEqual([ACHIEVEMENT_CODES.FIRST_CASE_CLOSED, ACHIEVEMENT_CODES.FLAWLESS_CASE]);

      const missing = await service.awardCourseCompletion(
        buildTx({ completedCount: 1 }) as never,
        'org-1',
        'user-1',
        opts({ score: 100, courseSlug: MODULE_1_SLUG, evidence: { collected: 22, total: 23 } }),
      );
      expect(missing.unlockedBadges.map((b) => b.code)).toEqual([ACHIEVEMENT_CODES.FIRST_CASE_CLOSED]);
    });

    it('najpierw przyznanie wsteczne z WCZEŚNIEJSZYCH podejść (bez XP), potem „na żywo” za bieżące - XP nie zależy od kolejności wejść', async () => {
      // Ukończenie sprzed wdrożenia (inne przypisanie) + teraz kolejne: First Case Closed z backfillu (bez XP), więc tu nic nowego.
      const tx = {
        ...buildTx({ completedCount: 2, syncVersion: 0 }),
        courseAssignment: {
          count: jest.fn(() => 2),
          findMany: jest.fn().mockResolvedValue([
            { id: 'assignment-old', status: 'COMPLETED', score: 80, progress: null, completedAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01'), courseVersionId: null, course: { slug: null } },
            // Właśnie ukończone - jego ukończenie idzie „na żywo”, nie z backfillu.
            { id: 'assignment-now', status: 'COMPLETED', score: 80, progress: null, completedAt: new Date('2026-09-28'), updatedAt: new Date('2026-09-28'), courseVersionId: null, course: { slug: null } },
          ]),
        },
      };
      tx.userBadge = { ...tx.userBadge, findMany: jest.fn().mockResolvedValue([]) } as never;

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));

      expect(tx.userBadge.createMany.mock.calls[0][0].data[0]).toMatchObject({ badgeId: 'badge-first-case', unlockedAt: new Date('2026-09-01') });
      expect(result.unlockedBadges).toEqual([]);
      expect(result.xpGained).toBe(100);
    });

    it('ukończenie teraz z easter eggiem zapisanym przed wdrożeniem: Curious Detective z backfillu (bez XP), First Case Closed na żywo (z XP)', async () => {
      const base = buildTx({ completedCount: 1, syncVersion: 0 });
      const tx = {
        ...base,
        userBadge: { ...base.userBadge, findMany: jest.fn().mockResolvedValue([]) },
        courseAssignment: {
          count: jest.fn(() => 1),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'assignment-now',
              status: 'COMPLETED',
              score: 80,
              progress: {
                v: 2,
                blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: '2026-09-27T09:00:00Z', weight: 0, easterEggs: ['ciekawski-detektyw'] } },
                notes: [],
              },
              completedAt: new Date('2026-09-28'),
              updatedAt: new Date('2026-09-28'),
              courseVersionId: 'v1',
              course: { slug: MODULE_1_SLUG },
            },
          ]),
        },
      };

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80, courseSlug: MODULE_1_SLUG }));

      expect(tx.userBadge.createMany.mock.calls[0][0].data[0]).toMatchObject({ badgeId: 'badge-curious', unlockedAt: new Date('2026-09-27T09:00:00Z') });
      expect(result.unlockedBadges.map((b) => b.code)).toEqual([ACHIEVEMENT_CODES.FIRST_CASE_CLOSED]);
      expect(result.xpGained).toBe(150);
    });

    it('wycofana odznaka (retiredAt) nie jest przyznawana', async () => {
      const tx = buildTx({ completedCount: 1, retired: [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED] });
      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));
      expect(result.unlockedBadges).toEqual([]);
      expect(tx.userBadge.createMany).not.toHaveBeenCalled();
    });

    it('awansuje na wyższy poziom po przekroczeniu progu XP (level 1 -> 2 przy xp>=100)', async () => {
      const tx = buildTx({ completedCount: 2, userXpBefore: 0, userLevelBefore: 1 });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 80 }));

      expect(result.newLevel).toBe(2);
      expect(result.previousLevel).toBe(1);
      expect(result.leveledUp).toBe(true);
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { level: 2 } });
      // Pasek "przed -> po" (SummaryScreen): 0 XP sprzed = 0% starego poziomu (1); awans przycina "po" do 100 -
      // pasek pokazuje "napełnienie" starego poziomu, sam awans/numer nowego poziomu pokazuje leveledUp/newLevel.
      expect(result.levelProgressBeforePercent).toBe(0);
      expect(result.levelProgressAfterPercent).toBe(100);
    });

    it('NIE zapisuje poziomu drugi raz, jeśli XP nie przekroczyło progu następnego levelu, i leveledUp=false', async () => {
      const tx = buildTx({ completedCount: 2, userXpBefore: 500, userLevelBefore: 3, existingBadgeCodes: [ACHIEVEMENT_CODES.FIRST_CASE_CLOSED] });

      const result = await service.awardCourseCompletion(tx as never, 'org-1', 'user-1', opts({ score: 50 }));

      expect(result.leveledUp).toBe(false);
      const levelUpdateCalls = tx.user.update.mock.calls.filter((call) => call[0].data.level !== undefined);
      expect(levelUpdateCalls).toHaveLength(0);
      // Bez awansu: "przed"/"po" liczone w TEJ SAMEJ skali (poziom 3, próg 400..900) - 500 XP = 20%, +100 XP = 40%.
      expect(result.levelProgressBeforePercent).toBe(20);
      expect(result.levelProgressAfterPercent).toBe(40);
    });

    it('przeskakuje WIĘCEJ niż jeden poziom w jednym ukończeniu (previousLevel != newLevel-1), gdy suma XP+bonusy+osiągnięcia przebija próg kolejnego poziomu', async () => {
      // 199 XP + 100 (bazowe) + 50 (perfect score) + 50 (First Case Closed) + 50 (Flawless Case) = 449 XP -> poziom 3 (próg 400),
      // z poziomu 1 (zapisany poziom sprzed - np. po zmianie progów), NIE poziom 2.
      const tx = buildTx({ completedCount: 1, userXpBefore: 199, userLevelBefore: 1 });

      const result = await service.awardCourseCompletion(
        tx as never,
        'org-1',
        'user-1',
        opts({ score: 100, courseSlug: MODULE_1_SLUG, evidence: { collected: 23, total: 23 } }),
      );

      expect(result.previousLevel).toBe(1);
      expect(result.newLevel).toBe(3);
      expect(result.leveledUp).toBe(true);
      // Skok: newLevel (3) - previousLevel (1) > 1 - front (RewardCard.tsx) nie może zakładać newLevel===previousLevel+1.
      expect(result.newLevel - result.previousLevel).toBeGreaterThan(1);
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { level: 3 } });
      expect(result.levelProgressAfterPercent).toBe(100);
    });
  });

  describe('awardEasterEggAchievements', () => {
    it('easter egg modułu 1 przyznaje Curious Detective raz; inny moduł albo brak wyróżnienia - nic', async () => {
      const tx = buildTx({ completedCount: 0 });
      const first = await service.awardEasterEggAchievements(tx as never, 'org-1', 'user-1', MODULE_1_SLUG, ['ciekawski-detektyw']);
      expect(first.map((b) => b.code)).toEqual([ACHIEVEMENT_CODES.CURIOUS_DETECTIVE]);
      expect(tx.userBadge.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'user-1', badgeId: 'badge-curious', organizationId: 'org-1' }],
        skipDuplicates: true,
      });
      expect(await service.awardEasterEggAchievements(tx as never, 'org-1', 'user-1', MODULE_1_SLUG, ['ciekawski-detektyw'])).toEqual([]);
      expect(await service.awardEasterEggAchievements(tx as never, 'org-1', 'user-1', 'inny-modul', ['ciekawski-detektyw'])).toEqual([]);
      expect(await service.awardEasterEggAchievements(tx as never, 'org-1', 'user-1', MODULE_1_SLUG, undefined)).toEqual([]);
      // Bez XP (D-100: easter egg nie wpływa na XP).
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe('syncAchievements (przyznanie wsteczne)', () => {
    const moduleBlocks = [
      { id: 'scena', type: 'SCENE_HOTSPOTS', hotspots: [{ id: 'dowod', evidence: true, note: { text: 'Ślad' } }] },
    ];
    function syncTx(options: { owned?: string[]; assignments: Record<string, unknown>[]; syncVersion?: number }) {
      const tx = buildTx({ completedCount: 0, existingBadgeCodes: options.owned, syncVersion: options.syncVersion ?? 0 });
      return {
        ...tx,
        userBadge: {
          ...tx.userBadge,
          findMany: jest.fn().mockResolvedValue((options.owned ?? []).map((code) => ({ badge: { code } }))),
        },
        courseAssignment: { ...tx.courseAssignment, findMany: jest.fn().mockResolvedValue(options.assignments) },
        courseVersion: {
          findUnique: jest.fn().mockResolvedValue({ id: 'v1', version: 1, schemaVersion: 5, contentBlocks: moduleBlocks }),
        },
      };
    }
    const completedAt = new Date('2026-09-20T10:00:00Z');
    const module1 = (progress: unknown, score: number | null, status = 'COMPLETED') => ({
      id: 'assignment-old',
      status,
      score,
      progress,
      completedAt: status === 'COMPLETED' ? completedAt : null,
      updatedAt: completedAt,
      courseVersionId: 'v1',
      course: { slug: MODULE_1_SLUG },
    });

    it('kto spełnił warunki wcześniej, dostaje wszystkie trzy - z datą spełnienia warunku, bez XP; drugi bieg nic nie dodaje', async () => {
      const progress = {
        v: 2,
        blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: '2026-09-20T09:55:00Z', weight: 0, easterEggs: ['ciekawski-detektyw'] } },
        notes: ['scena.dowod'],
      };
      const tx = syncTx({ assignments: [module1(progress, 100)] });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      const created = tx.userBadge.createMany.mock.calls.map((call) => call[0].data[0]);
      expect(created).toEqual(
        expect.arrayContaining([
          { userId: 'user-1', badgeId: 'badge-first-case', organizationId: 'org-1', unlockedAt: completedAt },
          { userId: 'user-1', badgeId: 'badge-flawless', organizationId: 'org-1', unlockedAt: completedAt },
          { userId: 'user-1', badgeId: 'badge-curious', organizationId: 'org-1', unlockedAt: new Date('2026-09-20T09:55:00Z') },
        ]),
      );
      expect(created).toHaveLength(3);
      // Bez XP; jedyny zapis użytkownika to znacznik przyznania wstecznego.
      expect(tx.user.update.mock.calls.map((call) => call[0].data)).toEqual([{ achievementsSyncVersion: ACHIEVEMENTS_SYNC_VERSION }]);
      // Zapytania wyłącznie w organizacji i dla użytkownika z wywołania.
      expect(tx.courseAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }) }));
    });

    it('znacznik: użytkownik po przyznaniu wstecznym (aktualna wersja) - nic nie czyta ani nie zapisuje', async () => {
      const tx = syncTx({ assignments: [module1({ v: 2, blocks: {}, notes: [] }, 100)], syncVersion: ACHIEVEMENTS_SYNC_VERSION });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      expect(tx.userBadge.findMany).not.toHaveBeenCalled();
      expect(tx.courseAssignment.findMany).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('wywołane z ukończenia: ukończenie bieżącego przypisania pominięte (idzie „na żywo”), ale jego easter egg sprzed wdrożenia przyznany', async () => {
      const progress = {
        v: 2,
        blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: '2026-09-20T09:55:00Z', weight: 0, easterEggs: ['ciekawski-detektyw'] } },
        notes: ['scena.dowod'],
      };
      const tx = syncTx({ assignments: [{ ...module1(progress, 100), id: 'assignment-now' }] });
      await service.syncAchievements(tx as never, 'org-1', 'user-1', 'assignment-now');
      expect(tx.userBadge.createMany.mock.calls.map((call) => call[0].data[0].badgeId)).toEqual(['badge-curious']);
      expect(tx.courseVersion.findUnique).not.toHaveBeenCalled();
    });

    it('uszkodzony postęp nie blokuje profilu: wpis nie-obiekt pominięty, brak/zła data -> data zmiany przypisania, zła treść wersji -> bez sprawy bez skazy', async () => {
      const progress = {
        v: 2,
        blocks: { zly: null, scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: 'nie-data', weight: 0, easterEggs: ['ciekawski-detektyw'] } },
        notes: ['scena.dowod'],
      };
      const tx = syncTx({ assignments: [module1(progress, 100)] });
      tx.courseVersion.findUnique.mockResolvedValue({ id: 'v1', version: 1, schemaVersion: 5, contentBlocks: 'uszkodzone' });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      const created = tx.userBadge.createMany.mock.calls.map((call) => call[0].data[0] as { badgeId: string; unlockedAt?: Date });
      expect(created.map((row) => row.badgeId).sort()).toEqual(['badge-curious', 'badge-first-case']);
      expect(created.find((row) => row.badgeId === 'badge-curious')!.unlockedAt).toEqual(completedAt);
    });

    it('sprawa bez skazy wymaga kompletu dowodów: 100% bez zebranego dowodu daje tylko pierwszą sprawę', async () => {
      const tx = syncTx({ assignments: [module1({ v: 2, blocks: {}, notes: [] }, 100)] });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      expect(tx.userBadge.createMany.mock.calls.map((call) => call[0].data[0].badgeId)).toEqual(['badge-first-case']);
    });

    it('easter egg bez ukończenia kursu też się liczy (przypisanie w toku)', async () => {
      const progress = {
        v: 2,
        blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: '2026-09-20T09:55:00Z', weight: 0, easterEggs: ['ciekawski-detektyw'] } },
        notes: [],
      };
      const tx = syncTx({ assignments: [module1(progress, null, 'IN_PROGRESS')] });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      expect(tx.userBadge.createMany.mock.calls.map((call) => call[0].data[0].badgeId)).toEqual(['badge-curious']);
    });

    it('komplet osiągnięć: nie czyta przypisań, tylko ustawia znacznik', async () => {
      const tx = syncTx({ owned: Object.values(ACHIEVEMENT_CODES), assignments: [] });
      await service.syncAchievements(tx as never, 'org-1', 'user-1');
      expect(tx.courseAssignment.findMany).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { achievementsSyncVersion: ACHIEVEMENTS_SYNC_VERSION } });
    });
  });

  describe('warunki osiągnięć (czyste funkcje)', () => {
    const evidence = (collected: number, total: number) => ({ collected, total });
    it('pierwsza sprawa za każde ukończenie; sprawa bez skazy tylko moduł 1 + 100% + komplet dowodów', () => {
      expect(completionAchievements({ completedCount: 1, score: null, courseSlug: null, evidence: evidence(0, 0) })).toEqual([ACHIEVEMENT_CODES.FIRST_CASE_CLOSED]);
      expect(completionAchievements({ completedCount: 3, score: 100, courseSlug: MODULE_1_SLUG, evidence: evidence(23, 23) })).toEqual([
        ACHIEVEMENT_CODES.FIRST_CASE_CLOSED,
        ACHIEVEMENT_CODES.FLAWLESS_CASE,
      ]);
      expect(completionAchievements({ completedCount: 1, score: 100, courseSlug: MODULE_1_SLUG, evidence: evidence(22, 23) })).not.toContain(ACHIEVEMENT_CODES.FLAWLESS_CASE);
      expect(completionAchievements({ completedCount: 1, score: 99, courseSlug: MODULE_1_SLUG, evidence: evidence(23, 23) })).not.toContain(ACHIEVEMENT_CODES.FLAWLESS_CASE);
      expect(completionAchievements({ completedCount: 1, score: 100, courseSlug: 'inny', evidence: evidence(5, 5) })).not.toContain(ACHIEVEMENT_CODES.FLAWLESS_CASE);
      expect(completionAchievements({ completedCount: 1, score: 100, courseSlug: MODULE_1_SLUG, evidence: evidence(0, 0) })).not.toContain(ACHIEVEMENT_CODES.FLAWLESS_CASE);
    });
    it('easter egg: tylko wyróżnienie ciekawski-detektyw w module 1', () => {
      expect(easterEggAchievements(MODULE_1_SLUG, ['ciekawski-detektyw'])).toEqual([ACHIEVEMENT_CODES.CURIOUS_DETECTIVE]);
      expect(easterEggAchievements(MODULE_1_SLUG, ['inne'])).toEqual([]);
      expect(easterEggAchievements(null, ['ciekawski-detektyw'])).toEqual([]);
    });
  });

  describe('getMyGamificationSummary', () => {
    it('liczy nextLevelXp i currentLevelProgressPercent zgodnie z formułą levelu', async () => {
      const tx = {
        // achievementsSyncVersion aktualne: przyznanie wsteczne już było (tu pomijane).
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ xp: 250, level: 2, avatarUrl: 'fox', achievementsSyncVersion: ACHIEVEMENTS_SYNC_VERSION }) },
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
    const catalog = [
      { id: 'badge-first-case', code: 'first-case-closed', title: 'First Case Closed', description: 'a', conditionText: 'Ukończ.', icon: 'p', lockedIcon: 'p-z', xpReward: 50, rank: 'MILESTONE', hidden: false, scope: 'GLOBAL' },
      { id: 'badge-curious', code: 'curious-detective', title: 'Curious Detective', description: 'c', conditionText: 'Gra.', icon: 'c', lockedIcon: 'osiagniecie-tajne-zablokowane', xpReward: 25, rank: 'SECRET', hidden: true, scope: 'MODULE' },
    ];
    function listTx(unlocked: { badgeId: string; unlockedAt: Date }[]) {
      return {
        badge: { findMany: jest.fn().mockResolvedValue(catalog) },
        // Przyznanie wsteczne już było (znacznik aktualny) - sync nic nie czyta.
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ achievementsSyncVersion: ACHIEVEMENTS_SYNC_VERSION }) },
        userBadge: { findMany: jest.fn().mockResolvedValue(unlocked) },
      };
    }

    it('bez wycofanych odznak, w kolejności katalogu; isUnlocked wyłącznie dla zdobytych', async () => {
      const tx = listTx([{ badgeId: 'badge-first-case', unlockedAt: new Date('2026-09-20') }]);
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.listBadgesWithUnlockStatus('org-1', 'user-1');

      expect(tx.badge.findMany).toHaveBeenCalledWith({ where: { retiredAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      expect(result[0]).toMatchObject({ code: 'first-case-closed', title: 'First Case Closed', isUnlocked: true, conditionText: 'Ukończ.' });
    });

    it('tajne niezdobyte: bez kodu, nazwy, opisu, warunku i grafiki zdobytej (tylko ranga i grafika zablokowana)', async () => {
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) => fn(listTx([])));

      const [, secret] = await service.listBadgesWithUnlockStatus('org-1', 'user-1');

      expect(secret).toEqual({
        code: 'secret-2',
        title: null,
        description: null,
        conditionText: null,
        scope: null,
        icon: 'osiagniecie-tajne-zablokowane',
        lockedIcon: 'osiagniecie-tajne-zablokowane',
        rank: 'SECRET',
        hidden: true,
        // Nagroda XP też maskowana (wartość mogłaby coś podpowiadać).
        xpReward: 0,
        isUnlocked: false,
        unlockedAt: null,
      });
      expect(JSON.stringify(secret)).not.toMatch(/curious|ciekawsk|detekty|gr[aę]/i);
    });

    it('tajne zdobyte: pełne dane', async () => {
      runInOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => unknown) =>
        fn(listTx([{ badgeId: 'badge-curious', unlockedAt: new Date('2026-09-20') }])),
      );
      const [, secret] = await service.listBadgesWithUnlockStatus('org-1', 'user-1');
      expect(secret).toMatchObject({ code: 'curious-detective', title: 'Curious Detective', icon: 'c', isUnlocked: true });
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
