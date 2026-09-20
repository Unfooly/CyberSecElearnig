import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { sha256Hex } from '../src/phishing/token-hash';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

type Role = 'EMPLOYEE' | 'DEPARTMENT_MANAGER' | 'ORG_ADMIN';

const HOUR = 3_600_000;
// BOM budowany z kodu (literał znaku w źródle bywa psuty przez edytory/narzędzia).
const BOM = String.fromCharCode(0xfeff);
const withoutBom = (text: string) => (text.startsWith(BOM) ? text.slice(1) : text);
const JUSTIFICATION = 'Weryfikacja skuteczności szkoleń zgłaszania zagrożeń w organizacji.';

interface Org {
  organizationId: string;
  adminToken: string;
  departments: Record<string, string>;
  users: Record<string, string>;
  campaignId: string;
}

type Behavior = { clicked?: boolean; reported?: 'AFTER_CLICK' | 'BEFORE_CLICK' | 'NO_CLICK' };

// Metryki zgłoszeń w wynikach symulacji (commit 2/5 modułu zgłoszeń): agregaty z progiem 3, widok osobowy z flagą i audytem,
// CSV, KPI dashboardu oraz przepływ od prawdziwego zgłoszenia (POST /threat-reports) do wyniku.
describe('Wyniki symulacji: zgłoszenia (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-results-reports-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;

  let orgA: Org;
  let orgB: Org;
  let managerSales: string;
  let managerTiny: string;
  let employeeToken: string;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    orgA = await newOrg('a');
    orgB = await newOrg('b');
    await seedOrgA();
    await seedOrgB();
    managerSales = await loginAs(orgA, 'manager-sales', 'DEPARTMENT_MANAGER', 'Sales');
    managerTiny = await loginAs(orgA, 'manager-tiny', 'DEPARTMENT_MANAGER', 'Tiny');
    employeeToken = await loginAs(orgA, 'employee-x', 'EMPLOYEE', 'Sales');
  }, 90_000);

  afterAll(async () => {
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  });

  // ---- fixtures ----------------------------------------------------------------------------------------------------

  async function newOrg(label: string): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { organizationId: admin!.organizationId, adminToken: body.accessToken, departments: {}, users: {}, campaignId: '' };
  }

  async function addUser(org: Org, label: string, role: Role, departmentName: string | null, names: { firstName?: string; lastName?: string } = {}) {
    if (departmentName && !org.departments[departmentName]) {
      org.departments[departmentName] = (await tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.department.create({ data: { organizationId: org.organizationId, name: departmentName } }))).id;
    }
    const user = await tenantPrisma.runInOrgContext(org.organizationId, async (tx) =>
      tx.user.create({
        data: {
          organizationId: org.organizationId,
          email: email(label),
          passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4),
          role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          departmentId: departmentName ? org.departments[departmentName] : null,
          ...names,
        },
      }),
    );
    org.users[label] = user.id;
    return user.id;
  }

  async function loginAs(org: Org, label: string, role: Role, departmentName: string | null): Promise<string> {
    await addUser(org, label, role, departmentName);
    return (await login(label)).body.accessToken as string;
  }

  const login = (label: string) => request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);

  /** Odbiorca dostarczony (sentAt) z zachowaniem; zgłoszenie PO kliknięciu, PRZED kliknięciem albo bez kliknięcia. Zwraca token linku. */
  async function recipient(org: Org, userLabel: string, departmentName: string | null, behavior: Behavior = {}): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const clickedAt = behavior.clicked ? new Date(now - 2 * HOUR) : null;
    const reportedAt =
      behavior.reported === 'AFTER_CLICK' ? new Date(now - HOUR) : behavior.reported === 'BEFORE_CLICK' ? new Date(now - 3 * HOUR) : behavior.reported === 'NO_CLICK' ? new Date(now - HOUR) : null;
    await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaignRecipient.create({
        data: {
          organizationId: org.organizationId,
          campaignId: org.campaignId,
          userId: org.users[userLabel],
          departmentId: departmentName ? org.departments[departmentName] : null,
          departmentName,
          scheduledAt: new Date(now - 4 * HOUR),
          claimedAt: new Date(now - 4 * HOUR),
          sentAt: new Date(now - 4 * HOUR),
          tokenHash: sha256Hex(token),
          clickedAt,
          reportedAt,
        },
      }),
    );
    return token;
  }

  async function createCampaign(org: Org, name: string): Promise<string> {
    const campaign = await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId: org.organizationId,
          name,
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
          createdByEmail: email('a'),
        },
      }),
    );
    return campaign.id;
  }

  // Sales (5 dostarczonych): s1 kliknął i zgłosił PO kliknięciu, s2 kliknął (bez zgłoszenia), s3 zgłosił bez kliknięcia, s4/s5 nic.
  // IT (4): i1 zgłosił bez kliknięcia. Tiny (2): t1 zgłosił, t2 kliknął i zgłosił PRZED kliknięciem. Bez działu: 0.
  // Razem: dostarczono 11, zgłosiło 5 (s1, s3, i1, t1, t2), z tego po kliknięciu 1 (s1).
  async function seedOrgA() {
    orgA.campaignId = await createCampaign(orgA, 'Kampania A');
    const sales: [string, Behavior][] = [
      ['s1', { clicked: true, reported: 'AFTER_CLICK' }],
      ['s2', { clicked: true }],
      ['s3', { reported: 'NO_CLICK' }],
      ['s4', {}],
      ['s5', {}],
    ];
    for (const [label, behavior] of sales) {
      await addUser(orgA, label, 'EMPLOYEE', 'Sales', { firstName: `Imię-${label}`, lastName: 'Sprzedaż' });
      await recipient(orgA, label, 'Sales', behavior);
    }
    const it: [string, Behavior][] = [['i1', { reported: 'NO_CLICK' }], ['i2', {}], ['i3', {}], ['i4', {}]];
    for (const [label, behavior] of it) {
      await addUser(orgA, label, 'EMPLOYEE', 'IT');
      await recipient(orgA, label, 'IT', behavior);
    }
    await addUser(orgA, 't1', 'EMPLOYEE', 'Tiny');
    await recipient(orgA, 't1', 'Tiny', { reported: 'NO_CLICK' });
    await addUser(orgA, 't2', 'EMPLOYEE', 'Tiny');
    await recipient(orgA, 't2', 'Tiny', { clicked: true, reported: 'BEFORE_CLICK' });
  }

  // Organizacja B: 4 dostarczone, 0 zgłoszeń (izolacja: zgłoszenia A nie mogą się tu pojawić).
  async function seedOrgB() {
    orgB.campaignId = await createCampaign(orgB, 'Kampania B');
    for (const label of ['b1', 'b2', 'b3', 'b4']) {
      await addUser(orgB, label, 'EMPLOYEE', 'Ops');
      await recipient(orgB, label, 'Ops');
    }
  }

  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: unknown) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body as object);
  const enablePersonal = (org: Org) => post(org.adminToken, '/phishing/results/settings/personal-results', { enabled: true, justification: JUSTIFICATION });

  // ---- agregaty ----------------------------------------------------------------------------------------------------

  describe('agregaty per dział (próg 3, łączenie małych grup)', () => {
    it('ORG_ADMIN: cała organizacja i działy mają "zgłosiło", "w tym po kliknięciu" i procent zgłaszalności', async () => {
      const response = await get(orgA.adminToken, '/phishing/results/overview').expect(200);

      expect(response.body.total).toMatchObject({ delivered: 11, clicked: 3, reported: 5, reportedAfterClick: 1, reportRate: 45.5 });
      const sales = response.body.departments.find((row: { name: string }) => row.name === 'Sales');
      expect(sales).toMatchObject({ delivered: 5, clicked: 2, reported: 2, reportedAfterClick: 1, reportRate: 40 });
    });

    it('dział 2-osobowy (Tiny) NIE ujawnia własnych zgłoszeń: jest w wierszu zbiorczym ze sumą >= 3 osób', async () => {
      const response = await get(orgA.adminToken, '/phishing/results/campaigns/' + orgA.campaignId + '/departments').expect(200);

      expect(response.body.departments.find((row: { name: string }) => row.name === 'Tiny')).toBeUndefined();
      const other = response.body.departments.find((row: { kind: string }) => row.kind === 'OTHER');
      // Tiny (2) + najmniejszy widoczny dział (IT: 4) = 6 osób; zgłoszeń 1 (i1) + 2 (t1, t2) = 3.
      expect(other).toMatchObject({ delivered: 6, reported: 3 });
      const published = response.body.departments.filter((row: { insufficientData: boolean }) => !row.insufficientData);
      expect(published.reduce((sum: number, row: { reported: number }) => sum + row.reported, 0)).toBe(response.body.total.reported);
    });

    it('kierownik działu: tylko własny dział; dział poniżej progu = wszystkie metryki zgłoszeń ukryte', async () => {
      const sales = await get(managerSales, '/phishing/results/overview').expect(200);
      const tiny = await get(managerTiny, '/phishing/results/overview').expect(200);

      expect(sales.body.scope).toBe('DEPARTMENT');
      expect(sales.body.total).toBeNull();
      expect(sales.body.departments).toEqual([expect.objectContaining({ name: 'Sales', delivered: 5, reported: 2, reportedAfterClick: 1 })]);
      expect(tiny.body.departments).toEqual([expect.objectContaining({ insufficientData: true, reported: null, reportedAfterClick: null, reportRate: null })]);
      expect(JSON.stringify(sales.body)).not.toContain('"IT"'); // nic o innych działach
    });

    it('izolacja A/B: wyniki organizacji B nie zawierają zgłoszeń A i odwrotnie', async () => {
      const b = await get(orgB.adminToken, '/phishing/results/overview').expect(200);
      const a = await get(orgA.adminToken, '/phishing/results/overview').expect(200);

      expect(b.body.total).toMatchObject({ delivered: 4, reported: 0, reportedAfterClick: 0, reportRate: 0 });
      expect(a.body.total.delivered).toBe(11);
      // Kampania A jest niewidoczna dla admina B (404 jak dla nieistniejącej).
      await get(orgB.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments`).expect(404);
    });

    it('CSV agregatów ma kolumny zgłoszeń i te same progi co widok', async () => {
      const response = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/departments.csv`).expect(200);

      const lines = withoutBom(response.text).trim().split('\r\n');
      expect(lines[0]).toBe('Dział,Dostarczono,Kliknęło,Wysłało formularz,Zgłosiło,W tym zgłosiło po kliknięciu,% kliknęło,% wysłało formularz,% zgłosiło,Uwagi');
      expect(lines.find((line) => line.startsWith('Sales,'))).toBe('Sales,5,2,0,2,1,40,0,40,');
      expect(response.text).not.toContain('Tiny');
    });
  });

  // ---- KPI ---------------------------------------------------------------------------------------------------------

  describe('KPI dashboardu: zgłaszalność', () => {
    it('phishingReportRate to % zgłoszonych wśród dostarczonych (cała organizacja, 90 dni), per organizacja', async () => {
      const a = await get(orgA.adminToken, '/dashboard/overview').expect(200);
      const b = await get(orgB.adminToken, '/dashboard/overview').expect(200);

      expect(a.body.phishingReportRate).toBe(45.5);
      expect(b.body.phishingReportRate).toBe(0);
    });

    it('bez kampanii albo poniżej progu KPI to null (nie zmyślone 0)', async () => {
      const empty = await newOrg('c');
      const overview = await get(empty.adminToken, '/dashboard/overview').expect(200);

      expect(overview.body.phishingReportRate).toBeNull();
    });
  });

  // ---- wyniki osobowe ----------------------------------------------------------------------------------------------

  describe('wyniki osobowe (flaga, audyt, role)', () => {
    it('bez włączonej flagi: 403 PERSONAL_RESULTS_DISABLED, także dla filtru REPORTED (zgłoszenia to wynik osobowy)', async () => {
      const response = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people?filter=REPORTED`).expect(403);

      expect(response.body.code).toBe('PERSONAL_RESULTS_DISABLED');
    });

    it('po włączeniu: reportedAt i reportedAfterClick per osoba, filtr REPORTED, wpis audytu z zakresem', async () => {
      await enablePersonal(orgA).expect(200);

      const all = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people`).expect(200);
      const reported = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people?filter=REPORTED`).expect(200);

      const byEmail = new Map<string, { reportedAt: string | null; reportedAfterClick: boolean }>(all.body.map((p: { email: string; reportedAt: string | null; reportedAfterClick: boolean }) => [p.email, p]));
      expect(byEmail.get(email('s1'))).toMatchObject({ reportedAfterClick: true });
      expect(byEmail.get(email('s1'))?.reportedAt).toEqual(expect.any(String));
      expect(byEmail.get(email('t2'))).toMatchObject({ reportedAfterClick: false }); // zgłosił PRZED kliknięciem
      expect(byEmail.get(email('s4'))).toMatchObject({ reportedAt: null, reportedAfterClick: false });
      expect(reported.body.map((p: { email: string }) => p.email).sort()).toEqual([email('i1'), email('s1'), email('s3'), email('t1'), email('t2')].sort());
      const audit = await get(orgA.adminToken, '/phishing/results/settings/audit').expect(200);
      expect(audit.body[0]).toMatchObject({ action: 'VIEWED', filter: 'REPORTED', rowCount: 5 });
    });

    it('CSV osobowy: kolumny zgłoszenia i eksport zapisany w audycie (EXPORTED)', async () => {
      await enablePersonal(orgA); // idempotentnie: 409, gdy flaga jest już włączona (nie sprawdzamy statusu)

      const response = await get(orgA.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people.csv?filter=REPORTED`).expect(200);

      const lines = withoutBom(response.text).trim().split('\r\n');
      expect(lines[0]).toContain('Zgłoszenie,Zgłoszenie po kliknięciu');
      expect(lines.find((line) => line.includes(email('s1')))).toContain(',tak');
      const audit = await get(orgA.adminToken, '/phishing/results/settings/audit').expect(200);
      expect(audit.body[0]).toMatchObject({ action: 'EXPORTED', filter: 'REPORTED' });
    });

    it('kierownik i pracownik NIE dostają wyników osobowych (403), także ze zgłoszeniami', async () => {
      await get(managerSales, `/phishing/results/campaigns/${orgA.campaignId}/people?filter=REPORTED`).expect(403);
      await get(employeeToken, `/phishing/results/campaigns/${orgA.campaignId}/people`).expect(403);
      await get(employeeToken, '/phishing/results/overview').expect(403);
    });

    it('izolacja A/B: admin B z włączoną flagą nie odczyta osób ani zgłoszeń kampanii A (404)', async () => {
      await enablePersonal(orgB).expect(200);

      await get(orgB.adminToken, `/phishing/results/campaigns/${orgA.campaignId}/people?filter=REPORTED`).expect(404);
      const own = await get(orgB.adminToken, `/phishing/results/campaigns/${orgB.campaignId}/people?filter=REPORTED`).expect(200);
      expect(own.body).toEqual([]);
    });
  });

  // ---- od zgłoszenia do wyniku -------------------------------------------------------------------------------------

  describe('przepływ: prawdziwe zgłoszenie pracownika zmienia wynik', () => {
    it('zgłoszenie własnego linku przez POST /threat-reports podnosi "zgłosiło" (i "po kliknięciu", jeśli wcześniej kliknął) w agregatach', async () => {
      // Nowy pracownik działu Sales: dostarczona wiadomość, kliknął, a potem zgłasza ją, wklejając własny link.
      await addUser(orgA, 'flow-user', 'EMPLOYEE', 'Sales');
      const token = await recipient(orgA, 'flow-user', 'Sales', { clicked: true });
      const salesRow = async () =>
        ((await get(orgA.adminToken, '/phishing/results/overview').expect(200)).body.departments as { name: string; delivered: number; reported: number; reportedAfterClick: number }[]).find((row) => row.name === 'Sales');
      const before = await salesRow();
      const flow = await login('flow-user');

      const report = await post(flow.body.accessToken, '/threat-reports', {
        sender: 'Kurier <kurier@symulacje.example.test>',
        subject: 'Twoja paczka czeka',
        body: `Podejrzany link https://firma.example/t/${token}`,
      }).expect(201);

      expect(report.body.isSimulation).toBe(true);
      const after = await salesRow();
      expect(after).toMatchObject({ delivered: before!.delivered, reported: before!.reported + 1, reportedAfterClick: before!.reportedAfterClick + 1 });
    });
  });
});
