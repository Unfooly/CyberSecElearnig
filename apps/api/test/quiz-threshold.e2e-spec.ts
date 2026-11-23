import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { simpleModule } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Próg zaliczenia quizu i „Powtórz quiz” (D-207) na prawdziwej bazie z RLS. Kurs: narracja, 2 pytania quizu (q1, q2 - ciąg pytań przed
// raportem), raport. Próg 75% - przy 2 pytaniach trzeba obu dobrze. (a) 1 z 2: wynik w odpowiedzi, pozycja bez zmian, raport i kolejne
// zapisy - 409, /start pokazuje niezaliczony quiz; (b) „Powtórz quiz” czyści odpowiedzi i wraca do q1, drugie wywołanie - 409; (c) 2 z 2 -
// zaliczony, raport kończy kurs (XP/odznaki dopiero teraz), licznik podejść 2; izolacja A/B: B nie powtórzy quizu A. Serwer nasłuchujący
// (listen(0)) - CLAUDE.md, reguła 9.
describe('Quiz: próg zaliczenia i „Powtórz quiz” (D-207, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.quiz-threshold-e2e-test.test';
  const domainB = 'org-b.quiz-threshold-e2e-test.test';
  const emailA = `quiz-a-${suffix}@${domainA}`;
  const emailB = `quiz-b-${suffix}@${domainB}`;
  let tokenA: string;
  let tokenB: string;
  let orgAId: string;
  let userAId: string;
  let courseId: string;

  let ipCounter = 0;
  const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;
  const call = (path: string, token: string, body?: object) => {
    const req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('CF-Connecting-IP', nextIp());
    return body ? req.send(body) : req;
  };
  const start = (token: string) => call(`/courses/${courseId}/start`, token);
  const submit = (token: string, body: object) => call(`/courses/${courseId}/progress`, token, body);
  const check = (token: string, blockId: string, body: object) => call(`/courses/${courseId}/blocks/${blockId}/check`, token, body);
  const retry = (token: string) => call(`/courses/${courseId}/quiz/retry`, token);
  // Odpowiedź na pytanie (wybór z fikstury: 0 - zła, 1 - dobra) i zapis bloku.
  const answer = async (token: string, blockId: string, blockIndex: number, option: number) => {
    await check(token, blockId, { option }).expect(200);
    return submit(token, { blockIndex, blockId });
  };

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
    orgAId = userA.organizationId;
    userAId = userA.id;

    const base = simpleModule();
    const byId = (id: string) => base.blocks.find((block) => block.id === id)!;
    const quiz = byId('wybor');
    const source = { ...base, slug: `quiz-${suffix}`, blocks: [byId('odprawa'), { ...quiz, id: 'q1' }, { ...quiz, id: 'q2' }, byId('raport')] };
    const blocks = parseModule(source).blocks;
    const course = await prisma.course.create({ data: { title: `Quiz ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    courseId = course.id;
    await prisma.courseVersion.create({
      data: { courseId, version: 1, schemaVersion: 6, contentHash: hashContent({ blocks, simpleMode: true }), contentBlocks: blocks as never, blockCount: blocks.length, simpleMode: true },
    });
    await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgAId, userId: userAId, courseId } as never }));
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw użytkownicy i organizacje (przypisania kaskadowo - FORCE RLS), potem kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'quiz-threshold-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'quiz-threshold-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  it('/start: quiz = pytania przed raportem (q1, q2), próg 75%, bez wyniku przed podejściem; powtórka bez niezaliczenia - 409', async () => {
    const body = (await start(tokenA).expect(200)).body;
    expect(body.quiz).toEqual({ blockIds: ['q1', 'q2'], passPercent: 75, result: null });
    await retry(tokenA).expect(409);
  });

  it('(a) 1 z 2 - niezaliczony: wynik w odpowiedzi, pozycja na q2, raport - 409, kurs nieukończony; /start pokazuje wynik', async () => {
    await submit(tokenA, { blockIndex: 0 }).expect(200);
    expect((await answer(tokenA, 'q1', 1, 0)).status).toBe(200);
    const last = (await answer(tokenA, 'q2', 2, 1)).body;
    expect(last.quiz).toEqual({ correct: 1, total: 2, passPercent: 75, passed: false, attempts: 1 });
    expect(last.currentBlockIndex).toBe(2);
    expect(last.status).toBe('IN_PROGRESS');
    expect(last.gamification).toBeNull();
    await submit(tokenA, { blockIndex: 3 }).expect(400);
    await submit(tokenA, { blockIndex: 2, blockId: 'q2' }).expect(409);
    const body = (await start(tokenA).expect(200)).body;
    expect(body.quiz.result).toMatchObject({ correct: 1, total: 2, passed: false, attempts: 1 });
    expect(body.status).toBe('IN_PROGRESS');
  });

  it('izolacja A/B: B bez przypisania - 404; z własnym przypisaniem bez porażki - 409, a niezaliczony quiz A bez zmian (RLS)', async () => {
    await retry(tokenB).expect(404);
    const userB = (await tenantPrisma.runAuthLookup({ email: emailB }))!;
    await tenantPrisma.runInOrgContext(userB.organizationId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId: userB.organizationId, userId: userB.id, courseId } as never }),
    );
    await retry(tokenB).expect(409);
    const stateA = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgAId, userId: userAId, courseId, archivedAt: null }, select: { progress: true, currentBlockIndex: true } }),
    );
    expect(stateA!.currentBlockIndex).toBe(2);
    expect((stateA!.progress as { quiz: { failed: boolean } }).quiz.failed).toBe(true);
    // Z kontekstu organizacji B przypisania A nie widać.
    expect(await tenantPrisma.runInOrgContext(userB.organizationId, (tx) => tx.courseAssignment.count({ where: { userId: userAId } }))).toBe(0);
  });

  it('(b) „Powtórz quiz”: odpowiedzi quizu wyczyszczone, pozycja na q1, historia przed quizem zostaje; drugie wywołanie - 409', async () => {
    const body = (await retry(tokenA).expect(200)).body;
    expect(body.currentBlockIndex).toBe(1);
    await retry(tokenA).expect(409);
    const started = (await start(tokenA).expect(200)).body;
    expect(started.currentBlockIndex).toBe(1);
    expect(Object.keys(started.progress.blocks).sort()).toEqual(['odprawa']);
    // Nowe podejście w toku - bez wyniku poprzedniego.
    expect(started.quiz.result).toBeNull();
  });

  it('(c) 2 z 2 - zaliczony: raport kończy kurs (z XP), podejście nr 2', async () => {
    expect((await answer(tokenA, 'q1', 1, 1)).status).toBe(200);
    const last = (await answer(tokenA, 'q2', 2, 1)).body;
    expect(last.quiz).toEqual({ correct: 2, total: 2, passPercent: 75, passed: true, attempts: 2 });
    expect(last.currentBlockIndex).toBe(3);
    const done = (await submit(tokenA, { blockIndex: 3 }).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.score).toBe(100);
    expect(done.gamification.xpGained).toBeGreaterThan(0);
    const stored = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgAId, userId: userAId, courseId, archivedAt: null }, select: { progress: true } }),
    );
    expect((stored!.progress as { quiz: unknown }).quiz).toEqual({ attempts: 2, failed: false, correct: 2, total: 2 });
    // Po ukończeniu powtórka quizu - 409.
    await retry(tokenA).expect(409);
  });

  it('quiz na samym końcu (bez raportu): niezaliczony nie kończy kursu, po powtórce zaliczony kończy kurs z XP', async () => {
    const base = simpleModule();
    const byId = (id: string) => base.blocks.find((block) => block.id === id)!;
    const quiz = byId('wybor');
    const blocks = parseModule({ ...base, slug: `quiz-koniec-${suffix}`, blocks: [byId('odprawa'), { ...quiz, id: 'k1' }, { ...quiz, id: 'k2' }] }).blocks;
    const course = await prisma.course.create({ data: { title: `Quiz koniec ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    const endCourse = course.id;
    try {
      await prisma.courseVersion.create({
        data: { courseId: endCourse, version: 1, schemaVersion: 6, contentHash: hashContent({ blocks, simpleMode: true }), contentBlocks: blocks as never, blockCount: blocks.length, simpleMode: true },
      });
      await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgAId, userId: userAId, courseId: endCourse } as never }));
      const path = (suffixPath: string) => `/courses/${endCourse}${suffixPath}`;
      await call(path('/start'), tokenA).expect(200);
      await call(path('/progress'), tokenA, { blockIndex: 0 }).expect(200);
      await call(path('/blocks/k1/check'), tokenA, { option: 0 }).expect(200);
      expect((await call(path('/progress'), tokenA, { blockIndex: 1, blockId: 'k1' }).expect(200)).body.quiz).toBeUndefined();
      await call(path('/blocks/k2/check'), tokenA, { option: 1 }).expect(200);
      const failed = (await call(path('/progress'), tokenA, { blockIndex: 2, blockId: 'k2' }).expect(200)).body;
      expect(failed).toMatchObject({ status: 'IN_PROGRESS', currentBlockIndex: 2, gamification: null, quiz: { passed: false, correct: 1, total: 2 } });
      await call(path('/quiz/retry'), tokenA).expect(200);
      await call(path('/blocks/k1/check'), tokenA, { option: 1 }).expect(200);
      await call(path('/progress'), tokenA, { blockIndex: 1, blockId: 'k1' }).expect(200);
      await call(path('/blocks/k2/check'), tokenA, { option: 1 }).expect(200);
      const passed = (await call(path('/progress'), tokenA, { blockIndex: 2, blockId: 'k2' }).expect(200)).body;
      expect(passed).toMatchObject({ status: 'COMPLETED', quiz: { passed: true, attempts: 2 } });
      expect(passed.gamification.xpGained).toBeGreaterThan(0);
    } finally {
      await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.deleteMany({ where: { organizationId: orgAId, courseId: endCourse } }));
      await prisma.course.deleteMany({ where: { id: endCourse } });
    }
  });
});
