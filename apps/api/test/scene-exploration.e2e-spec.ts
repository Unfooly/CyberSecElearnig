import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { SECRET_MARKER, fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Stan częściowy sceny (SCENE_HOTSPOTS, D-128): POST /courses/:id/blocks/:blockId/explore zapisuje obejrzane przedmioty i zabrane
// dowody przed ukończeniem bloku; /start je oddaje (wyjście z kursu w połowie sceny niczego nie gubi); zapis bloku kończy scenę.
// Walidacja, kolejność bloków, równoległe zapisy i izolacja tenantów A/B. Kurs: scena, potem dialog. Serwer nasłuchujący (listen(0)) -
// CLAUDE.md, reguła 9.
describe('Scena: stan częściowy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.scene-explore-e2e-test.test';
  const domainB = 'org-b.scene-explore-e2e-test.test';
  const emailA = `scena-a-${suffix}@${domainA}`;
  const emailB = `scena-b-${suffix}@${domainB}`;

  let orgAId: string;
  let userAId: string;
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
  const explore = (token: string, visited: string[], noted: string[], blockId = 'scena') =>
    call(`/courses/${courseId}/blocks/${blockId}/explore`, token, { visited, noted });
  const storedProgress = (organizationId: string, userId: string) =>
    tenantPrisma.runInOrgContext(organizationId, async (tx) => (await tx.courseAssignment.findFirst({ where: { organizationId, userId, courseId } }))!.progress as {
      blocks: Record<string, { done: boolean; visited?: string[]; noted?: string[] }>;
      notes: string[];
    });

  function courseBlocks() {
    const blocks = fullBlocks();
    const module = { schemaVersion: 6, slug: `scena-${suffix}`, title: 'Scena', category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 5, mandatory: false, blocks: [blocks.SCENE_HOTSPOTS, blocks.DIALOGUE] };
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
    userAId = userA.id;
    orgBId = userB.organizationId;
    userBId = userB.id;

    const blocks = courseBlocks();
    const course = await prisma.course.create({ data: { title: `Scena ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    courseId = course.id;
    await prisma.courseVersion.create({
      data: { courseId, version: 1, schemaVersion: 6, contentHash: hashContent(blocks), contentBlocks: blocks as never, blockCount: blocks.length },
    });
    await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgAId, userId: userAId, courseId } as never }));
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania kaskadowo - FORCE RLS), potem kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'scene-explore-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'scene-explore-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  it('bez logowania - 401; świeże przypisanie nie ma stanu częściowego', async () => {
    await request(app.getHttpServer()).post(`/courses/${courseId}/blocks/scena/explore`).send({ visited: ['h1'], noted: [] }).expect(401);
    const body = (await start(tokenA).expect(200)).body;
    expect(body.progress.blocks.scena).toBeUndefined();
    expect(body.progress.evidence.perBlock.find((b: { blockId: string }) => b.blockId === 'scena')).toMatchObject({ collected: 0, total: 2 });
  });

  it('zapis stanu: obejrzane i zabrany dowód; kurs się nie przesuwa, /start oddaje stan, notatkę i licznik', async () => {
    const saved = (await explore(tokenA, ['h1', 'h2'], ['h1']).expect(200)).body;
    expect(saved).toMatchObject({ blockId: 'scena', visited: ['h1', 'h2'], noted: ['h1'] });
    expect(saved.evidence.perBlock.find((b: { blockId: string }) => b.blockId === 'scena')).toMatchObject({ collected: 1, total: 2 });
    // Odpowiedź nie zawiera treści bloku ani sekretów.
    expect(JSON.stringify(saved)).not.toContain(SECRET_MARKER);

    // „Wyjście i powrót”: nowe /start - blok bieżący bez zmian, stan sceny i notatka są w postępie.
    const body = (await start(tokenA).expect(200)).body;
    expect(body.currentBlockIndex).toBe(0);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.progress.blocks.scena).toEqual({ type: 'SCENE_HOTSPOTS', done: false, exploration: { visited: ['h1', 'h2'], noted: ['h1'] } });
    expect(body.progress.notes).toEqual([expect.objectContaining({ blockId: 'scena', text: 'Hasło na kartce przy monitorze.' })]);
    expect(body.progress.evidence).toMatchObject({ collected: 1 });
  });

  it('stan tylko rośnie: kolejne zapisy się sumują (także przedmioty sceny zagnieżdżonej), powtórzony zapis niczego nie dubluje', async () => {
    expect((await explore(tokenA, ['h4', 'h4-outlook'], ['h4-outlook']).expect(200)).body).toMatchObject({ visited: ['h1', 'h2', 'h4', 'h4-outlook'], noted: ['h1', 'h4-outlook'] });
    expect((await explore(tokenA, ['h1'], []).expect(200)).body).toMatchObject({ visited: ['h1', 'h2', 'h4', 'h4-outlook'], noted: ['h1', 'h4-outlook'] });
    const stored = await storedProgress(orgAId, userAId);
    expect(stored.notes).toEqual(['scena.h1', 'scena.h4-outlook']);
    expect(stored.blocks.scena).toMatchObject({ done: false, visited: ['h1', 'h2', 'h4', 'h4-outlook'], noted: ['h1', 'h4-outlook'] });
  });

  it('walidacja: nieznany przedmiot, dowód bez obejrzenia, nie-dowód, dodatkowe pola, zły kształt - 400; stan bez zmian', async () => {
    await explore(tokenA, ['nie-ma'], []).expect(400);
    await explore(tokenA, ['h3'], ['h3']).expect(400);
    await explore(tokenA, [], ['h4-folder']).expect(400);
    await explore(tokenA, ['../x'], []).expect(400);
    await explore(tokenA, ['h3', 'h3'], []).expect(400);
    await call(`/courses/${courseId}/blocks/scena/explore`, tokenA, { visited: ['h3'], noted: [], done: true }).expect(400);
    await call(`/courses/${courseId}/blocks/scena/explore`, tokenA, { visited: 'h3', noted: [] }).expect(400);
    await call(`/courses/${courseId}/blocks/scena/explore`, tokenA, { visited: ['h3'] }).expect(400);
    await call(`/courses/${courseId}/blocks/scena/explore`, tokenA, { visited: Array.from({ length: 51 }, (_, i) => `x${i}`), noted: [] }).expect(400);
    expect((await storedProgress(orgAId, userAId)).blocks.scena.visited).toEqual(['h1', 'h2', 'h4', 'h4-outlook']);
  });

  it('nieznany blok - 404; blok, do którego gracz jeszcze nie dotarł - 400', async () => {
    await explore(tokenA, ['h1'], [], 'nie-ma').expect(404);
    await explore(tokenA, [], [], 'rozmowa').expect(400);
  });

  it('izolacja A/B: użytkownik B bez przypisania - 404 i nie zmienia stanu A; z własnym przypisaniem ma własny, pusty stan', async () => {
    await explore(tokenB, ['h3'], []).expect(404);
    expect((await storedProgress(orgAId, userAId)).blocks.scena.visited).toEqual(['h1', 'h2', 'h4', 'h4-outlook']);

    await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgBId, userId: userBId, courseId } as never }));
    expect((await start(tokenB).expect(200)).body.progress.blocks.scena).toBeUndefined();
    expect((await explore(tokenB, ['h3'], []).expect(200)).body).toMatchObject({ visited: ['h3'], noted: [] });
    // Stan A nietknięty, stan B nie zawiera niczego z A.
    expect((await storedProgress(orgAId, userAId)).blocks.scena.visited).toEqual(['h1', 'h2', 'h4', 'h4-outlook']);
    const stateB = await storedProgress(orgBId, userBId);
    expect(stateB.blocks.scena).toMatchObject({ visited: ['h3'], noted: [] });
    expect(stateB.notes).toEqual([]);
  });

  it('równoległe zapisy (FOR UPDATE): wszystkie przechodzą, a stan jest sumą - żaden nie nadpisuje drugiego', async () => {
    const results = await Promise.allSettled([explore(tokenB, ['h1'], ['h1']), explore(tokenB, ['h2'], []), explore(tokenB, ['h4'], []), explore(tokenB, ['h4', 'h4-kosz'], [])]);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0))).toEqual([200, 200, 200, 200]);
    const stateB = await storedProgress(orgBId, userBId);
    expect(stateB.blocks.scena).toMatchObject({ visited: ['h1', 'h2', 'h3', 'h4', 'h4-kosz'], noted: ['h1'] });
    expect(stateB.notes).toEqual(['scena.h1']);
  });

  it('easter egg w stanie częściowym nie daje wyróżnienia ani odznaki - te nadaje dopiero zapis bloku', async () => {
    expect((await explore(tokenB, ['h4', 'h4-gra'], []).expect(200)).body.visited).toContain('h4-gra');
    const body = (await start(tokenB).expect(200)).body;
    expect(body.progress.distinctions).toEqual([]);
    expect((await storedProgress(orgBId, userBId)).blocks.scena).not.toHaveProperty('easterEggs');
    const badges = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.userBadge.count({ where: { organizationId: orgBId, userId: userBId } }));
    expect(badges).toBe(0);
  });

  it('kurs ukończony - 400; organizacja przed weryfikacją domeny (PENDING) - 403; stan bez zmian', async () => {
    const before = (await storedProgress(orgBId, userBId)).blocks.scena.visited;
    const setStatus = (status: 'COMPLETED' | 'IN_PROGRESS') =>
      tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.updateMany({ where: { organizationId: orgBId, userId: userBId, courseId }, data: { status } }));
    await setStatus('COMPLETED');
    try {
      await explore(tokenB, ['h1'], []).expect(400);
    } finally {
      await setStatus('IN_PROGRESS');
    }

    await prisma.organization.update({ where: { id: orgBId }, data: { status: 'PENDING_DOMAIN_VERIFICATION' } });
    try {
      const pending = await explore(tokenB, ['h1'], []).expect(403);
      expect(pending.body.code).toBe('ORGANIZATION_PENDING_DOMAIN_VERIFICATION');
    } finally {
      await prisma.organization.update({ where: { id: orgBId }, data: { status: 'ACTIVE' } });
    }
    expect((await storedProgress(orgBId, userBId)).blocks.scena.visited).toEqual(before);
    await explore(tokenB, ['h1'], []).expect(200);
  });

  it('zapis częściowy równolegle z zapisem bloku: blok zostaje ukończony (zwykły wpis), spóźniony /explore niczego nie nadpisuje', async () => {
    const answer = { visited: ['h1', 'h2', 'h3', 'h4', 'h4-kosz', 'h4-gra'], noted: ['h1'] };
    const [partial, done] = await Promise.allSettled([explore(tokenB, ['h4', 'h4-outlook'], []), submit(tokenB, { blockIndex: 0, answer })]);
    expect(done.status === 'fulfilled' ? done.value.status : 0).toBe(200);
    // /explore przed zapisem bloku - 200; po nim - 400 (blok nie jest bieżący) albo 409 (stan zmienił się w trakcie).
    expect([200, 400, 409]).toContain(partial.status === 'fulfilled' ? partial.value.status : 0);
    const stateB = await storedProgress(orgBId, userBId);
    expect(stateB.blocks.scena.done).toBe(true);
    expect(stateB.blocks.scena.visited).toBeUndefined();
  });

  it('zapis bloku („Dalej”) kończy scenę: zwykły wpis ukończenia, notatki bez duplikatów; potem /explore odrzucony', async () => {
    const done = await submit(tokenA, { blockIndex: 0, answer: { visited: ['h1', 'h2', 'h4', 'h4-outlook'], noted: ['h1', 'h4-outlook'] } }).expect(200);
    expect(done.body.currentBlockIndex).toBe(1);
    const stored = await storedProgress(orgAId, userAId);
    expect(stored.blocks.scena.done).toBe(true);
    expect(stored.blocks.scena.visited).toBeUndefined();
    expect(stored.notes).toEqual(['scena.h1', 'scena.h4-outlook']);
    const view = (await start(tokenA).expect(200)).body.progress.blocks.scena;
    expect(view.exploration).toBeUndefined();
    // Scena nie jest już blokiem bieżącym; dialog nie zapisuje stanu częściowego.
    await explore(tokenA, ['h3'], []).expect(400);
    await explore(tokenA, [], [], 'rozmowa').expect(400);
  });
});
