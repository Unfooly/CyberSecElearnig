import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PhishingSendQueue } from '../src/phishing/campaigns/phishing-send-queue';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

// Regresja: tworzenie kampanii bierze blokadę doradczą Postgresa WEWNĄTRZ transakcji, więc N równoległych żądań trzymało N
// połączeń z puli, czekając na blokadę. Przy małej puli (runner CI: 2 x 2 rdzenie + 1 = 5; tu celowo 2) reszta żądań nie
// dostawała połączenia w `maxWait` (2 s) => Prisma P2028 "Unable to start a transaction in the given time" => 500.
// Deterministycznie: blokadę trzyma z ZEWNĄTRZ osobny klient (2,8 s > maxWait), a w tym czasie 14 żądań próbuje utworzyć kampanię.
describe('Tworzenie kampanii przy małej puli połączeń (e2e)', () => {
  const suffix = Date.now();
  const domainSuffix = 'phishing-pool-e2e.test';
  const originalUrl = process.env.DATABASE_URL_APP;
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let owner: PrismaClient;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    // Pula 2: jedno połączenie zajmie transakcja czekająca na blokadę, drugie zostaje dla reszty zapytań.
    process.env.DATABASE_URL_APP = `${originalUrl}${originalUrl?.includes('?') ? '&' : '?'}connection_limit=2`;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PhishingSendQueue)
      .useValue({ enqueue: async () => undefined, remove: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    // Osobny klient (rola właściciel): trzyma blokadę poza pulą testowanej aplikacji.
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  }, 60_000);

  afterAll(async () => {
    process.env.DATABASE_URL_APP = originalUrl;
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await owner?.$disconnect();
    await prisma?.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app?.close();
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  });

  it('14 równoległych żądań, blokada zajęta na 2,8 s: zero błędów 5xx, dokładnie 10 kampanii i 4 x 409 (limit aktywnych)', async () => {
    const email = `pool-${suffix}@pool.${domainSuffix}`;
    const { body } = await registerVerified(app, tenantPrisma, { email, password: DEFAULT_TEST_PASSWORD });
    const admin = await tenantPrisma.runAuthLookup({ email });
    const organizationId = admin!.organizationId;
    await prisma.organization.update({ where: { id: organizationId }, data: { seatsLimit: 1000 } });
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    const templates = await request(app.getHttpServer()).get('/phishing/templates').set(auth).expect(200);
    const templateId = templates.body.find((t: { key: string }) => t.key === 'kurier').id;
    const window = { windowStart: new Date(Date.now() + 60_000).toISOString(), windowEnd: new Date(Date.now() + 3 * 3_600_000).toISOString() };

    // Zewnętrzny klient zajmuje TĘ SAMĄ blokadę doradczą, na którą czeka tworzenie kampanii.
    const holder = owner.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phishing-campaign:${organizationId}`}))`;
        await new Promise((resolve) => setTimeout(resolve, 2800));
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300)); // blokada na pewno zajęta

    const responses = await Promise.allSettled(
      Array.from({ length: 14 }, (_v, i) =>
        request(app.getHttpServer())
          .post('/phishing/campaigns')
          .set(auth)
          .send({ name: `Pula ${i}`, templateId, audience: { type: 'USERS', userIds: [admin!.id] }, ...window, acknowledged: true }),
      ),
    );
    await holder;

    const settled = responses.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(responses.every((r) => r.status === 'fulfilled')).toBe(true); // żaden nie zerwał połączenia
    expect(settled.filter((r) => (r?.status ?? 0) >= 500)).toEqual([]);
    expect(settled.filter((r) => r?.status === 201)).toHaveLength(10);
    expect(settled.filter((r) => r?.status === 409).every((r) => r?.body.code === 'TOO_MANY_ACTIVE_CAMPAIGNS')).toBe(true);
    expect(settled.filter((r) => r?.status === 409)).toHaveLength(4);
  }, 60_000);
});
