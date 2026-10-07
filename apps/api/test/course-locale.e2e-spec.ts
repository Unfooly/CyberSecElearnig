import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { hashContent } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Język szkoleń (D-133): treść kursu w języku gracza - konto („Język szkoleń”) > przeglądarka (Accept-Language, pierwszy obsługiwany) > EN;
// kurs bez tego języka - całość po polsku z flagą plakietki „Available in Polish only”; tytuł w języku treści. Izolacja A/B: ustawienie
// języka jednego użytkownika nie zmienia języka innego. Serwer nasłuchujący (listen(0)) - CLAUDE.md, reguła 9.
describe('Język szkoleń: wybór języka treści kursu (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.course-locale-e2e-test.test';
  const domainB = 'org-b.course-locale-e2e-test.test';
  const emailA = `jezyk-a-${suffix}@${domainA}`;
  const emailB = `jezyk-b-${suffix}@${domainB}`;

  let tokenA: string;
  let tokenB: string;
  let bilingualId: string;
  let polishOnlyId: string;

  let ipCounter = 0;
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const start = (courseId: string, token: string, acceptLanguage?: string) => {
    const req = request(app.getHttpServer()).post(`/courses/${courseId}/start`).set('Authorization', `Bearer ${token}`).set('CF-Connecting-IP', nextIp());
    return acceptLanguage ? req.set('Accept-Language', acceptLanguage) : req;
  };
  const setLocale = (token: string, contentLocale: string | null) =>
    request(app.getHttpServer()).patch('/users/me/preferences').set('Authorization', `Bearer ${token}`).send({ contentLocale }).expect(200);

  const blocks = [
    { id: 'wstep', type: 'NARRATIVE', text: { pl: 'Dzień dobry.', en: 'Good morning.' } },
    { id: 'koniec', type: 'NARRATIVE', text: { pl: 'Do widzenia.', en: 'Goodbye.' } },
  ];

  async function course(title: object, locales: string[]) {
    const created = await prisma.course.create({ data: { title: `Język ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: blocks as never } });
    await prisma.courseVersion.create({
      data: { courseId: created.id, version: 1, schemaVersion: 6, contentHash: hashContent({ blocks, locales }), contentBlocks: blocks as never, blockCount: 2, locales, title: title as never },
    });
    return created.id;
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

    bilingualId = await course({ pl: 'Łańcuszek', en: 'The chain' }, ['pl', 'en']);
    polishOnlyId = await course({ pl: 'Tylko po polsku', en: 'Polish only' }, ['pl']);
    for (const [user, courseId] of [
      [userA, bilingualId],
      [userA, polishOnlyId],
      [userB, bilingualId],
    ] as const) {
      await tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
        tx.courseAssignment.create({ data: { organizationId: user.organizationId, userId: user.id, courseId } as never }),
      );
    }
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania kaskadowo - FORCE RLS), potem kursy (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'course-locale-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'course-locale-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: { in: [bilingualId, polishOnlyId] } } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  const textOf = (body: { contentBlocks: { text?: string }[] }) => body.contentBlocks[0].text;

  it('bez ustawienia konta: Accept-Language en-US,pl;q=0.8 -> EN (treść i tytuł), pl-PL -> PL, de-DE i brak nagłówka -> EN', async () => {
    const en = (await start(bilingualId, tokenA, 'en-US,pl;q=0.8').expect(200)).body;
    expect(en).toMatchObject({ locale: 'en', locales: ['pl', 'en'], localeFallback: false, title: 'The chain' });
    expect(textOf(en)).toBe('Good morning.');
    const pl = (await start(bilingualId, tokenA, 'pl-PL').expect(200)).body;
    expect(pl).toMatchObject({ locale: 'pl', title: 'Łańcuszek' });
    expect(textOf(pl)).toBe('Dzień dobry.');
    expect((await start(bilingualId, tokenA, 'de-DE').expect(200)).body.locale).toBe('en');
    expect((await start(bilingualId, tokenA).expect(200)).body.locale).toBe('en');
  });

  it('ustawienie konta (pl) wygrywa nad przeglądarką (en); powrót do „wg przeglądarki” (null)', async () => {
    await setLocale(tokenA, 'pl');
    const body = (await start(bilingualId, tokenA, 'en-US').expect(200)).body;
    expect(body).toMatchObject({ locale: 'pl', localeFallback: false });
    expect(textOf(body)).toBe('Dzień dobry.');
    await setLocale(tokenA, null);
    expect((await start(bilingualId, tokenA, 'en-US').expect(200)).body.locale).toBe('en');
  });

  it('kurs locales [pl] dla gracza EN: całość po polsku (także pola z tłumaczeniem) z flagą plakietki', async () => {
    const body = (await start(polishOnlyId, tokenA, 'en-GB').expect(200)).body;
    expect(body).toMatchObject({ locale: 'pl', locales: ['pl'], localeFallback: true, title: 'Tylko po polsku' });
    expect(textOf(body)).toBe('Dzień dobry.');
    expect(body.contentBlocks[1].text).toBe('Do widzenia.');
    // Gracz PL - ten sam kurs bez plakietki.
    expect((await start(polishOnlyId, tokenA, 'pl').expect(200)).body.localeFallback).toBe(false);
  });

  it('izolacja A/B: język konta A nie zmienia języka B; B nie startuje kursu A bez przypisania', async () => {
    await setLocale(tokenA, 'pl');
    expect((await start(bilingualId, tokenB, 'en-US').expect(200)).body.locale).toBe('en');
    await start(polishOnlyId, tokenB, 'en-US').expect(404);
    await setLocale(tokenA, null);
  });
});
