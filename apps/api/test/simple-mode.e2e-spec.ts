import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { SECRET_MARKER, simpleModule } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Tryb prosty i SWIPE_SORT (D-132): ocena każdego kliknięcia (/check) - wybór z próbami do skutku (wynik z pierwszej), karty wiadomości
// po id nieprzejrzystym, klucz (`correct`) nigdy w odpowiedzi, podpowiedź po 2 błędach, kolejność bloków i izolacja tenantów A/B.
// Kurs: simpleModule() (narracja, scena, wybór, SWIPE_SORT, raport). Serwer nasłuchujący (listen(0)) - CLAUDE.md, reguła 9.
describe('Tryb prosty: /check (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.simple-mode-e2e-test.test';
  const domainB = 'org-b.simple-mode-e2e-test.test';
  const emailA = `prosty-a-${suffix}@${domainA}`;
  const emailB = `prosty-b-${suffix}@${domainB}`;

  let orgBId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let courseId: string;

  let ipCounter = 0;
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const call = (path: string, token: string, body?: object) => {
    const req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('CF-Connecting-IP', nextIp());
    return body ? req.send(body) : req;
  };
  const start = (token: string) => call(`/courses/${courseId}/start`, token);
  const submit = (token: string, body: object) => call(`/courses/${courseId}/progress`, token, body);
  const check = (token: string, blockId: string, body: object) => call(`/courses/${courseId}/blocks/${blockId}/check`, token, body);

  type Card = { id: string; from: string };
  const cardsOf = (body: { contentBlocks: { id: string; cards?: Card[] }[] }) => body.contentBlocks.find((block) => block.id === 'wiadomosci')!.cards!;

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
    orgBId = userB.organizationId;
    userBId = userB.id;

    const blocks = parseModule({ ...simpleModule(), slug: `prosty-${suffix}` }).blocks;
    const course = await prisma.course.create({ data: { title: `Prosty ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    courseId = course.id;
    await prisma.courseVersion.create({
      data: { courseId, version: 1, schemaVersion: 6, contentHash: hashContent({ blocks, simpleMode: true }), contentBlocks: blocks as never, blockCount: blocks.length, simpleMode: true },
    });
    await tenantPrisma.runInOrgContext(userA.organizationId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId: userA.organizationId, userId: userA.id, courseId } as never }),
    );
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania kaskadowo - FORCE RLS), potem kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'simple-mode-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'simple-mode-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  it('/start: simpleMode, karty bez klucza (`correct`, zdania, podpowiedź), id kart nieprzejrzyste; /check przed dotarciem - 400', async () => {
    const body = (await start(tokenA).expect(200)).body;
    expect(body.simpleMode).toBe(true);
    const json = JSON.stringify(body);
    expect(json).not.toContain(SECRET_MARKER);
    expect(json).not.toContain('"correct"');
    expect(json).not.toContain('"hint"');
    expect(cardsOf(body).map((card) => card.id)).not.toContain('paczka');
    await check(tokenA, 'wybor', { option: 1 }).expect(400);
    await check(tokenA, 'nie-ma', { option: 1 }).expect(404);
  });

  it('wybór: błędna odpowiedź - „bad” i zdanie, „Dalej” przed trafieniem - 400; trafienie - „good”; wynik z pierwszej próby', async () => {
    await submit(tokenA, { blockIndex: 0 }).expect(200);
    await submit(tokenA, { blockIndex: 1, answer: { visited: ['link', 'tekst', 'logowanie'] } }).expect(200);
    const bad = (await check(tokenA, 'wybor', { option: 0 }).expect(200)).body;
    expect(bad).toEqual({ blockId: 'wybor', result: 'bad', feedback: `${SECRET_MARKER}-prosty-zle`, done: false });
    await submit(tokenA, { blockIndex: 2, answer: 1 }).expect(400);
    // DTO: pole spoza listy i zły typ - 400.
    await check(tokenA, 'wybor', { option: 1, correct: true }).expect(400);
    await check(tokenA, 'wybor', { option: 'x' }).expect(400);
    const good = (await check(tokenA, 'wybor', { option: 1 }).expect(200)).body;
    expect(good).toEqual({ blockId: 'wybor', result: 'good', feedback: `${SECRET_MARKER}-prosty-dobrze`, done: true });
    const saved = (await submit(tokenA, { blockIndex: 2, answer: 1 }).expect(200)).body;
    expect(saved.lastResult).toMatchObject({ type: 'QUIZ', correct: false, points: 0 });
  });

  it('SWIPE_SORT: werdykt każdej karty raz, odpowiedź bez `correct`; odświeżenie strony - próby w postępie; wynik = trafione / karty', async () => {
    const cards = cardsOf((await start(tokenA).expect(200)).body);
    const paczka = cards.find((card) => card.from === 'SzybkaPaczka')!;
    const szef = cards.find((card) => card.from === 'Szef')!;
    // Id z treści (zamiast nieprzejrzystego) i brak werdyktu - 400.
    await check(tokenA, 'wiadomosci', { card: 'paczka', verdict: 'suspicious' }).expect(400);
    await check(tokenA, 'wiadomosci', { card: paczka.id }).expect(400);

    const first = (await check(tokenA, 'wiadomosci', { card: paczka.id, verdict: 'suspicious' }).expect(200)).body;
    expect(first).toEqual({ blockId: 'wiadomosci', result: 'good', feedback: `${SECRET_MARKER}-swipe-paczka`, done: false });
    expect(first).not.toHaveProperty('correct');
    await check(tokenA, 'wiadomosci', { card: paczka.id, verdict: 'ok' }).expect(400);
    await submit(tokenA, { blockIndex: 3 }).expect(400);

    const view = (await start(tokenA).expect(200)).body.progress.blocks.wiadomosci;
    expect(view).toMatchObject({ done: false, checks: [{ item: paczka.id, result: 'good', feedback: `${SECRET_MARKER}-swipe-paczka` }] });
    expect(JSON.stringify(view)).not.toContain('swipe-szef');

    const last = (await check(tokenA, 'wiadomosci', { card: szef.id, verdict: 'suspicious' }).expect(200)).body;
    expect(last).toMatchObject({ result: 'bad', done: true });
    const saved = (await submit(tokenA, { blockIndex: 3 }).expect(200)).body;
    expect(saved.lastResult).toMatchObject({ type: 'SWIPE_SORT', points: 0.5 });
    expect(saved.lastResult).not.toHaveProperty('correct');
  });

  it('izolacja A/B: B nie sprawdza w przypisaniu A; id kart A nie działają w przypisaniu B; próby A nie trafiają do B', async () => {
    await check(tokenB, 'wybor', { option: 1 }).expect(404);
    await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgBId, userId: userBId, courseId } as never }));
    const startB = (await start(tokenB).expect(200)).body;
    expect(startB.progress.blocks).toEqual({});
    const cardsA = cardsOf((await start(tokenA).expect(200)).body);
    const cardsB = cardsOf(startB);
    expect(cardsB.map((card) => card.id).sort()).not.toEqual(cardsA.map((card) => card.id).sort());

    await submit(tokenB, { blockIndex: 0 }).expect(200);
    await submit(tokenB, { blockIndex: 1, answer: { visited: ['link', 'tekst', 'logowanie'] } }).expect(200);
    expect((await check(tokenB, 'wybor', { option: 1 }).expect(200)).body.result).toBe('good');
    await submit(tokenB, { blockIndex: 2, answer: 1 }).expect(200);
    await check(tokenB, 'wiadomosci', { card: cardsA[0].id, verdict: 'ok' }).expect(400);
  });

  it('każda karta raz także przy równoległych żądaniach (FOR UPDATE): dokładnie jedno 200', async () => {
    const card = cardsOf((await start(tokenB).expect(200)).body)[0];
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => check(tokenB, 'wiadomosci', { card: card.id, verdict: 'ok' })));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 400, 400, 400, 400]);
  });
});
