import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Odznaka za easter egg w chwili odkrycia (D-199): zapis stanu sceny (POST /courses/:id/blocks/:blockId/explore) z obejrzanym hotspotem
// z okienkami przyznaje osiągnięcie od razu i zwraca je w `unlockedBadges` - WYŁĄCZNIE przy pierwszym zdobyciu (kto ma je już z
// poprzedniego przejścia, dostaje pustą listę - odtwarzacz nie pokazuje okienka drugi raz). Izolacja A/B: osiągnięcie przyznane A nie
// jest osiągnięciem B. Moduł 1 rozpoznajemy po slugu (D-062) - jak gamification.e2e-spec: kurs istniejący albo tworzony tutaj, wersja
// testowa sprzątana na końcu. Serwer nasłuchujący (listen(0)) - CLAUDE.md, reguła 9. Testy idą po kolei i korzystają ze stanu
// poprzednich (osiągnięcie A, przypisanie B) - jak gamification.e2e-spec.
describe('Odznaka za easter egg przy odkryciu (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainA = 'org-a.easter-badge-e2e-test.test';
  const domainB = 'org-b.easter-badge-e2e-test.test';
  const emailA = `jajko-a-${suffix}@${domainA}`;
  const emailB = `jajko-b-${suffix}@${domainB}`;

  let orgAId: string;
  let userAId: string;
  let orgBId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let courseId: string;
  let createdHere = false;
  let versionId: string | undefined;

  let ipCounter = 0;
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const explore = (token: string, visited: string[]) =>
    request(app.getHttpServer())
      .post(`/courses/${courseId}/blocks/pulpit/explore`)
      .set('Authorization', `Bearer ${token}`)
      .set('CF-Connecting-IP', nextIp())
      // Język gracza z nagłówka (wersja testowa nie ma `locales`) - nazwa i grafika odznaki po polsku.
      .set('Accept-Language', 'pl')
      .send({ visited, noted: [] });
  const badgeCount = (organizationId: string, userId: string) =>
    tenantPrisma.runInOrgContext(organizationId, (tx) => tx.userBadge.count({ where: { organizationId, userId, badge: { code: 'curious-detective' } } }));
  const assign = (organizationId: string, userId: string) =>
    tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.courseAssignment.create({ data: { organizationId, userId, courseId, courseVersionId: versionId, status: 'IN_PROGRESS', currentBlockIndex: 0 } }),
    );

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

    const existing = await prisma.course.findUnique({ where: { slug: 'wyludzone-haslo' } });
    if (existing) {
      courseId = existing.id;
    } else {
      courseId = (
        await prisma.course.create({
          data: { title: 'Wyłudzone hasło', slug: 'wyludzone-haslo', category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 12, contentBlocks: [] },
        })
      ).id;
      createdHere = true;
    }
    const lastVersion = await prisma.courseVersion.findFirst({ where: { courseId }, orderBy: { version: 'desc' } });
    // Pulpit jak w module 1: zwykły przedmiot i ikona gry z okienkami i wyróżnieniem `ciekawski-detektyw` (D-100).
    const blocks = [
      {
        id: 'pulpit',
        type: 'SCENE_HOTSPOTS',
        hotspots: [
          { id: 'poczta', label: 'Poczta', x: 1, y: 1, width: 10, height: 10, content: 'Poczta.' },
          {
            id: 'gra',
            label: 'Gra',
            x: 20,
            y: 1,
            width: 10,
            height: 10,
            content: 'Ikona gry.',
            media: {
              kind: 'popups',
              items: [{ title: 'Wirusy!', body: 'Komputer chory.', button: 'Wylecz' }],
              outro: 'Pirackie gry to droga wirusów do firm.',
              badge: { id: 'ciekawski-detektyw', label: 'Ciekawski detektyw' },
            },
          },
        ],
      },
    ];
    versionId = (
      await prisma.courseVersion.create({
        data: { courseId, version: (lastVersion?.version ?? 0) + 1, schemaVersion: 5, contentHash: `jajko-e2e-${suffix}`, contentBlocks: blocks, blockCount: blocks.length },
      })
    ).id;
    await assign(orgAId, userAId);
  });

  afterAll(async () => {
    delete process.env.TRUST_PROXY;
    // Najpierw organizacje (kasują przypisania i odznaki kaskadowo - FORCE RLS), potem wersja testowa i kurs (RESTRICT przy przypisaniach).
    await prisma.user.deleteMany({ where: { email: { endsWith: 'easter-badge-e2e-test.test' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'easter-badge-e2e-test.test' } } });
    if (versionId) await prisma.courseVersion.deleteMany({ where: { id: versionId } });
    if (createdHere) await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  it('zwykły przedmiot - bez osiągnięcia; pusta lista w odpowiedzi', async () => {
    const body = (await explore(tokenA, ['poczta']).expect(200)).body;
    expect(body.unlockedBadges).toEqual([]);
    expect(await badgeCount(orgAId, userAId)).toBe(0);
  });

  it('odkrycie easter egga: osiągnięcie od razu, w odpowiedzi nazwa i grafika w języku gracza; blok dalej nieukończony', async () => {
    const body = (await explore(tokenA, ['gra']).expect(200)).body;
    expect(body.unlockedBadges).toEqual([{ code: 'curious-detective', title: expect.any(String), icon: expect.stringMatching(/^pl\/osiagniecie-ciekawski-detektyw/), rank: expect.anything() }]);
    expect(body.visited).toEqual(['poczta', 'gra']);
    expect(await badgeCount(orgAId, userAId)).toBe(1);
  });

  it('powtórny zapis i ponowne przejście (nowe przypisanie): osiągnięcie już zdobyte - pusta lista, bez duplikatu', async () => {
    expect((await explore(tokenA, ['gra']).expect(200)).body.unlockedBadges).toEqual([]);
    // „Zagraj jeszcze raz”: poprzednie przypisanie w archiwum (D-069), nowe od początku.
    await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.updateMany({ where: { organizationId: orgAId, userId: userAId, courseId, archivedAt: null }, data: { archivedAt: new Date() } }));
    await assign(orgAId, userAId);
    expect((await explore(tokenA, ['gra']).expect(200)).body.unlockedBadges).toEqual([]);
    expect(await badgeCount(orgAId, userAId)).toBe(1);
  });

  it('izolacja A/B: osiągnięcie A nie jest osiągnięciem B - B bez przypisania 404, z własnym dostaje własne', async () => {
    await explore(tokenB, ['gra']).expect(404);
    expect(await badgeCount(orgBId, userBId)).toBe(0);
    await assign(orgBId, userBId);
    expect((await explore(tokenB, ['gra']).expect(200)).body.unlockedBadges).toEqual([expect.objectContaining({ code: 'curious-detective' })]);
    expect(await badgeCount(orgBId, userBId)).toBe(1);
    expect(await badgeCount(orgAId, userAId)).toBe(1);
    // RLS: w kontekście organizacji B odznaki użytkownika A są niewidoczne.
    expect(await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.userBadge.count({ where: { userId: userAId } }))).toBe(0);
  });

  it('równoległe odkrycia (dwie karty): osiągnięcie przyznane dokładnie raz - tylko jedna odpowiedź je zwraca', async () => {
    await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.userBadge.deleteMany({ where: { organizationId: orgBId, userId: userBId } }));
    const results = await Promise.allSettled([explore(tokenB, ['gra']), explore(tokenB, ['gra']), explore(tokenB, ['poczta', 'gra'])]);
    const bodies = results.map((r) => (r.status === 'fulfilled' && r.value.status === 200 ? r.value.body : null));
    expect(bodies.every((b) => b !== null)).toBe(true);
    expect(bodies.filter((b) => b.unlockedBadges.length === 1)).toHaveLength(1);
    expect(await badgeCount(orgBId, userBId)).toBe(1);
  });
});
