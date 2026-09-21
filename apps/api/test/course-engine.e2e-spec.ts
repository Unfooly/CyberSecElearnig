import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { BlockType, FIELD_CLASSIFICATION, collectPaths } from '@cyberszkolo/content';
import { SECRET_MARKER, fullModule } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Silnik scen: ocena po stronie serwera, brak wycieku klucza w /start, próby i podpowiedzi, notatki w progress, wersje treści
// (przypisanie w trakcie kończy kurs na swojej wersji), postęp w formacie sprzed silnika, izolacja tenantów A/B.
// Rzeczywisty serwer nasłuchujący (listen(0)), bo test współbieżnych prób wysyła równoległe żądania (CLAUDE.md, reguła 9).
describe('Silnik scen: kursy z blokami interaktywnymi (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.course-engine-e2e-test.test';
  const domainB = 'org-b.course-engine-e2e-test.test';
  const emailA = `engine-a-${suffix}@${domainA}`;
  const emailB = `engine-b-${suffix}@${domainB}`;

  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;

  let engineCourseId: string;
  let textCourseId: string;
  let legacyCourseId: string;
  const courseIds: string[] = [];

  let ipCounter = 0;
  // Każde żądanie z innego "klienta" (TRUST_PROXY=true + CF-Connecting-IP), żeby globalny limit per IP nie zaburzał testów.
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const call = (method: 'get' | 'post', path: string, token: string, body?: object, ip = nextIp()) => {
    const req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`).set('CF-Connecting-IP', ip);
    return body ? req.send(body) : req;
  };
  const start = (token: string, courseId: string) => call('post', `/courses/${courseId}/start`, token);
  const submit = (token: string, courseId: string, body: object) => call('post', `/courses/${courseId}/progress`, token, body);
  const attempt = (token: string, courseId: string, blockId: string, answer: unknown, ip?: string) =>
    call('post', `/courses/${courseId}/blocks/${blockId}/attempt`, token, { answer }, ip);

  // Id elementów (ORDERING, EMAIL_ANALYSIS) są nieprzejrzyste i różne w każdym przypisaniu: klient odsyła te, które dostał w /start.
  // Element znajdujemy po widocznym tekście (etykieta kryterium / treść kroku).
  async function opaqueIds(token: string, courseId: string, blockId: string, field: 'criteria' | 'items', texts: string[]) {
    const blocks = (await start(token, courseId).expect(200)).body.contentBlocks as any[];
    const list = blocks.find((b) => b.id === blockId)[field] as { id: string; label?: string; text?: string }[];
    return texts.map((text) => list.find((item) => (item.label ?? item.text) === text)!.id);
  }
  const CRITERIA = { c1: 'Podejrzana domena', c2: 'Poprawna polszczyzna', c3: 'Presja czasu' };
  const STEPS = { o1: 'Nie klikaj', o2: 'Zgłoś', o3: 'Usuń' };

  // Moduł z fixtur packages/content: po jednym bloku każdego typu, bez nadpisanych wag (domyślne: oceniane 1, eksploracyjne 0).
  function engineBlocks() {
    const module = JSON.parse(JSON.stringify(fullModule())) as ReturnType<typeof fullModule>;
    for (const block of module.blocks) delete (block as Record<string, unknown>).weight;
    return parseModule(module).blocks;
  }

  async function createCourse(title: string, blocks: unknown[], schemaVersion: 1 | 2, withVersion = true) {
    const course = await prisma.course.create({
      data: { title, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never },
    });
    courseIds.push(course.id);
    if (withVersion) {
      await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          version: 1,
          schemaVersion,
          contentHash: hashContent(blocks),
          contentBlocks: blocks as never,
          blockCount: blocks.length,
        },
      });
    }
    return course.id;
  }

  const assign = (orgId: string, userId: string, courseId: string, data: Record<string, unknown> = {}) =>
    tenantPrisma.runInOrgContext(orgId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId: orgId, userId, courseId, ...data } as never }),
    );

  const textBlock = (overrides: Record<string, unknown> = {}) => ({
    id: 'domena',
    type: 'TEXT_INPUT_GUIDED',
    prompt: 'Jaka jest prawdziwa domena?',
    answer: { accept: ['bank.pl'], caseSensitive: false },
    normalize: { trim: true, collapseWhitespace: true },
    hints: [{ text: 'Podpowiedź pierwsza' }],
    maxAttempts: 4,
    scoring: { attemptPenalty: 0.25, floor: 0.25 },
    solution: { text: 'bank.pl', explanation: 'Wyjaśnienie rozwiązania' },
    ...overrides,
  });
  const videoBlock = (id: string) => ({ id, type: 'VIDEO', url: 'https://example.test/v.mp4' });

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

    engineCourseId = await createCourse(`Silnik scen ${suffix}`, engineBlocks(), 2);
    textCourseId = await createCourse(`Zadanie tekstowe ${suffix}`, [textBlock(), videoBlock('wideo')], 2);
    // Celowo BRAK przypisania kursów silnika dla organizacji B (testy izolacji).
    await assign(orgAId, userAId, engineCourseId);
    await assign(orgAId, userAId, textCourseId);
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Kolejność: najpierw organizacje (kasują użytkowników i przypisania kaskadowo), potem kursy. Przypisania mają FORCE RLS,
    // więc deleteMany bez kontekstu organizacji ich nie widzi, a kurs z przypisaniami jest chroniony (RESTRICT, B-032).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'course-engine-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'course-engine-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  describe('/start: klucz odpowiedzi nie wycieka', () => {
    it('odpowiedź zawiera wyłącznie pola z listy client (białej listy) i żadnego markera sekretu', async () => {
      const response = await start(tokenA, engineCourseId).expect(200);
      const blocks = response.body.contentBlocks as { id: string; type: BlockType }[];

      expect(blocks).toHaveLength(13);
      expect(JSON.stringify(response.body)).not.toContain(SECRET_MARKER);

      for (const block of blocks) {
        const allowed = [...FIELD_CLASSIFICATION[block.type].client, 'hintCount'];
        for (const path of collectPaths(block)) expect(allowed).toContain(path);
        for (const secret of FIELD_CLASSIFICATION[block.type].secret) expect(collectPaths(block)).not.toContain(secret);
      }
    });

    it('klient nie dostaje podpowiedzi, rozwiązania ani poprawnych odpowiedzi zadania tekstowego, tylko liczbę podpowiedzi', async () => {
      const response = await start(tokenA, engineCourseId).expect(200);
      const text = response.body.contentBlocks.find((b: { type: string }) => b.type === 'TEXT_INPUT_GUIDED');
      expect(text.hintCount).toBe(1);
      for (const key of ['hints', 'solution', 'answer', 'normalize', 'scoring']) expect(text).not.toHaveProperty(key);
    });

    it('kolejność kryteriów EMAIL_ANALYSIS i elementów ORDERING jest stabilna między wywołaniami, a id są nieprzejrzyste', async () => {
      const first = (await start(tokenA, engineCourseId).expect(200)).body.contentBlocks;
      const second = (await start(tokenA, engineCourseId).expect(200)).body.contentBlocks;
      const ids = (blocks: any[], type: string, field: string) =>
        blocks.find((b) => b.type === type)[field].map((i: { id: string }) => i.id);

      // Odświeżenie strony nie daje nowej permutacji (inaczej porównanie dwóch układów odsłaniałoby kolejność) ani nowych id.
      expect(ids(first, 'ORDERING', 'items')).toEqual(ids(second, 'ORDERING', 'items'));
      expect(ids(first, 'EMAIL_ANALYSIS', 'criteria')).toEqual(ids(second, 'EMAIL_ANALYSIS', 'criteria'));
      // Id z treści (o1..o3, c1..c3) nie wychodzą; klient dostaje wyłącznie id nieprzejrzyste.
      for (const id of ids(first, 'ORDERING', 'items')) expect(id).toMatch(/^[0-9a-f]{24}$/);
      for (const id of ids(first, 'EMAIL_ANALYSIS', 'criteria')) expect(id).toMatch(/^[0-9a-f]{24}$/);
      expect(JSON.stringify(first)).not.toMatch(/"o[123]"|"c[123]"/);
    });

    it('opcje QUIZ nie mają correct/outcome/feedback', async () => {
      const quiz = (await start(tokenA, engineCourseId).expect(200)).body.contentBlocks[1];
      expect(quiz.options).toEqual([{ text: 'a@bank.pl' }, { text: 'a@bank-0.pl' }]);
    });
  });

  describe('przejście całego modułu z każdym typem bloku', () => {
    it('sekwencyjność: nie da się przeskoczyć bloku ani wysłać niepoprawnego kształtu odpowiedzi', async () => {
      await submit(tokenA, engineCourseId, { blockIndex: 5 }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 0, answer: { correct: true } }).expect(200); // wideo: odpowiedź ignorowana
      await submit(tokenA, engineCourseId, { blockIndex: 0 }).expect(400); // ten blok jest już za nami
      // Klient nie może podać oceny ani punktów: pole spoza DTO odrzuca ValidationPipe.
      await submit(tokenA, engineCourseId, { blockIndex: 1, answer: 1, correct: true }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 1, answer: '1' }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 1 }).expect(400);
    });

    it('bloki wyboru, nieoceniane i eksploracyjne', async () => {
      expect((await submit(tokenA, engineCourseId, { blockIndex: 1, answer: 1 }).expect(200)).body.lastResult).toMatchObject({
        blockId: 'quiz',
        correct: true,
        points: 1,
      });
      await submit(tokenA, engineCourseId, { blockIndex: 2, answer: 1 }).expect(200);
      await submit(tokenA, engineCourseId, { blockIndex: 3 }).expect(200);
      await submit(tokenA, engineCourseId, { blockIndex: 4 }).expect(200);

      await submit(tokenA, engineCourseId, { blockIndex: 5, answer: { visited: [] } }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 5, answer: { visited: ['h1', 'nie-ma'] } }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 5, answer: { visited: ['h1'] } }).expect(200);
    });

    it('dialog dopisuje notatkę do progress (treść rozwiązuje serwer), notatnik ją pokazuje po wznowieniu', async () => {
      await submit(tokenA, engineCourseId, { blockIndex: 6, answer: { asked: ['q1'] } }).expect(200);
      await submit(tokenA, engineCourseId, { blockIndex: 7 }).expect(200);

      const resumed = (await start(tokenA, engineCourseId).expect(200)).body;
      expect(resumed.currentBlockIndex).toBe(8);
      expect(resumed.progress.notes).toEqual([{ blockId: 'rozmowa', text: 'Mail przyszedł rano.' }]);
      expect(resumed.progress.v).toBe(2);
      expect(resumed.progress.blocks.quiz).toMatchObject({ done: true, correct: true, points: 1 });
    });

    it('EMAIL_ANALYSIS: ocena serwerowa, rozstrzygnięcie kryteriów po odpowiedzi, notatki za trafione kryteria', async () => {
      const [c1, c3] = await opaqueIds(tokenA, engineCourseId, 'mail', 'criteria', [CRITERIA.c1, CRITERIA.c3]);
      await submit(tokenA, engineCourseId, { blockIndex: 8, answer: { selected: [c1, 'nie-ma'] } }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 8, answer: { selected: ['c1', 'c3'] } }).expect(400); // id z treści
      const result = (await submit(tokenA, engineCourseId, { blockIndex: 8, answer: { selected: [c1, c3] } }).expect(200)).body;

      expect(result.lastResult).toMatchObject({ blockId: 'mail', correct: true, points: 1 });
      expect(result.lastResult.detail.criteria).toHaveLength(3);
      // Rozstrzygnięcie kryteriów idzie po id nieprzejrzystych, które klient zna.
      expect(result.lastResult.detail.criteria.map((c: { id: string }) => c.id)).toContain(c1);
      const progress = (await start(tokenA, engineCourseId).expect(200)).body.progress;
      expect(progress.notes.map((n: { text: string }) => n.text)).toEqual([
        'Mail przyszedł rano.',
        `${SECRET_MARKER}-note-c1`,
        `${SECRET_MARKER}-note-c3`,
      ]);
      // Brak id z treści w progress.notes: klient dostaje blockId i treść, bez klucza "<blockId>.<itemId>" (np. mail.c1).
      for (const note of progress.notes) expect(Object.keys(note).sort()).toEqual(['blockId', 'text']);
      expect(JSON.stringify(progress)).not.toMatch(/mail\.c[13]|rozmowa\.q1|"c[123]"/);
    });

    it('TEXT_INPUT_GUIDED: "Dalej" wymaga rozwiązania; próby, podpowiedź po błędnej, punkty maleją z próbami', async () => {
      await submit(tokenA, engineCourseId, { blockIndex: 9 }).expect(400);

      const wrong = (await attempt(tokenA, engineCourseId, 'domena', 'zla').expect(200)).body;
      expect(wrong).toMatchObject({ correct: false, attempt: 1, attemptsLeft: 3, done: false });
      expect(wrong.hint.text).toContain(SECRET_MARKER);
      expect(wrong).not.toHaveProperty('solution');

      // Wznowienie: odsłonięta podpowiedź i licznik prób wracają z /start.
      const resumed = (await start(tokenA, engineCourseId).expect(200)).body.progress.blocks.domena;
      expect(resumed).toMatchObject({ done: false, attempts: 1 });
      expect(resumed.revealedHints).toHaveLength(1);
      await submit(tokenA, engineCourseId, { blockIndex: 9 }).expect(400);

      const right = (await attempt(tokenA, engineCourseId, 'domena', ` ${SECRET_MARKER}-ODP `).expect(200)).body;
      expect(right).toMatchObject({ correct: true, attempt: 2, done: true, points: 0.75 });
      await attempt(tokenA, engineCourseId, 'domena', 'jeszcze raz').expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 9 }).expect(200);
    });

    it('ORDERING i TABS, potem SUMMARY kończy kurs; wynik = średnia ważona bloków ocenianych', async () => {
      const steps = await opaqueIds(tokenA, engineCourseId, 'kolejnosc', 'items', [STEPS.o1, STEPS.o2, STEPS.o3]);
      await submit(tokenA, engineCourseId, { blockIndex: 10, answer: { order: steps.slice(0, 2) } }).expect(400);
      await submit(tokenA, engineCourseId, { blockIndex: 10, answer: { order: ['o1', 'o2', 'o3'] } }).expect(400); // id z treści
      const ordering = (await submit(tokenA, engineCourseId, { blockIndex: 10, answer: { order: steps } }).expect(200)).body;
      expect(ordering.lastResult).toMatchObject({ points: 1, detail: { correctOrder: steps } });
      await submit(tokenA, engineCourseId, { blockIndex: 11, answer: { opened: ['t1'] } }).expect(200);

      const done = (await submit(tokenA, engineCourseId, { blockIndex: 12 }).expect(200)).body;
      expect(done.status).toBe('COMPLETED');
      // quiz 1, scenariusz 1, mail 1, tekst 0.75, kolejność 1 (waga 1 każdy; eksploracyjne poza wynikiem) = 4.75 / 5.
      expect(done.score).toBe(95);
      expect(done.gamification).not.toBeNull();

      await submit(tokenA, engineCourseId, { blockIndex: 12 }).expect(400);
      await attempt(tokenA, engineCourseId, 'domena', 'x').expect(400);
      // /start na ukończonym kursie nie cofa statusu.
      expect((await start(tokenA, engineCourseId).expect(200)).body.status).toBe('COMPLETED');
    });
  });

  describe('id nieprzejrzyste i komunikaty błędów', () => {
    let sharedCourseId: string;

    beforeAll(async () => {
      const blocks = engineBlocks().filter((b) => b.type === 'EMAIL_ANALYSIS' || b.type === 'ORDERING');
      sharedCourseId = await createCourse(`Wspólne id ${suffix}`, blocks, 2);
      await assign(orgAId, userAId, sharedCourseId);
      await assign(orgBId, userBId, sharedCourseId);
    });

    // Teksty, których nie może być w komunikatach błędów: treść pytań/kroków, etykiety kryteriów, klucz i wyjaśnienia.
    const FORBIDDEN = ['Zaznacz oznaki phishingu', 'Ułóż kroki reakcji', 'Podejrzana domena', 'Nie klikaj', SECRET_MARKER];
    const expectNoBlockContent = (body: unknown) => {
      const text = JSON.stringify(body);
      for (const fragment of FORBIDDEN) expect(text).not.toContain(fragment);
    };

    it('dwa różne przypisania tego samego bloku dostają różne id elementów, a id cudzego przypisania daje 400', async () => {
      const labels = [CRITERIA.c1, CRITERIA.c2, CRITERIA.c3];
      const idsA = await opaqueIds(tokenA, sharedCourseId, 'mail', 'criteria', labels);
      const idsB = await opaqueIds(tokenB, sharedCourseId, 'mail', 'criteria', labels);

      for (let i = 0; i < labels.length; i += 1) expect(idsA[i]).not.toBe(idsB[i]);
      expect(new Set([...idsA, ...idsB]).size).toBe(6);

      const foreign = await submit(tokenA, sharedCourseId, { blockIndex: 0, answer: { selected: [idsB[0], idsB[2]] } }).expect(400);
      expectNoBlockContent(foreign.body);
      // Własne id działają (blok nie został zużyty przez odrzuconą próbę).
      await submit(tokenA, sharedCourseId, { blockIndex: 0, answer: { selected: [idsA[0], idsA[2]] } }).expect(200);

      const stepsA = await opaqueIds(tokenA, sharedCourseId, 'kolejnosc', 'items', [STEPS.o1, STEPS.o2, STEPS.o3]);
      const stepsB = await opaqueIds(tokenB, sharedCourseId, 'kolejnosc', 'items', [STEPS.o1, STEPS.o2, STEPS.o3]);
      stepsA.forEach((id, i) => expect(id).not.toBe(stepsB[i]));
      expectNoBlockContent((await submit(tokenA, sharedCourseId, { blockIndex: 1, answer: { order: stepsB } }).expect(400)).body);
    });

    it('odpowiedzi 400 i 404 nie zawierają treści bloku, klucza ani wyjaśnień', async () => {
      const responses = [
        await submit(tokenB, sharedCourseId, { blockIndex: 1 }), // sekwencja: bieżący blok to 0
        await submit(tokenB, sharedCourseId, { blockIndex: 99 }),
        await submit(tokenB, sharedCourseId, { blockIndex: 0 }), // brak odpowiedzi
        await submit(tokenB, sharedCourseId, { blockIndex: 0, answer: { selected: ['c1', 'c3'] } }), // id z treści
        await submit(tokenB, sharedCourseId, { blockIndex: 0, answer: { selected: 'c1' } }),
        await submit(tokenB, sharedCourseId, { blockIndex: 0, correct: true }), // pole spoza DTO
        await attempt(tokenB, sharedCourseId, 'mail', 'x'), // nie jest blokiem tekstowym
        await attempt(tokenB, sharedCourseId, 'nie-ma', 'x'),
        await start(tokenB, engineCourseId), // kurs nieprzypisany B
        await submit(tokenB, engineCourseId, { blockIndex: 0 }),
        await attempt(tokenB, textCourseId, 'domena', 'x'),
      ];
      expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400, 400, 404, 404, 404, 404]);
      for (const response of responses) expectNoBlockContent(response.body);
    });

    it('równoległe /start kursu bez wersji tworzą dokładnie jedną wersję 1 (idempotentne, bez błędów)', async () => {
      const blocks = [{ type: 'VIDEO', url: 'https://example.test/v.mp4' }, { type: 'QUIZ', prompt: 'Pytanie', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] }];
      const course = await createCourse(`Bez wersji ${suffix}`, blocks, 1, false);
      await assign(orgAId, userAId, course);

      const results = await Promise.allSettled(Array.from({ length: 8 }, () => start(tokenA, course)));
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));

      expect(statuses).toEqual(Array(8).fill(200));
      expect(await prisma.courseVersion.count({ where: { courseId: course } })).toBe(1);
      const version = await prisma.courseVersion.findFirstOrThrow({ where: { courseId: course } });
      expect(version).toMatchObject({ version: 1, schemaVersion: 1, blockCount: 2 });
    });
  });

  describe('próby: limity, walidacja, współbieżność', () => {
    it('wyczerpanie prób: blok rozstrzygnięty z 0 punktów, odpowiedź odsłania rozwiązanie i wyjaśnienie', async () => {
      const course = await createCourse(`Wyczerpanie ${suffix}`, [textBlock({ maxAttempts: 2 }), videoBlock('wideo')], 2);
      await assign(orgAId, userAId, course);

      const first = (await attempt(tokenA, course, 'domena', 'a').expect(200)).body;
      expect(first).toMatchObject({ done: false, attemptsLeft: 1 });
      expect(first).not.toHaveProperty('solution');

      const last = (await attempt(tokenA, course, 'domena', 'b').expect(200)).body;
      expect(last).toMatchObject({ correct: false, done: true, attemptsLeft: 0, points: 0 });
      expect(last.solution).toEqual({ text: 'bank.pl', explanation: 'Wyjaśnienie rozwiązania' });

      await attempt(tokenA, course, 'domena', 'bank.pl').expect(400);
      // Po wyczerpaniu prób można przejść dalej, rozwiązanie wraca też przy wznowieniu.
      expect((await start(tokenA, course).expect(200)).body.progress.blocks.domena.solution.text).toBe('bank.pl');
      const finished = (await submit(tokenA, course, { blockIndex: 0 }).expect(200)).body;
      expect(finished.currentBlockIndex).toBe(1);
      expect(finished.score).toBe(0);
    });

    it('walidacja: nieznany blok 404, blok spoza kolejki i nietekstowy 400, zła treść żądania 400', async () => {
      await attempt(tokenA, textCourseId, 'nie-ma', 'x').expect(404);
      await attempt(tokenA, textCourseId, 'wideo', 'x').expect(400); // nie jest bieżącym blokiem
      await call('post', `/courses/${textCourseId}/blocks/domena/attempt`, tokenA, {}).expect(400);
      await call('post', `/courses/${textCourseId}/blocks/domena/attempt`, tokenA, { answer: 5 }).expect(400);
      await call('post', `/courses/${textCourseId}/blocks/domena/attempt`, tokenA, { answer: 'a'.repeat(501) }).expect(400);
      await call('post', `/courses/${textCourseId}/blocks/domena/attempt`, tokenA, { answer: 'a', points: 1 }).expect(400);

      const videoFirst = await createCourse(`Wideo najpierw ${suffix}`, [videoBlock('wideo'), textBlock()], 2);
      await assign(orgAId, userAId, videoFirst);
      await attempt(tokenA, videoFirst, 'wideo', 'x').expect(400); // bieżący blok, ale nie tekstowy
    });

    it('równoległe próby nie obchodzą limitu maxAttempts (FOR UPDATE): zaakceptowane dokładnie tyle, ile wolno', async () => {
      const course = await createCourse(`Współbieżność ${suffix}`, [textBlock({ maxAttempts: 3, hints: [] }), videoBlock('wideo')], 2);
      await assign(orgAId, userAId, course);

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => attempt(tokenA, course, 'domena', `zla-${i}`)),
      );
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));

      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 400)).toHaveLength(5);
      const entry = (await start(tokenA, course).expect(200)).body.progress.blocks.domena;
      expect(entry).toMatchObject({ attempts: 3, done: true, correct: false });
    });

    it('limit żądań liczony per użytkownik: zmiana adresu IP go nie omija, inny użytkownik nie jest dotknięty', async () => {
      const ip = '198.51.100.7';
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        statuses.push((await attempt(tokenA, textCourseId, 'wideo', 'x', ip)).status);
      }
      expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
      expect(statuses[30]).toBe(429);

      expect((await attempt(tokenA, textCourseId, 'wideo', 'x', '198.51.100.8')).status).toBe(429);
      // Użytkownik B (organizacja B) z innego adresu: dalej zwykła odpowiedź (kurs nie jest mu przypisany), nie 429.
      expect((await attempt(tokenB, textCourseId, 'wideo', 'x', '198.51.100.9')).status).toBe(404);
    });
  });

  describe('izolacja tenantów A/B', () => {
    it('użytkownik organizacji B nie ma dostępu do kursu przypisanego wyłącznie organizacji A (start, postęp, próba)', async () => {
      await start(tokenB, engineCourseId).expect(404);
      await submit(tokenB, engineCourseId, { blockIndex: 0 }).expect(404);
      await attempt(tokenB, textCourseId, 'domena', 'bank.pl').expect(404);
    });

    it('B ma własne przypisanie tego samego kursu z własnym, niezależnym postępem', async () => {
      const course = await createCourse(`Wspólny katalog ${suffix}`, [textBlock(), videoBlock('wideo')], 2);
      await assign(orgAId, userAId, course);
      await assign(orgBId, userBId, course);

      await attempt(tokenA, course, 'domena', 'bank.pl').expect(200);
      const b = (await start(tokenB, course).expect(200)).body;
      expect(b.progress.blocks).toEqual({});
      expect(b.currentBlockIndex).toBe(0);

      // Na poziomie bazy (RLS): kontekst organizacji B widzi wyłącznie własne przypisanie tego kursu, bez postępu ani wersji A.
      const seenByB = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.findMany({ where: { courseId: course } }));
      expect(seenByB).toHaveLength(1);
      expect(seenByB[0]).toMatchObject({ organizationId: orgBId, userId: userBId, progress: null });
      const seenByA = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.findMany({ where: { courseId: course } }));
      expect(seenByA).toHaveLength(1);
      expect(seenByA[0].userId).toBe(userAId);
    });
  });

  describe('wersje treści i postęp sprzed silnika', () => {
    it('kurs rozpoczęty przed migracją (bez przypiętej wersji, progress w starym formacie) da się dokończyć mimo nowszej wersji', async () => {
      const legacyBlocks = [
        { type: 'VIDEO', url: 'https://example.test/v.mp4' },
        { type: 'QUIZ', prompt: 'Pytanie', options: [{ text: 'Zła', correct: false }, { text: 'Dobra', correct: true, feedback: `${SECRET_MARKER}-legacy` }] },
      ];
      // Wersja 1 (jak z migracji dla istniejących kursów) + późniejszy import nowej treści (wersja 2).
      legacyCourseId = await createCourse(`Legacy ${suffix}`, legacyBlocks, 1);
      const v2Blocks = parseModule({
        ...JSON.parse(JSON.stringify(fullModule())),
        blocks: [{ id: 'nowy', type: 'NOTEPAD' }, { id: 'drugi', type: 'NOTEPAD' }, { id: 'koniec', type: 'SUMMARY' }],
      }).blocks;
      await prisma.courseVersion.create({
        data: { courseId: legacyCourseId, version: 2, schemaVersion: 2, contentHash: hashContent(v2Blocks), contentBlocks: v2Blocks as never, blockCount: 3 },
      });

      await assign(orgAId, userAId, legacyCourseId, {
        status: 'IN_PROGRESS',
        currentBlockIndex: 1,
        progress: { '0': { type: 'VIDEO', answeredAt: '2026-01-01T00:00:00.000Z' } },
      });
      // B dopiero zaczyna: dostaje NAJNOWSZĄ wersję.
      await assign(orgBId, userBId, legacyCourseId);

      const a = (await start(tokenA, legacyCourseId).expect(200)).body;
      expect(a.contentBlocks.map((b: { id: string }) => b.id)).toEqual(['b0', 'b1']);
      expect(JSON.stringify(a)).not.toContain(SECRET_MARKER);
      expect(a.contentBlocks[1].options).toEqual([{ text: 'Zła' }, { text: 'Dobra' }]);
      expect(a.progress.blocks.b0).toMatchObject({ done: true });

      const finished = (await submit(tokenA, legacyCourseId, { blockIndex: 1, answer: 1 }).expect(200)).body;
      expect(finished).toMatchObject({ status: 'COMPLETED', score: 100 });

      // Nowy zapis jest już w nowym formacie (z przeliczonym wpisem b0), a przypisanie zostało przypięte do wersji 1.
      const stored = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.courseAssignment.findFirst({ where: { organizationId: orgAId, courseId: legacyCourseId }, include: { courseVersion: true } }),
      );
      expect(stored?.courseVersion?.version).toBe(1);
      expect(stored?.progress).toMatchObject({ v: 2, blocks: { b0: { done: true }, b1: { done: true, correct: true, points: 1 } } });

      const b = (await start(tokenB, legacyCourseId).expect(200)).body;
      expect(b.contentBlocks.map((x: { id: string }) => x.id)).toEqual(['nowy', 'drugi', 'koniec']);
    });

    it('lista kursów liczy bloki wersji, na której pracuje pracownik', async () => {
      const listA = (await call('get', '/courses/my', tokenA).expect(200)).body as { courseId: string; totalBlocks: number }[];
      const listB = (await call('get', '/courses/my', tokenB).expect(200)).body as { courseId: string; totalBlocks: number }[];
      expect(listA.find((c) => c.courseId === legacyCourseId)?.totalBlocks).toBe(2);
      expect(listB.find((c) => c.courseId === legacyCourseId)?.totalBlocks).toBe(3);
    });

    it('nie da się usunąć kursu ani wersji, do której są przypisania (B-032: RESTRICT zamiast CASCADE)', async () => {
      await expect(prisma.course.delete({ where: { id: engineCourseId } })).rejects.toMatchObject({ code: 'P2003' });
      const version = await prisma.courseVersion.findFirstOrThrow({ where: { courseId: engineCourseId } });
      await expect(prisma.courseVersion.delete({ where: { id: version.id } })).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
