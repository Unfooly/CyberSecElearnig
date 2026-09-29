import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { MODULE_2_SLUG } from '../src/gamification/gamification.constants';
import { registerVerified } from './helpers/auth';

// Osiągnięcia modułu 2 i „Bez limitów czasu” (D-124) na prawdziwej bazie: Off the Record przy zapisie bloku OSINT (bez XP), Dead Air i
// Perfect Pitch przy ukończeniu (z XP), wiersze `user_badges` wyłącznie w organizacji gracza (izolacja A/B), ocena rozmowy na żywo bierze
// ustawienie z konta (cisza odrzucona mimo `timed: true` od klienta). Kurs v6 ze slugiem modułu 2: OSINT, odsłuch nagrania, rozmowa na
// żywo. Serwer nasłuchujący (listen(0)) - CLAUDE.md, reguła 9.
describe('Osiągnięcia modułu 2 i „Bez limitów czasu” (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.achievements2-e2e-test.test';
  const domainB = 'org-b.achievements2-e2e-test.test';
  const emailA = `m2-a-${suffix}@${domainA}`;
  const emailB = `m2-b-${suffix}@${domainB}`;

  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let courseId: string;

  let ipCounter = 0;
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const post = (path: string, token: string, body?: object) => {
    const req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('CF-Connecting-IP', nextIp());
    return body ? req.send(body) : req;
  };
  const start = (token: string) => post(`/courses/${courseId}/start`, token);
  const submit = (token: string, body: object) => post(`/courses/${courseId}/progress`, token, body);
  const badgesOf = (orgId: string, userId: string) =>
    tenantPrisma.runInOrgContext(orgId, (tx) => tx.userBadge.findMany({ where: { userId }, include: { badge: { select: { code: true } } } }));
  const xpOf = async (orgId: string, userId: string) =>
    (await tenantPrisma.runInOrgContext(orgId, (tx) => tx.user.findFirstOrThrow({ where: { id: userId, organizationId: orgId }, select: { xp: true } }))).xp;

  function courseBlocks() {
    const blocks = fullBlocks();
    const module = {
      schemaVersion: 6,
      slug: MODULE_2_SLUG,
      title: 'Głos z helpdesku',
      category: 'PHISHING_SOCIAL_ENGINEERING',
      durationMinutes: 5,
      mandatory: false,
      blocks: [blocks.OSINT_SPOT, blocks.CALL_RECORDING, blocks.LIVE_CALL],
    };
    return parseModule(module).blocks;
  }

  beforeAll(async () => {
    process.env.TRUST_PROXY = 'true';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    tokenA = (await registerVerified(app, tenantPrisma, { email: emailA, password: 'SuperSecret123!' })).body.accessToken;
    tokenB = (await registerVerified(app, tenantPrisma, { email: emailB, password: 'SuperSecret123!' })).body.accessToken;
    const userA = (await tenantPrisma.runAuthLookup({ email: emailA }))!;
    const userB = (await tenantPrisma.runAuthLookup({ email: emailB }))!;
    orgAId = userA.organizationId;
    orgBId = userB.organizationId;
    userAId = userA.id;
    userBId = userB.id;

    const blocks = courseBlocks();
    // Slug modułu 2 - osiągnięcia rozpoznają moduł po `Course.slug` (jak moduł 1, D-111).
    const course = await prisma.course.create({
      data: { title: `Głos z helpdesku ${suffix}`, slug: MODULE_2_SLUG, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never },
    });
    courseId = course.id;
    await prisma.courseVersion.create({
      data: { courseId, version: 1, schemaVersion: 6, contentHash: hashContent(blocks), contentBlocks: blocks as never, blockCount: blocks.length },
    });
    for (const [orgId, userId] of [
      [orgAId, userAId],
      [orgBId, userBId],
    ]) {
      await tenantPrisma.runInOrgContext(orgId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgId, userId, courseId } as never }));
    }
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania i osiągnięcia kaskadowo - FORCE RLS), potem kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'achievements2-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'achievements2-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  it('Off the Record: przy zapisie bloku OSINT z wysłuchanym zakończeniem - wiersz w organizacji gracza, bez XP', async () => {
    await start(tokenA).expect(200);
    const xpBefore = await xpOf(orgAId, userAId);
    await submit(tokenA, { blockIndex: 0, answer: { marked: ['zespol', 'kierownik', 'webinar'], heard: ['off-the-record'] } }).expect(200);

    const rows = await badgesOf(orgAId, userAId);
    expect(rows.map((row) => row.badge.code)).toEqual(['off-the-record']);
    expect(rows.every((row) => row.organizationId === orgAId)).toBe(true);
    expect(await xpOf(orgAId, userAId)).toBe(xpBefore);
  });

  it('ukończenie: Dead Air (rozłączenie od razu) i Perfect Pitch (wszystkie flagi, zero fałszywych) z XP', async () => {
    await submit(tokenA, { blockIndex: 1, answer: { taps: [{ segmentId: 's1' }, { segmentId: 's3' }] } }).expect(200);
    const response = await submit(tokenA, { blockIndex: 2, answer: { path: ['oddzwonie'], timed: true } }).expect(200);

    const unlocked = (response.body.gamification.unlockedBadges as { code: string }[]).map((badge) => badge.code);
    expect(unlocked).toEqual(expect.arrayContaining(['first-case-closed', 'dead-air', 'perfect-pitch']));
    expect(unlocked).not.toContain('off-the-record');
    const rows = await badgesOf(orgAId, userAId);
    expect(rows.map((row) => row.badge.code)).toEqual(expect.arrayContaining(['off-the-record', 'dead-air', 'perfect-pitch']));
    expect(rows.every((row) => row.organizationId === orgAId)).toBe(true);
  });

  it('izolacja A/B: osiągnięcia A nie istnieją w organizacji B, a B ich nie widzi jako zdobytych', async () => {
    expect(await badgesOf(orgBId, userAId)).toEqual([]);
    expect(await badgesOf(orgBId, userBId)).toEqual([]);
    const profileB = await request(app.getHttpServer()).get('/gamification/badges').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(profileB.body.filter((badge: { isUnlocked: boolean }) => badge.isUnlocked)).toEqual([]);
  });

  it('„Bez limitów czasu” z konta: cisza odrzucona mimo timed: true, zapisany tryb bez limitu; bez wpływu na organizację A', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ noTimeLimits: true })
      .expect(200);
    await start(tokenB).expect(200);
    await submit(tokenB, { blockIndex: 0, answer: { marked: ['zespol'] } }).expect(200);
    await submit(tokenB, { blockIndex: 1, answer: { taps: [{ segmentId: 's1' }] } }).expect(200);

    await submit(tokenB, { blockIndex: 2, answer: { path: ['silence', 'rozlaczam'], timed: true } }).expect(400);
    await submit(tokenB, { blockIndex: 2, answer: { path: ['oddzwonie'], timed: true } }).expect(200);

    const assignment = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.courseAssignment.findFirstOrThrow({ where: { organizationId: orgBId, userId: userBId, courseId } }),
    );
    const entry = (assignment.progress as { blocks: Record<string, { timed?: boolean; path?: string[] }> }).blocks['na-zywo'];
    expect(entry).toMatchObject({ path: ['oddzwonie'], timed: false });

    // Ustawienie B nie zmieniło niczego u A.
    const prefsA = await request(app.getHttpServer()).get('/users/me/preferences').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(prefsA.body.noTimeLimits).toBe(false);
  });
});
