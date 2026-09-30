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

// Przesłuchanie (INTERROGATION, D-118): podważenie kwestii dowodem z notatnika (/challenge) - odnośnik notatki z postępu, jedna próba na
// kwestię, odsłona kwestii po trafieniu, wynik bloku, kolejność bloków i izolacja tenantów A/B. Kurs v6: nagranie (dowód `liczba`),
// potem przesłuchanie, które ten dowód obala. Serwer nasłuchujący (listen(0)) - CLAUDE.md, reguła 9.
describe('Przesłuchanie: podważenie kwestii dowodem (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.interrogation-e2e-test.test';
  const domainB = 'org-b.interrogation-e2e-test.test';
  const emailA = `przes-a-${suffix}@${domainA}`;
  const emailB = `przes-b-${suffix}@${domainB}`;

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
  const challenge = (token: string, lineId: string, noteRef: string) =>
    call(`/courses/${courseId}/blocks/przesluchanie/challenge`, token, { lineId, noteRef });

  function courseBlocks() {
    const blocks = fullBlocks();
    const module = { schemaVersion: 6, slug: `przesluchanie-${suffix}`, title: 'Przesłuchanie', category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 5, mandatory: false, blocks: [blocks.CALL_RECORDING, blocks.INTERROGATION] };
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
    orgBId = userB.organizationId;
    userBId = userB.id;

    const blocks = courseBlocks();
    const course = await prisma.course.create({ data: { title: `Przesłuchanie ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    courseId = course.id;
    await prisma.courseVersion.create({
      data: { courseId, version: 1, schemaVersion: 6, contentHash: hashContent(blocks), contentBlocks: blocks as never, blockCount: blocks.length },
    });
    await tenantPrisma.runInOrgContext(userA.organizationId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId: userA.organizationId, userId: userA.id, courseId } as never }),
    );
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania kaskadowo - FORCE RLS), potem kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'interrogation-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'interrogation-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  let liczbaRef: string;

  it('/start: sprzeczność nie wycieka, podważenie przed dotarciem do przesłuchania - 400', async () => {
    const body = (await start(tokenA).expect(200)).body;
    expect(JSON.stringify(body)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(body.contentBlocks)).not.toContain('contradiction');
    // Stały mianownik (D-130): fragment, wiersz konsoli i sprzeczność w sumie od startu; KTÓRA kwestia kłamie - nadal sekret (wyżej).
    expect(body.progress.evidence.perBlock.find((b: { blockId: string }) => b.blockId === 'przesluchanie')).toMatchObject({ collected: 0, total: 3 });
    await challenge(tokenA, 'kod-1', 'a1b2c3d4e5f6a1b2c3d4e5f6').expect(400);
    // Nieznany blok - 404; bieżący blok innego typu (nagranie) - 400.
    await call(`/courses/${courseId}/blocks/nie-ma/challenge`, tokenA, { lineId: 'kod-1', noteRef: 'a1b2c3d4e5f6a1b2c3d4e5f6' }).expect(404);
    await call(`/courses/${courseId}/blocks/nagranie/challenge`, tokenA, { lineId: 'kod-1', noteRef: 'a1b2c3d4e5f6a1b2c3d4e5f6' }).expect(400);
  });

  it('nagranie: trafiona flaga dopisuje dowód z nieprzejrzystym odnośnikiem (bez klucza notatki)', async () => {
    const response = await submit(tokenA, { blockIndex: 0, answer: { taps: [{ segmentId: 's1' }, { segmentId: 's3' }] } }).expect(200);
    const note = (response.body.notes as { blockId: string; ref?: string }[]).find((n) => n.blockId === 'nagranie')!;
    expect(note.ref).toMatch(/^[a-f0-9]{24}$/);
    // Klucz notatki (`<blok>.<id dowodu>` - id dowodu nagrania jest sekretem) nie wychodzi do klienta.
    expect(JSON.stringify(response.body.notes)).not.toContain('nagranie.liczba');
    expect((response.body.notes as Record<string, unknown>[]).every((n) => !('key' in n))).toBe(true);
    liczbaRef = note.ref!;
    // Ten sam odnośnik w widoku postępu (/start) - stały dla przypisania.
    const progressNotes = (await start(tokenA).expect(200)).body.progress.notes as { ref?: string }[];
    expect(progressNotes.map((n) => n.ref)).toContain(liczbaRef);
  });

  it('odnośnik spoza notatnika gracza albo nieznana kwestia - 400; walidacja DTO', async () => {
    await challenge(tokenA, 'kod-1', 'ffffffffffffffffffffffff').expect(400);
    await challenge(tokenA, 'nie-ma', liczbaRef).expect(400);
    await call(`/courses/${courseId}/blocks/przesluchanie/challenge`, tokenA, { lineId: 'kod-1', noteRef: liczbaRef, correct: true }).expect(400);
    await call(`/courses/${courseId}/blocks/przesluchanie/challenge`, tokenA, { lineId: '../x', noteRef: liczbaRef }).expect(400);
  });

  it('prawdziwa kwestia: pudło bez treści sekretu; jedna próba na kwestię', async () => {
    const miss = (await challenge(tokenA, 'glos-2', liczbaRef).expect(200)).body;
    expect(miss).toMatchObject({ blockId: 'przesluchanie', lineId: 'glos-2', correct: false });
    expect(miss.line).toBeUndefined();
    expect(miss.note).toBeUndefined();
    await challenge(tokenA, 'glos-2', liczbaRef).expect(400);
  });

  it('sprzeczność obalona właściwym dowodem: kwestia po podważeniu, notatka z odnośnikiem, licznik dowodów; potem wynik bloku 1', async () => {
    const hit = (await challenge(tokenA, 'kod-1', liczbaRef).expect(200)).body;
    expect(hit).toMatchObject({ lineId: 'kod-1', correct: true, line: { text: `${SECRET_MARKER}-przyznanie` } });
    expect(hit.note).toMatchObject({ blockId: 'przesluchanie', text: `${SECRET_MARKER}-dowod-przyznanie`, kind: 'person' });
    expect(hit.note.ref).toMatch(/^[a-f0-9]{24}$/);
    expect(hit.evidence.perBlock.find((b: { blockId: string }) => b.blockId === 'przesluchanie')).toMatchObject({ collected: 1, total: 3 });
    await challenge(tokenA, 'kod-1', liczbaRef).expect(400);

    // Odświeżenie strony w trakcie bloku: podważenia i odsłonięta kwestia w widoku postępu.
    const view = (await start(tokenA).expect(200)).body.progress.blocks.przesluchanie;
    expect(view.challenges).toEqual([
      { lineId: 'glos-2', correct: false },
      { lineId: 'kod-1', correct: true, line: { text: `${SECRET_MARKER}-przyznanie` } },
    ]);

    const done = await submit(tokenA, {
      blockIndex: 1,
      answer: { asked: ['glos', 'kod', 'konsola'], noted: ['glos-1', 'l2'], opened: ['logowania'] },
    }).expect(200);
    // Trafienie + pudło (glos-2): 1 / (1 sprzeczność + 1 pudło) - pudło kosztuje.
    expect(done.body.lastResult).toMatchObject({ type: 'INTERROGATION', correct: false, points: 0.5 });
    // Po ukończeniu: które kwestie kłamały i ich przyznanie.
    expect(done.body.lastResult.detail).toEqual({ contradictions: [{ lineId: 'kod-1', line: { text: `${SECRET_MARKER}-przyznanie` } }] });
    // Kurs ukończony (dwa bloki) - dalsze podważenia odrzucone.
    await challenge(tokenA, 'glos-1', liczbaRef).expect(400);
  });

  it('izolacja A/B: użytkownik B nie podważa kwestii w kursie A ani nie użyje odnośnika A we własnym przypisaniu', async () => {
    await challenge(tokenB, 'kod-1', liczbaRef).expect(404);
    // B z własnym przypisaniem tego samego kursu: odnośniki są inne w każdym przypisaniu, a notatnik B jest pusty.
    await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgBId, userId: userBId, courseId } as never }));
    await start(tokenB).expect(200);
    await submit(tokenB, { blockIndex: 0, answer: { taps: [{ segmentId: 's3' }] } }).expect(200);
    await challenge(tokenB, 'kod-1', liczbaRef).expect(400);
    const bRef = ((await start(tokenB).expect(200)).body.progress.notes as { ref: string }[])[0].ref;
    expect(bRef).not.toBe(liczbaRef);
    expect((await challenge(tokenB, 'kod-1', bRef).expect(200)).body.correct).toBe(true);
  });

  it('jedna próba na kwestię także przy równoległych żądaniach (FOR UPDATE): dokładnie jedno 200, jeden wpis', async () => {
    const bRef = ((await start(tokenB).expect(200)).body.progress.notes as { ref: string }[])[0].ref;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => challenge(tokenB, 'glos-2', bRef)));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 400, 400, 400, 400]);
    const challenges = (await start(tokenB).expect(200)).body.progress.blocks.przesluchanie.challenges as { lineId: string }[];
    expect(challenges.filter((c) => c.lineId === 'glos-2')).toHaveLength(1);
  });
});
