import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { Role } from '@cyberszkolo/shared';
import { AppModule } from '../src/app.module';
import { AuthenticatedUser } from '../src/auth/interfaces/jwt-payload.interface';
import { EmailService } from '../src/email/email.service';
import { PhishingResultsService } from '../src/phishing/results/phishing-results.service';
import { sha256Hex } from '../src/phishing/token-hash';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const HOUR = 3_600_000;
const JUSTIFICATION = 'Weryfikacja skuteczności szkoleń zgłaszania zagrożeń w organizacji.';

interface Org {
  organizationId: string;
  adminId: string;
  adminToken: string;
  users: Record<string, { id: string; token: string; recipientToken: string }>;
  campaignId: string;
}

// Agregaty wyników są odświeżane nie częściej niż raz na godzinę (ResultsSnapshotCache); widok osobowy bez opóźnienia.
// Ten spec WŁĄCZA cache (w testach domyślnie wyłączony) i sprawdza opóźnienie, wygasanie, izolację i świeżą autoryzację.
describe('Wyniki symulacji: migawka agregatów odświeżana co godzinę (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let results: PhishingResultsService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-results-cache-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    process.env.RESULTS_CACHE_TTL_SECONDS = '3600';
    process.env.REDIS_KEY_PREFIX = `cache-e2e-${suffix}`;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    results = app.get(PhishingResultsService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    orgA = await newOrg('a', ['a1', 'a2', 'a3', 'a4']);
    orgB = await newOrg('b', ['b1', 'b2', 'b3', 'b4']);
  }, 90_000);

  afterAll(async () => {
    delete process.env.RESULTS_CACHE_TTL_SECONDS;
    delete process.env.REDIS_KEY_PREFIX;
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  });

  async function newOrg(label: string, members: string[]): Promise<Org> {
    const { body } = await registerVerified(app, tenantPrisma, { email: email(label), password: DEFAULT_TEST_PASSWORD });
    const admin = await tenantPrisma.runAuthLookup({ email: email(label) });
    const organizationId = admin!.organizationId;
    const department = await tenantPrisma.runInOrgContext(organizationId, (tx) => tx.department.create({ data: { organizationId, name: 'Ops' } }));
    const campaign = await tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId,
          name: `Kampania ${label}`,
          status: 'COMPLETED',
          audienceType: 'ALL',
          templateName: 'Kurier',
          subject: 'Twoja paczka czeka',
          bodyHtml: '<p><a href="{{trackingLink}}">x</a></p>',
          lessonHtml: '<p>l</p>',
          senderName: 'Kurier',
          senderLocalPart: 'kurier',
          windowStart: new Date(Date.now() - 5 * HOUR),
          windowEnd: new Date(Date.now() + 5 * HOUR),
          createdByEmail: email(label),
        },
      }),
    );
    const users: Org['users'] = {};
    for (const member of members) {
      const user = await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
        tx.user.create({
          data: {
            organizationId,
            email: email(`${label}-${member}`),
            passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4),
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            departmentId: department.id,
          },
        }),
      );
      const recipientToken = randomBytes(32).toString('base64url');
      await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.phishingCampaignRecipient.create({
          data: {
            organizationId,
            campaignId: campaign.id,
            userId: user.id,
            departmentId: department.id,
            departmentName: 'Ops',
            scheduledAt: new Date(Date.now() - 4 * HOUR),
            claimedAt: new Date(Date.now() - 4 * HOUR),
            sentAt: new Date(Date.now() - 4 * HOUR),
            tokenHash: sha256Hex(recipientToken),
          },
        }),
      );
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email(`${label}-${member}`), password: DEFAULT_TEST_PASSWORD }).expect(200);
      users[member] = { id: user.id, token: login.body.accessToken, recipientToken };
    }
    return { organizationId, adminId: admin!.id, adminToken: body.accessToken, users, campaignId: campaign.id };
  }

  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const asAdmin = (org: Org, label: string): AuthenticatedUser => ({ userId: org.adminId, organizationId: org.organizationId, role: Role.ORG_ADMIN, email: email(label) });
  const report = (org: Org, member: string) =>
    request(app.getHttpServer())
      .post('/threat-reports')
      .set('Authorization', `Bearer ${org.users[member].token}`)
      .send({ sender: 'Kurier <kurier@symulacje.example.test>', subject: 'Twoja paczka czeka', body: `https://f.example/t/${org.users[member].recipientToken}` })
      .expect(201);
  const reportedInOverview = async (org: Org) => ((await get(org.adminToken, '/phishing/results/overview').expect(200)).body.total.reported as number);

  it('agregaty NIE zmieniają się w oknie godziny (zgłoszenie nie jest widoczne w czasie rzeczywistym), a widok osobowy pokazuje je od razu', async () => {
    const first = await get(orgA.adminToken, '/phishing/results/overview').expect(200);
    expect(first.body.total).toMatchObject({ delivered: 4, reported: 0 });
    await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments`).expect(200); // rozgrzewa też migawkę kampanii

    await report(orgA, 'a1');

    // Agregaty: nadal stan sprzed zgłoszenia (przegląd, kampania i KPI dashboardu z tej samej godziny).
    expect(await reportedInOverview(orgA)).toBe(0);
    const campaign = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments`).expect(200);
    expect(campaign.body.total.reported).toBe(0);
    expect((await get(orgA.adminToken, '/dashboard/overview').expect(200)).body.phishingReportRate).toBe(0);
    expect(new Date(first.body.dataAsOf).getTime()).toBe(new Date((await get(orgA.adminToken, '/phishing/results/overview').expect(200)).body.dataAsOf).getTime());
    // Widok osobowy (audytowany) - bez opóźnienia.
    await request(app.getHttpServer()).post('/phishing/results/settings/personal-results').set('Authorization', `Bearer ${orgA.adminToken}`).send({ enabled: true, justification: JUSTIFICATION }).expect(200);
    const people = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people?filter=REPORTED`).expect(200);
    expect(people.body.map((p: { email: string }) => p.email)).toEqual([email('a-a1')]);
  });

  it('po upływie godziny od policzenia migawka jest przeliczana i pokazuje zgłoszenie (także KPI)', async () => {
    const view = await get(orgA.adminToken, '/phishing/results/overview').expect(200);
    const computedAt = new Date(view.body.dataAsOf);

    const stale = await results.overview(asAdmin(orgA, 'a'), new Date(computedAt.getTime() + HOUR - 1000));
    const fresh = await results.overview(asAdmin(orgA, 'a'), new Date(computedAt.getTime() + HOUR));

    expect(stale.total?.reported).toBe(0);
    expect(fresh.total).toMatchObject({ reported: 1, delivered: 4 });
    expect(fresh.dataAsOf.getTime()).toBe(computedAt.getTime() + HOUR);
    const kpi = await results.susceptibilityKpi(orgA.organizationId, new Date(computedAt.getTime() + HOUR + 1000));
    expect(kpi.reportRate).toBe(25);
  });

  it('izolacja A/B: migawka organizacji A nigdy nie jest serwowana organizacji B; kampania A dla admina B to 404 także przy rozgrzanym cache', async () => {
    await get(orgA.adminToken, '/phishing/results/overview').expect(200);
    await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments`).expect(200);

    const b = await get(orgB.adminToken, '/phishing/results/overview').expect(200);

    expect(b.body.total).toMatchObject({ delivered: 4, reported: 0 });
    await get(orgB.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments`).expect(404);
    await report(orgB, 'b1');
    expect(await reportedInOverview(orgB)).toBe(0); // własna migawka B też trzyma godzinę
    // Migawki się nie mieszają: A (przeliczona w poprzednim teście, ma 1 zgłoszenie) i B (jeszcze 0) mają różne wartości.
    expect(await reportedInOverview(orgA)).toBe(1);
    expect(await reportedInOverview(orgB)).toBe(0);
  });

  it('autoryzacja NIE jest cache\'owana: degradacja i dezaktywacja konta działają od razu, mimo rozgrzanej migawki', async () => {
    const manager = orgA.users.a2;
    await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: manager.id }, data: { role: 'DEPARTMENT_MANAGER' } }));
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email('a-a2'), password: DEFAULT_TEST_PASSWORD }).expect(200);
    await get(login.body.accessToken, '/phishing/results/overview').expect(200); // manager widzi swój dział z migawki
    await get(orgA.adminToken, '/phishing/results/overview').expect(200);

    await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: manager.id }, data: { role: 'EMPLOYEE' } }));
    await get(login.body.accessToken, '/phishing/results/overview').expect(403);

    await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.adminId }, data: { status: 'INVITED' } }));
    await get(orgA.adminToken, '/phishing/results/overview').expect(403);
    await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.adminId }, data: { status: 'ACTIVE' } }));
  });

  it('kierownik działu widzi swój wiersz z tej samej migawki (bez sumy organizacji)', async () => {
    const manager = orgB.users.b2;
    await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.user.update({ where: { id: manager.id }, data: { role: 'DEPARTMENT_MANAGER' } }));
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email('b-b2'), password: DEFAULT_TEST_PASSWORD }).expect(200);

    const view = await get(login.body.accessToken, '/phishing/results/overview').expect(200);

    expect(view.body.scope).toBe('DEPARTMENT');
    expect(view.body.total).toBeNull();
    expect(view.body.departments).toEqual([expect.objectContaining({ name: 'Ops', delivered: 4, reported: 0 })]);
    expect(view.body.dataAsOf).toEqual(expect.any(String));
  });
});
