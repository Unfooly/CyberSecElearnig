import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Osiągnięcie „Trzy sprawy” (D-202) na prawdziwej bazie z RLS: (a) na żywo - trzeci RÓŻNY ukończony kurs daje odznakę z XP w odpowiedzi
// /progress; (b) trzy podejścia do tego samego kursu (restart, D-069) nie dają niczego, a ukończenia innego użytkownika w innej organizacji
// się nie liczą (izolacja A/B); (c) wstecz - użytkownik z wersją przyznania sprzed D-202 i trzema różnymi ukończeniami dostaje odznakę
// przy wejściu na profil, bez XP. „Komplet” zależy od katalogu kursów w bazie - pokrywają go testy jednostkowe (progressFacts).
// Kursy bez `slug` (nie są modułami katalogu). Testy po kolei, korzystają ze stanu poprzednich. Serwer nasłuchujący (listen(0)) -
// CLAUDE.md, reguła 9.
describe('Osiągnięcie „Trzy sprawy” (D-202, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domain = (who: string) => `org-${who}.progress-badges-e2e-test.test`;
  const email = (who: string) => `postep-${who}-${suffix}@${domain(who)}`;
  const users: Record<string, { token: string; id: string; orgId: string }> = {};
  const courseIds: string[] = [];

  const badges = (orgId: string, userId: string) =>
    tenantPrisma.runInOrgContext(orgId, async (tx) =>
      (await tx.userBadge.findMany({ where: { organizationId: orgId, userId }, select: { badge: { select: { code: true } } } })).map((row) => row.badge.code),
    );
  const xpOf = (orgId: string, userId: string) => tenantPrisma.runInOrgContext(orgId, async (tx) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).xp);
  // Ukończone podejście wprost w bazie (historia); `archived` - podejście zarchiwizowane restartem (D-069).
  const completed = (who: string, courseId: string, at: string, archived = false) =>
    tenantPrisma.runInOrgContext(users[who].orgId, (tx) =>
      tx.courseAssignment.create({
        data: {
          organizationId: users[who].orgId,
          userId: users[who].id,
          courseId,
          status: 'COMPLETED',
          currentBlockIndex: 1,
          completedAt: new Date(at),
          ...(archived ? { archivedAt: new Date(at) } : {}),
        },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    for (const who of ['a', 'b', 'c']) {
      const token = (await registerVerified(app, tenantPrisma, { email: email(who), password: 'SuperSecret123!' })).body.accessToken;
      const user = (await tenantPrisma.runAuthLookup({ email: email(who) }))!;
      users[who] = { token, id: user.id, orgId: user.organizationId };
    }
    for (const n of [1, 2, 3]) {
      const course = await prisma.course.create({
        data: { title: `Kurs postępu ${n} ${suffix}`, category: 'GENERAL_AWARENESS', durationMinutes: 2, contentBlocks: [{ type: 'VIDEO', url: `https://example.test/postep-${n}.mp4` }] },
      });
      courseIds.push(course.id);
    }
  });

  afterAll(async () => {
    // Najpierw użytkownicy i organizacje (przypisania i odznaki kaskadowo - FORCE RLS), potem kursy (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'progress-badges-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'progress-badges-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await app.close();
  });

  it('(a) na żywo: trzeci RÓŻNY ukończony kurs daje „Trzy sprawy” w odpowiedzi /progress (z XP)', async () => {
    await completed('a', courseIds[0], '2026-10-01');
    await completed('a', courseIds[1], '2026-10-02');
    await tenantPrisma.runInOrgContext(users.a.orgId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId: users.a.orgId, userId: users.a.id, courseId: courseIds[2] } }),
    );
    await request(app.getHttpServer()).post(`/courses/${courseIds[2]}/start`).set('Authorization', `Bearer ${users.a.token}`).expect(200);
    const response = await request(app.getHttpServer())
      .post(`/courses/${courseIds[2]}/progress`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ blockIndex: 0 })
      .expect(200);
    const unlocked = response.body.gamification.unlockedBadges as { code: string; xpReward: number }[];
    expect(unlocked).toContainEqual(expect.objectContaining({ code: 'three-cases', xpReward: 50 }));
    // XP na żywo: +100 za ukończenie i +50 za Trzy sprawy (kurs bez oceny - bez bonusu za 100%; pierwsza sprawa przyznana wstecz, bez XP).
    expect(response.body.gamification.xpGained).toBe(150);
    expect(await badges(users.a.orgId, users.a.id)).toEqual(expect.arrayContaining(['three-cases']));
  });

  it('(b) trzy podejścia do TEGO SAMEGO kursu (restart) nie dają „Trzech spraw”; ukończenia A z innej organizacji się nie liczą', async () => {
    await completed('b', courseIds[0], '2026-10-01', true);
    await completed('b', courseIds[0], '2026-10-02', true);
    await completed('b', courseIds[0], '2026-10-03');
    // Wejście na profil uruchamia przyznanie wsteczne (nowe konto - wersja sprzed D-202).
    await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${users.b.token}`).expect(200);
    const codes = await badges(users.b.orgId, users.b.id);
    expect(codes).toContain('first-case-closed');
    expect(codes).not.toContain('three-cases');
    expect(codes).not.toContain('all-cases');
    // RLS: z kontekstu organizacji B nie widać odznak A.
    expect(await tenantPrisma.runInOrgContext(users.b.orgId, (tx) => tx.userBadge.count({ where: { userId: users.a.id } }))).toBe(0);
  });

  it('(c) wstecz: konto z wersją przyznania 3 i trzema różnymi ukończeniami dostaje „Trzy sprawy” przy wejściu na profil, bez XP', async () => {
    for (const [i, id] of courseIds.entries()) await completed('c', id, `2026-10-0${i + 1}`);
    await tenantPrisma.runInOrgContext(users.c.orgId, (tx) => tx.user.update({ where: { id: users.c.id }, data: { achievementsSyncVersion: 3 } }));
    const xpBefore = await xpOf(users.c.orgId, users.c.id);
    const profile = await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${users.c.token}`).expect(200);
    const three = (profile.body as { code: string; isUnlocked: boolean; unlockedAt: string | null }[]).find((b) => b.code === 'three-cases');
    expect(three).toMatchObject({ isUnlocked: true, unlockedAt: new Date('2026-10-03').toISOString() });
    expect(await xpOf(users.c.orgId, users.c.id)).toBe(xpBefore);
    // Ponowne wejście nie dubluje.
    await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${users.c.token}`).expect(200);
    expect((await badges(users.c.orgId, users.c.id)).filter((code) => code === 'three-cases')).toHaveLength(1);
  });
});
