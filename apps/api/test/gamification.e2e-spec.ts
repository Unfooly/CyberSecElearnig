import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

describe('Grywalizacja: XP, odznaki, leaderboard, avatar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const uniqueSuffix = Date.now();
  // orgAUser1Email/orgBUserEmail idą przez /auth/register - osobne domeny,
  // bo organizations.name jest teraz unikalne (nazwa = domena). orgAUser2Email
  // jest tworzony bezpośrednio w bazie (nie przez register), więc może zostać
  // na domenie organizacji A bez kolizji.
  const orgAUser1Email = `gami-a1-${uniqueSuffix}@org-a.gami-e2e-test.local`;
  const orgAUser2Email = `gami-a2-${uniqueSuffix}@org-a.gami-e2e-test.local`;
  const orgBUserEmail = `gami-b1-${uniqueSuffix}@org-b.gami-e2e-test.local`;

  let orgAId: string;
  let orgAUser1Id: string;
  let orgAUser1Token: string;
  let orgBToken: string;
  let departmentId: string;
  let firstStepCourseId: string;
  let perfectScoreCourseId: string;

  // Test NIE zależy od zewnętrznego `npm run seed:badges` - upsertuje
  // wyłącznie te dwie odznaki, które faktycznie wykorzystuje, żeby przejście
  // testów nie było uwarunkowane ręcznym krokiem operacyjnym.
  async function seedRequiredBadges(): Promise<void> {
    await prisma.badge.upsert({
      where: { code: 'FIRST_STEP' },
      update: {},
      create: {
        code: 'FIRST_STEP',
        title: 'Pierwszy Krok',
        description: 'Ukończono pierwszy kurs.',
        icon: 'first-step',
        xpReward: 50,
      },
    });
    await prisma.badge.upsert({
      where: { code: 'PERFECT_SCORE' },
      update: {},
      create: {
        code: 'PERFECT_SCORE',
        title: 'Sokole Oko',
        description: 'Ukończono kurs z wynikiem 100%.',
        icon: 'perfect-score',
        xpReward: 50,
      },
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    await seedRequiredBadges();

    const orgAUser1Response = await registerVerified(app, tenantPrisma, {
        email: orgAUser1Email,
        password: 'SuperSecret123!',
      });
    orgAUser1Token = orgAUser1Response.body.accessToken;

    const orgBResponse = await registerVerified(app, tenantPrisma, {
        email: orgBUserEmail,
        password: 'SuperSecret123!',
      });
    orgBToken = orgBResponse.body.accessToken;

    const orgAUser1 = await tenantPrisma.runAuthLookup({ email: orgAUser1Email });
    orgAId = orgAUser1!.organizationId;
    orgAUser1Id = orgAUser1!.id;

    // Drugi user w organizacji A - zarejestrowany bezpośrednio w bazie (nie
    // przez /auth/register, który zawsze tworzy NOWĄ organizację jako
    // ORG_ADMIN) - potrzebny do testu leaderboardu z więcej niż jednym
    // wpisem i do testu scope=department.
    const department = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.department.create({ data: { organizationId: orgAId, name: `Dział Testowy ${uniqueSuffix}` } }),
    );
    departmentId = department.id;

    // orgAUser2 istnieje wyłącznie jako fixture do testów leaderboardu
    // (drugi wpis w rankingu, wyższe xp) - nigdy się nie loguje w tym
    // teście, więc passwordHash to celowo nieużywalny placeholder.
    await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.user.create({
        data: {
          organizationId: orgAId,
          email: orgAUser2Email,
          passwordHash: 'nieużywany-placeholder-nikt-się-tym-userem-nie-loguje',
          departmentId,
          xp: 500,
          level: 3,
        },
      }),
    );

    // Kurs 1: pojedynczy blok VIDEO (bez oceny) - ukończenie odblokowuje
    // FIRST_STEP, bez bonusu za perfect score (score zostaje null).
    const firstStepCourse = await prisma.course.create({
      data: {
        title: `Kurs FIRST_STEP ${uniqueSuffix}`,
        category: 'GENERAL_AWARENESS',
        durationMinutes: 2,
        contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/gami-1.mp4' }],
      },
    });
    firstStepCourseId = firstStepCourse.id;

    // Kurs 2: pojedynczy QUIZ z jedną poprawną odpowiedzią - odpowiedź
    // poprawna daje score=100 -> bonus +50 XP i odznakę PERFECT_SCORE.
    const perfectScoreCourse = await prisma.course.create({
      data: {
        title: `Kurs PERFECT_SCORE ${uniqueSuffix}`,
        category: 'GENERAL_AWARENESS',
        durationMinutes: 2,
        contentBlocks: [
          {
            type: 'QUIZ',
            prompt: 'Pytanie testowe',
            options: [
              { text: 'Zła odpowiedź', correct: false },
              { text: 'Dobra odpowiedź', correct: true },
            ],
          },
        ],
      },
    });
    perfectScoreCourseId = perfectScoreCourse.id;

    await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.create({
        data: { organizationId: orgAId, userId: orgAUser1Id, courseId: firstStepCourseId },
      }),
    );
    await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.create({
        data: { organizationId: orgAId, userId: orgAUser1Id, courseId: perfectScoreCourseId },
      }),
    );
  });

  afterAll(async () => {
    await prisma.userBadge.deleteMany({ where: { organizationId: orgAId } });
    await prisma.courseAssignment.deleteMany({
      where: { courseId: { in: [firstStepCourseId, perfectScoreCourseId] } },
    });
    await prisma.course.deleteMany({ where: { id: { in: [firstStepCourseId, perfectScoreCourseId] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: 'gami-e2e-test.local' } } });
    await prisma.department.deleteMany({ where: { name: { startsWith: 'Dział Testowy' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'gami-e2e-test.local' } } });
    await app.close();
  });

  describe('Auth', () => {
    it('odrzuca wszystkie nowe endpointy bez tokena', async () => {
      await request(app.getHttpServer()).get('/gamification/badges').expect(401);
      await request(app.getHttpServer()).get('/gamification/leaderboard').expect(401);
      await request(app.getHttpServer()).get('/users/me/gamification').expect(401);
      await request(app.getHttpServer()).patch('/users/me/avatar').send({ avatarUrl: 'fox' }).expect(401);
    });
  });

  describe('Happy path: ukończenie kursu -> XP, level, odznaka', () => {
    it('ukończenie pierwszego kursu (bez oceny) daje +100 XP i odblokowuje FIRST_STEP', async () => {
      await request(app.getHttpServer())
        .post(`/courses/${firstStepCourseId}/start`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      const progressResponse = await request(app.getHttpServer())
        .post(`/courses/${firstStepCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ blockIndex: 0 })
        .expect(200);

      // Odpowiedź /progress sama niesie wynik grywalizacji (dla modala
      // nagrody na froncie), nie tylko GET /users/me/gamification osobno.
      expect(progressResponse.body.gamification).toEqual({
        xpGained: 150,
        newLevel: 2,
        leveledUp: true,
        unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
      });

      const summary = await request(app.getHttpServer())
        .get('/users/me/gamification')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      // +100 (ukończenie) +50 (xpReward odznaki FIRST_STEP) = 150
      expect(summary.body.xp).toBe(150);
      expect(summary.body.level).toBe(2); // floor(sqrt(150/100))+1 = 2
      expect(summary.body.badges).toContainEqual(
        expect.objectContaining({ code: 'FIRST_STEP' }),
      );
    });

    it('GET /gamification/badges pokazuje FIRST_STEP jako isUnlocked=true, PERFECT_SCORE jako false', async () => {
      const response = await request(app.getHttpServer())
        .get('/gamification/badges')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      expect(response.body).toContainEqual(
        expect.objectContaining({ code: 'FIRST_STEP', isUnlocked: true }),
      );
      expect(response.body).toContainEqual(
        expect.objectContaining({ code: 'PERFECT_SCORE', isUnlocked: false, unlockedAt: null }),
      );
    });

    it('ukończenie drugiego kursu ze 100% wyniku dolicza bonus i odblokowuje PERFECT_SCORE', async () => {
      await request(app.getHttpServer())
        .post(`/courses/${perfectScoreCourseId}/start`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/courses/${perfectScoreCourseId}/progress`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ blockIndex: 0, answer: 1 })
        .expect(200);
      expect(response.body.score).toBe(100);

      const summary = await request(app.getHttpServer())
        .get('/users/me/gamification')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      // 150 (z poprzedniego testu) + 100 (ukończenie) + 50 (bonus 100%) + 50
      // (xpReward odznaki PERFECT_SCORE) = 350
      expect(summary.body.xp).toBe(350);
      expect(summary.body.badges.map((b: { code: string }) => b.code).sort()).toEqual([
        'FIRST_STEP',
        'PERFECT_SCORE',
      ]);
    });

    it('UserBadge zapisuje prawidłowe organizationId (nie null, zgodne z organizacją usera)', async () => {
      const badges = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.userBadge.findMany({ where: { userId: orgAUser1Id } }),
      );
      expect(badges.length).toBeGreaterThanOrEqual(2);
      for (const badge of badges) {
        expect(badge.organizationId).toBe(orgAId);
      }
    });
  });

  describe('Avatar', () => {
    it('akceptuje preset z listy dozwolonych avatarów', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'fox' })
        .expect(200);
      expect(response.body.avatarUrl).toBe('fox');
    });

    it('akceptuje poprawny URL http(s)', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'https://example.test/custom-avatar.png' })
        .expect(200);
      expect(response.body.avatarUrl).toBe('https://example.test/custom-avatar.png');
    });

    it('odrzuca wartość, która nie jest ani presetem, ani poprawnym URL', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'nie-preset-i-nie-url' })
        .expect(400);
    });

    it('odrzuca protokół inny niż http/https (np. javascript:)', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'javascript:alert(1)' })
        .expect(400);
    });
  });

  describe('Leaderboard', () => {
    it('scope=organization zwraca ranking posortowany malejąco po XP, wyłącznie z własnej organizacji', async () => {
      const response = await request(app.getHttpServer())
        .get('/gamification/leaderboard')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      const userIds = response.body.map((entry: { userId: string }) => entry.userId);
      expect(userIds).toContain(orgAUser1Id);

      // orgAUser2 ma xp=500 (ustawione w fixture), więc powinien być przed
      // orgAUser1 (350 XP w tym momencie) w rankingu malejącym po XP.
      const ranks = new Map(response.body.map((e: { userId: string; rank: number }) => [e.userId, e.rank]));
      const user2Entry = response.body.find((e: { xp: number }) => e.xp === 500);
      expect(user2Entry).toBeDefined();
      expect(ranks.get(user2Entry.userId)).toBeLessThan(ranks.get(orgAUser1Id) as number);
    });

    it('izolacja tenantów: leaderboard organizacji B nigdy nie zawiera userów organizacji A', async () => {
      const orgAResponse = await request(app.getHttpServer())
        .get('/gamification/leaderboard')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);
      const orgBResponse = await request(app.getHttpServer())
        .get('/gamification/leaderboard')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);

      const orgAUserIds = orgAResponse.body.map((e: { userId: string }) => e.userId);
      const orgBUserIds = orgBResponse.body.map((e: { userId: string }) => e.userId);

      expect(orgAUserIds).toContain(orgAUser1Id);
      expect(orgBUserIds).not.toContain(orgAUser1Id);
      expect(orgAUserIds.some((id: string) => orgBUserIds.includes(id))).toBe(false);
    });

    it('scope=department zwraca tylko userów z działu requestera', async () => {
      // orgAUser1 nie ma przypisanego działu - pusty ranking, nie błąd.
      const noDeptResponse = await request(app.getHttpServer())
        .get('/gamification/leaderboard?scope=department')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);
      expect(noDeptResponse.body).toEqual([]);
    });

    it('ignoruje/odrzuca zmanipulowane organizationId w query - liczy się WYŁĄCZNIE JWT', async () => {
      // DTO (LeaderboardQueryDto) deklaruje tylko `scope` - globalny
      // ValidationPipe (forbidNonWhitelisted) odrzuca każde dodatkowe pole,
      // w tym próbę przemycenia organizationId/userId przez query.
      await request(app.getHttpServer())
        .get('/gamification/leaderboard?scope=organization&organizationId=cudza-organizacja')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(400);
    });

    it('odrzuca nieprawidłową wartość scope', async () => {
      await request(app.getHttpServer())
        .get('/gamification/leaderboard?scope=cala-platforma')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(400);
    });
  });
});
