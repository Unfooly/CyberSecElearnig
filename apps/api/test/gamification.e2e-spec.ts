import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
  const orgAUser1Email = `gami-a1-${uniqueSuffix}@org-a.gami-e2e-test.test`;
  const orgAUser2Email = `gami-a2-${uniqueSuffix}@org-a.gami-e2e-test.test`;
  const orgBUserEmail = `gami-b1-${uniqueSuffix}@org-b.gami-e2e-test.test`;

  let orgAId: string;
  let orgAUser1Id: string;
  let orgAUser1Token: string;
  let orgBToken: string;
  let departmentId: string;
  let firstStepCourseId: string;
  let perfectScoreCourseId: string;
  // Moduł 1 (osiągnięcia D-111): kurs po slugu - tworzony tu tylko, jeśli nie ma go w bazie; własna wersja testowa zawsze.
  let module1CourseId: string;
  let module1CreatedHere = false;
  let module1VersionId: string | undefined;

  // Katalog osiągnięć (D-111) wstawia migracja 20260928200000_achievements - test NIE zależy od `npm run seed:badges`.

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // listen(0), nie init(): test idempotencji wysyła równoległe żądania (CLAUDE.md, reguła 9).
    await app.listen(0);

    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

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

    // Kurs 1: pojedynczy blok VIDEO (bez oceny) - ukończenie daje osiągnięcie
    // First Case Closed, bez bonusu za perfect score (score zostaje null).
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
    // poprawna daje score=100 -> bonus +50 XP (bez osiągnięcia: to nie moduł 1).
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
    // Kursy na końcu: przypisania znikają kaskadowo z użytkownikami/organizacjami (mają FORCE RLS, więc deleteMany bez kontekstu
    // organizacji ich nie widzi), a kurs z przypisaniami jest chroniony (RESTRICT, B-032).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'gami-e2e-test.test' } } });
    await prisma.department.deleteMany({ where: { name: { startsWith: 'Dział Testowy' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'gami-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: { in: [firstStepCourseId, perfectScoreCourseId] } } });
    if (module1VersionId) await prisma.courseVersion.deleteMany({ where: { id: module1VersionId } });
    if (module1CreatedHere) await prisma.course.deleteMany({ where: { id: module1CourseId } });
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

  describe('Happy path: ukończenie kursu -> XP, level, osiągnięcie (D-111)', () => {
    it('ukończenie pierwszego kursu (bez oceny) daje +100 XP i osiągnięcie First Case Closed (+50 XP)', async () => {
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
        previousLevel: 1,
        leveledUp: true,
        unlockedBadges: [
          { code: 'first-case-closed', title: 'First Case Closed', icon: 'osiagniecie-pierwsza-sprawa', xpReward: 50, rank: 'MILESTONE' },
        ],
        // Konto zaczyna od 0 XP/poziom 1: 0% postępu SPRZED tego ukończenia; awans na poziom 2, więc pasek "przed
        // -> po" (SummaryScreen) kończy się na 100% (przycięty - sam awans/nowy poziom pokazuje osobny komunikat).
        levelProgressBeforePercent: 0,
        levelProgressAfterPercent: 100,
      });

      const summary = await request(app.getHttpServer())
        .get('/users/me/gamification')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      // +100 (ukończenie) +50 (xpReward osiągnięcia First Case Closed) = 150
      expect(summary.body.xp).toBe(150);
      expect(summary.body.level).toBe(2); // floor(sqrt(150/100))+1 = 2
      expect(summary.body.badges).toContainEqual(
        expect.objectContaining({ code: 'first-case-closed' }),
      );
    });

    it('GET /gamification/badges: trzy osiągnięcia w kolejności katalogu, bez wycofanych odznak; tajne niezdobyte bez nazwy', async () => {
      const response = await request(app.getHttpServer())
        .get('/gamification/badges')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      expect(response.body.map((b: { code: string }) => b.code)).toEqual(['first-case-closed', 'flawless-case', 'secret-3']);
      expect(response.body[0]).toMatchObject({ title: 'First Case Closed', rank: 'MILESTONE', isUnlocked: true, conditionText: 'Ukończ dowolne szkolenie.' });
      expect(response.body[1]).toMatchObject({ title: 'Flawless Case', rank: 'LEGENDARY', isUnlocked: false, unlockedAt: null });
      expect(response.body[2]).toMatchObject({
        title: null,
        description: null,
        conditionText: null,
        rank: 'SECRET',
        hidden: true,
        icon: 'osiagniecie-tajne-zablokowane',
        lockedIcon: 'osiagniecie-tajne-zablokowane',
        xpReward: 0,
        isUnlocked: false,
      });
      // Nic w odpowiedzi nie zdradza tajnego osiągnięcia - także nazwa pliku grafiki (neutralna).
      expect(JSON.stringify(response.body[2])).not.toMatch(/curious|ciekawsk|detekty|gr[ęa]/i);
    });

    it('ukończenie drugiego kursu ze 100% wyniku dolicza bonus 100%, bez nowego osiągnięcia (to nie moduł 1)', async () => {
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

      // 150 (z poprzedniego testu) + 100 (ukończenie) + 50 (bonus 100%) = 300; First Case Closed już zdobyte (bez drugiego XP).
      expect(response.body.gamification.unlockedBadges).toEqual([]);
      expect(summary.body.xp).toBe(300);
      expect(summary.body.badges.map((b: { code: string }) => b.code)).toEqual(['first-case-closed']);
    });

    it('UserBadge zapisuje prawidłowe organizationId (nie null, zgodne z organizacją usera)', async () => {
      const badges = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.userBadge.findMany({ where: { userId: orgAUser1Id } }),
      );
      expect(badges).toHaveLength(1);
      for (const badge of badges) {
        expect(badge.organizationId).toBe(orgAId);
      }
    });
  });

  describe('Osiągnięcia: przyznanie wsteczne, idempotencja, izolacja A/B (D-111)', () => {
    let orgBId: string;
    let orgBUserId: string;
    const completedAt = new Date('2026-09-01T10:00:00.000Z');
    const easterEggAt = '2026-09-01T09:50:00.000Z';

    beforeAll(async () => {
      // Moduł 1 rozpoznajemy po slugu (D-062). W bazie deweloperskiej może już być zaimportowany - wtedy dokładamy tylko
      // własną wersję testową (sprzątana na końcu), inaczej tworzymy kurs.
      const existing = await prisma.course.findUnique({ where: { slug: 'wyludzone-haslo' } });
      if (existing) {
        module1CourseId = existing.id;
      } else {
        module1CourseId = (
          await prisma.course.create({
            data: { title: 'Wyłudzone hasło', slug: 'wyludzone-haslo', category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 12, contentBlocks: [] },
          })
        ).id;
        module1CreatedHere = true;
      }
      const lastVersion = await prisma.courseVersion.findFirst({ where: { courseId: module1CourseId }, orderBy: { version: 'desc' } });
      const blocks = [
        {
          id: 'scena',
          type: 'SCENE_HOTSPOTS',
          hotspots: [{ id: 'dowod', evidence: true, note: { text: 'Ślad' } }],
        },
      ];
      module1VersionId = (
        await prisma.courseVersion.create({
          data: {
            courseId: module1CourseId,
            version: (lastVersion?.version ?? 0) + 1,
            schemaVersion: 5,
            contentHash: `gami-e2e-${uniqueSuffix}`,
            contentBlocks: blocks,
            blockCount: blocks.length,
          },
        })
      ).id;

      const orgBUser = await tenantPrisma.runAuthLookup({ email: orgBUserEmail });
      orgBId = orgBUser!.organizationId;
      orgBUserId = orgBUser!.id;
      // Stan sprzed wdrożenia osiągnięć: sprawa zamknięta na 100%, komplet dowodów, easter egg znaleziony (wyróżnienie z Q).
      await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.courseAssignment.create({
          data: {
            organizationId: orgBId,
            userId: orgBUserId,
            courseId: module1CourseId,
            courseVersionId: module1VersionId,
            status: 'COMPLETED',
            score: 100,
            currentBlockIndex: 1,
            completedAt,
            progress: {
              v: 2,
              blocks: { scena: { type: 'SCENE_HOTSPOTS', done: true, answeredAt: easterEggAt, weight: 0, easterEggs: ['ciekawski-detektyw'] } },
              notes: ['scena.dowod'],
            },
          },
        }),
      );
    });

    // Sprzątanie wersji i kursu: w afterAll całego pliku, PO organizacjach (przypisania znikają z nimi kaskadowo, a wersja
    // z przypisaniem jest chroniona - RESTRICT).
    it('przyznanie wsteczne: kto spełnił warunki wcześniej, dostaje wszystkie trzy, z datą spełnienia warunku i bez XP', async () => {
      const xpBefore = (await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.user.findUniqueOrThrow({ where: { id: orgBUserId } }))).xp;
      const response = await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${orgBToken}`).expect(200);

      expect(response.body).toEqual([
        expect.objectContaining({ code: 'first-case-closed', isUnlocked: true, unlockedAt: completedAt.toISOString() }),
        expect.objectContaining({ code: 'flawless-case', isUnlocked: true, unlockedAt: completedAt.toISOString() }),
        expect.objectContaining({
          code: 'curious-detective',
          title: 'Curious Detective',
          description: 'Otworzyłeś podejrzaną grę na pulpicie Anny. Na szczęście tylko w ćwiczeniu.',
          icon: 'osiagniecie-ciekawski-detektyw',
          isUnlocked: true,
          unlockedAt: easterEggAt,
        }),
      ]);
      const xpAfter = (await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.user.findUniqueOrThrow({ where: { id: orgBUserId } }))).xp;
      expect(xpAfter).toBe(xpBefore);
    });

    it('idempotentne: kolejne (także równoległe) wejścia nie dublują osiągnięć', async () => {
      const results = await Promise.allSettled(
        [1, 2, 3].map(() => request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${orgBToken}`)),
      );
      for (const result of results) expect(result.status === 'fulfilled' && result.value.status).toBe(200);
      const rows = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.userBadge.findMany({ where: { userId: orgBUserId } }));
      expect(rows).toHaveLength(3);
    });

    it('izolacja A/B: osiągnięcia użytkownika B są wyłącznie w organizacji B; A ich nie dostaje i nie widzi', async () => {
      const inOrgA = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.userBadge.findMany({ where: { userId: orgBUserId } }));
      expect(inOrgA).toEqual([]);
      const orgBRows = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.userBadge.findMany({ where: { userId: orgBUserId } }));
      expect(orgBRows.every((row) => row.organizationId === orgBId)).toBe(true);

      const orgA = await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${orgAUser1Token}`).expect(200);
      expect(orgA.body.filter((b: { isUnlocked: boolean }) => b.isUnlocked).map((b: { code: string }) => b.code)).toEqual(['first-case-closed']);
      expect(orgA.body[2].code).toBe('secret-3');
    });

    // X, część 3 (D-112): przypinanie - użytkownik B ma już trzy osiągnięcia (przyznanie wsteczne wyżej). Testy poniżej zależą od
    // stanu z poprzednich `it` (kolejność w pliku, --runInBand): osiągnięcia B i przypięcia są budowane krok po kroku.
    const pin = (token: string, codes: string[]) =>
      request(app.getHttpServer()).put('/gamification/pinned').set('Authorization', `Bearer ${token}`).send({ codes });
    const board = (token: string) => request(app.getHttpServer()).get('/gamification/leaderboard').set('Authorization', `Bearer ${token}`);

    it('przypięcie dwóch zdobytych -> widać je przy nazwisku w rankingu (w kolejności przypięcia) i na profilu', async () => {
      await pin(orgBToken, ['flawless-case', 'first-case-closed']).expect(200, { pinned: ['flawless-case', 'first-case-closed'] });

      const ranking = await board(orgBToken).expect(200);
      expect(ranking.body.enabled).toBe(true);
      const mine = ranking.body.top.find((entry: { userId: string }) => entry.userId === orgBUserId);
      expect(mine.pinned).toEqual([
        { code: 'flawless-case', title: 'Flawless Case', icon: 'osiagniecie-perfekcyjne-sledztwo', rank: 'LEGENDARY' },
        { code: 'first-case-closed', title: 'First Case Closed', icon: 'osiagniecie-pierwsza-sprawa', rank: 'MILESTONE' },
      ]);
      expect(ranking.body.me).toMatchObject({ userId: orgBUserId, rank: mine.rank });

      const profile = await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(profile.body.map((b: { code: string; pinned: number | null }) => [b.code, b.pinned])).toEqual([
        ['first-case-closed', 2],
        ['flawless-case', 1],
        ['curious-detective', null],
      ]);
    });

    it('czwarta odznaka odrzucona („Możesz przypiąć maksymalnie 3 odznaki.”); lista bez zmian', async () => {
      const response = await pin(orgBToken, ['flawless-case', 'first-case-closed', 'curious-detective', 'inny']).expect(400);
      expect(JSON.stringify(response.body)).toContain('Możesz przypiąć maksymalnie 3 odznaki.');
      const ranking = await board(orgBToken).expect(200);
      expect(ranking.body.me.pinned.map((p: { code: string }) => p.code)).toEqual(['flawless-case', 'first-case-closed']);
    });

    it('niezdobyte (także tajne) i duplikaty odrzucone; zmiana kolejności i odpięcie to ten sam zapis', async () => {
      // Użytkownik A ma tylko First Case Closed.
      await pin(orgAUser1Token, ['flawless-case']).expect(400);
      await pin(orgAUser1Token, ['curious-detective']).expect(400);
      await pin(orgAUser1Token, ['first-case-closed', 'first-case-closed']).expect(400);
      await pin(orgAUser1Token, ['first-case-closed']).expect(200);

      await pin(orgBToken, ['first-case-closed', 'curious-detective', 'flawless-case']).expect(200);
      expect((await board(orgBToken)).body.me.pinned.map((p: { code: string }) => p.code)).toEqual(['first-case-closed', 'curious-detective', 'flawless-case']);
      await pin(orgBToken, []).expect(200, { pinned: [] });
      expect((await board(orgBToken)).body.me.pinned).toEqual([]);
      await pin(orgBToken, ['flawless-case', 'first-case-closed']).expect(200);
    });

    it('izolacja A/B: ranking organizacji A nie pokazuje użytkownika B ani jego przypięć; B nie widzi A', async () => {
      const orgA = await board(orgAUser1Token).expect(200);
      const orgB = await board(orgBToken).expect(200);
      expect(JSON.stringify(orgA.body)).not.toContain(orgBUserId);
      expect(JSON.stringify(orgA.body)).not.toContain('flawless-case');
      expect(JSON.stringify(orgB.body)).not.toContain(orgAUser1Id);
      // Wpis A ma swoje przypięcie (First Case Closed) - tylko w rankingu A.
      expect(orgA.body.me).toMatchObject({ userId: orgAUser1Id, pinned: [expect.objectContaining({ code: 'first-case-closed' })] });
    });

    it('admin organizacji wyłącza ranking: ranking B bez wpisów, ranking A bez zmian; ponowne włączenie przywraca', async () => {
      await request(app.getHttpServer()).patch('/organization/settings').set('Authorization', `Bearer ${orgBToken}`).send({ leaderboardEnabled: false }).expect(200);
      expect((await board(orgBToken).expect(200)).body).toEqual({ enabled: false, top: [], me: null });
      expect((await board(orgAUser1Token).expect(200)).body.enabled).toBe(true);
      const settings = await request(app.getHttpServer()).get('/organization/me').set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(settings.body.leaderboardEnabled).toBe(false);
      await request(app.getHttpServer()).patch('/organization/settings').set('Authorization', `Bearer ${orgBToken}`).send({ leaderboardEnabled: true }).expect(200);
      expect((await board(orgBToken).expect(200)).body.enabled).toBe(true);
    });

    describe('rola EMPLOYEE i tajne osiągnięcie w rankingu', () => {
      let employeeToken: string;
      let employeeId: string;

      beforeAll(async () => {
        // orgAUser2 (EMPLOYEE, ACTIVE; fixture z beforeAll pliku) - token podpisany jak w course-catalog.e2e-spec.ts, bo konto
        // nie ma hasła. Dostaje tajne osiągnięcie (jakby znalazł easter egga) w kontekście SWOJEJ organizacji.
        const employee = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.user.findFirstOrThrow({ where: { email: orgAUser2Email } }));
        employeeId = employee.id;
        employeeToken = await app.get(JwtService).signAsync(
          { sub: employee.id, organizationId: orgAId, role: employee.role, email: employee.email },
          { secret: app.get(ConfigService).get<string>('JWT_SECRET'), expiresIn: '15m' },
        );
        const secret = await prisma.badge.findUniqueOrThrow({ where: { code: 'curious-detective' } });
        await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.userBadge.create({ data: { userId: employee.id, badgeId: secret.id, organizationId: orgAId } }));
      });

      it('EMPLOYEE przypina swoje zdobyte (happy path głównej grupy użytkowników)', async () => {
        await pin(employeeToken, ['curious-detective']).expect(200, { pinned: ['curious-detective'] });
      });

      it('przypięte tajne: współpracownik, który go nie zdobył, widzi „Tajne osiągnięcie” bez kodu i grafiki; właściciel - pełne', async () => {
        const forColleague = await board(orgAUser1Token).expect(200);
        const employeeRow = forColleague.body.top.find((entry: { userId: string }) => entry.userId === employeeId);
        expect(employeeRow.pinned).toEqual([{ code: 'secret-1', title: 'Tajne osiągnięcie', icon: 'osiagniecie-tajne-zablokowane', rank: 'SECRET' }]);
        expect(JSON.stringify(forColleague.body)).not.toMatch(/curious|ciekawsk/i);

        const forOwner = await board(employeeToken).expect(200);
        expect(forOwner.body.me.pinned).toEqual([
          { code: 'curious-detective', title: 'Curious Detective', icon: 'osiagniecie-ciekawski-detektyw', rank: 'SECRET' },
        ]);
      });

      it('EMPLOYEE nie wyłączy rankingu (403), stan bez zmian', async () => {
        await request(app.getHttpServer()).patch('/organization/settings').set('Authorization', `Bearer ${employeeToken}`).send({ leaderboardEnabled: false }).expect(403);
        expect((await board(orgAUser1Token).expect(200)).body.enabled).toBe(true);
      });
    });

    it('bez tokena - 401; pola spoza DTO odrzucone (userId nie da się podrzucić)', async () => {
      await request(app.getHttpServer()).put('/gamification/pinned').send({ codes: [] }).expect(401);
      await request(app.getHttpServer()).put('/gamification/pinned').set('Authorization', `Bearer ${orgBToken}`).send({ codes: [], userId: orgAUser1Id }).expect(400);
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

    // D-067 (B-075): zewnętrzne adresy nie są już przyjmowane - CSP i tak nie pozwalała ich
    // wyświetlić, a obcy serwer widział adresy IP oglądających. Własne zdjęcie idzie uploadem.
    it('odrzuca zewnętrzny adres https (tylko presety albo wgrany plik)', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'https://example.test/custom-avatar.png' })
        .expect(400);
    });

    it('odrzuca podszycie się pod znacznik wgranego obrazka (upload: ustawia wyłącznie serwer)', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'upload:deadbeefdeadbeef' })
        .expect(400);
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

  // Własne zdjęcie (D-067): obraz jest kodowany od nowa po stronie API i trzymany w bazie
  // (tabela z organizationId i RLS), a nie w zewnętrznym magazynie.
  describe('Własny avatar z pliku', () => {
    // Najmniejszy poprawny PNG (1x1) - wystarcza, żeby sharp miał co zdekodować.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('wgrywa plik, ustawia znacznik upload:<hash> i serwuje obrazek jako webp', async () => {
      const upload = await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);
      expect(upload.body.avatarUrl).toMatch(/^upload:[0-9a-f]{16}$/);

      const image = await request(app.getHttpServer())
        .get(`/users/${orgAUser1Id}/avatar/image`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);
      expect(image.headers['content-type']).toBe('image/webp');
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      expect(image.body.length).toBeGreaterThan(0);

      // Avatar pojawia się też w zwykłym GET /users/me/avatar (Topbar).
      const own = await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);
      expect(own.body.avatarUrl).toBe(upload.body.avatarUrl);
    });

    it('izolacja tenantów: użytkownik organizacji B nie pobierze avatara użytkownika organizacji A', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/users/${orgAUser1Id}/avatar/image`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(404);
    });

    it('odrzuca plik, który nie jest obrazem (np. SVG ze skryptem)', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', svg, { filename: 'avatar.svg', contentType: 'image/svg+xml' })
        .expect(400);
    });

    it('odrzuca plik podszywający się pod obraz nagłówkiem Content-Type', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', Buffer.from('to nie jest obraz', 'utf8'), { filename: 'avatar.png', contentType: 'image/png' })
        .expect(400);
    });

    it('usunięcie zdjęcia czyści avatar i obrazek przestaje być dostępny', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);

      await request(app.getHttpServer())
        .delete('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      const own = await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);
      expect(own.body.avatarUrl).toBeNull();

      await request(app.getHttpServer())
        .get(`/users/${orgAUser1Id}/avatar/image`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(404);
    });

    it('wybór presetu kasuje wcześniej wgrany obrazek (bez osieroconych danych osobowych)', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .attach('file', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .send({ avatarUrl: 'owl' })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/users/${orgAUser1Id}/avatar/image`)
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(404);

      const stored = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.userAvatarImage.findMany({ where: { userId: orgAUser1Id } }),
      );
      expect(stored).toHaveLength(0);
    });

    it('bez tokena nie da się ani wgrać, ani pobrać obrazka', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar/image')
        .attach('file', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(401);
      await request(app.getHttpServer()).get(`/users/${orgAUser1Id}/avatar/image`).expect(401);
    });
  });

  describe('Leaderboard', () => {
    it('scope=organization zwraca ranking posortowany malejąco po XP, wyłącznie z własnej organizacji', async () => {
      const response = await request(app.getHttpServer())
        .get('/gamification/leaderboard')
        .set('Authorization', `Bearer ${orgAUser1Token}`)
        .expect(200);

      const userIds = response.body.top.map((entry: { userId: string }) => entry.userId);
      expect(userIds).toContain(orgAUser1Id);

      // orgAUser2 ma xp=500 (ustawione w fixture), więc powinien być przed
      // orgAUser1 (300 XP w tym momencie) w rankingu malejącym po XP.
      const ranks = new Map(response.body.top.map((e: { userId: string; rank: number }) => [e.userId, e.rank]));
      const user2Entry = response.body.top.find((e: { xp: number }) => e.xp === 500);
      expect(user2Entry).toBeDefined();
      expect(ranks.get(user2Entry.userId)).toBeLessThan(ranks.get(orgAUser1Id) as number);
      // D-112: tylko imię i inicjał nazwiska, bez działu i e-maila.
      for (const entry of response.body.top) {
        expect(Object.keys(entry).sort()).toEqual(['avatarUrl', 'firstName', 'lastInitial', 'level', 'pinned', 'rank', 'userId', 'xp']);
      }
      expect(response.body.me).toMatchObject({ userId: orgAUser1Id, rank: ranks.get(orgAUser1Id) });
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

      const orgAUserIds = orgAResponse.body.top.map((e: { userId: string }) => e.userId);
      const orgBUserIds = orgBResponse.body.top.map((e: { userId: string }) => e.userId);

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
      expect(noDeptResponse.body).toEqual({ enabled: true, top: [], me: null });
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
