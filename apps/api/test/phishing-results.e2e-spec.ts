import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const DAY = 24 * 3_600_000;
const BOM = String.fromCharCode(0xfeff);
const JUSTIFICATION = 'Weryfikacja skuteczności szkoleń w dziale sprzedaży po incydencie.';

type Role = 'EMPLOYEE' | 'DEPARTMENT_MANAGER' | 'ORG_ADMIN';
interface Org {
  organizationId: string;
  adminToken: string;
  departments: Record<string, string>;
  users: Record<string, string>;
  campaignId: string;
}

describe('Wyniki symulacji: agregaty, wyniki osobowe, audyt (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-results-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;

  let orgA: Org;
  let orgB: Org;
  let managerSales: string;
  let managerTiny: string;
  let managerNoDept: string;
  let employeeToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    orgA = await newOrg('a');
    orgB = await newOrg('b');
    await seedCampaignA();
    await seedCampaignB();
    managerSales = await loginAs(orgA, 'manager-sales', 'DEPARTMENT_MANAGER', 'Sales');
    managerTiny = await loginAs(orgA, 'manager-tiny', 'DEPARTMENT_MANAGER', 'Tiny');
    managerNoDept = await loginAs(orgA, 'manager-none', 'DEPARTMENT_MANAGER', null);
    employeeToken = await loginAs(orgA, 'employee-x', 'EMPLOYEE', 'Sales');
  }, 90_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
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
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);
    return response.body.accessToken as string;
  }

  /** Odbiorca kampanii ze stanem wysyłki i zachowaniem. */
  async function recipient(org: Org, campaignId: string, userLabel: string, departmentName: string | null, state: { sent?: boolean; failure?: string; clicked?: boolean; submitted?: boolean }) {
    const claimed = state.sent || state.clicked || state.failure === 'TIMEOUT_UNKNOWN';
    await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaignRecipient.create({
        data: {
          organizationId: org.organizationId,
          campaignId,
          userId: org.users[userLabel],
          departmentId: departmentName ? org.departments[departmentName] : null,
          departmentName,
          scheduledAt: new Date(Date.now() - 3_600_000),
          claimedAt: claimed ? new Date() : null,
          tokenHash: claimed ? `hash-${userLabel}-${suffix}-${campaignId}` : null,
          sentAt: state.sent ? new Date() : null,
          failedAt: state.failure ? new Date() : null,
          failureCode: state.failure ?? null,
          clickedAt: state.clicked ? new Date() : null,
          submittedAt: state.submitted ? new Date() : null,
        },
      }),
    );
  }

  async function createCampaign(org: Org, name: string, createdAt = new Date()): Promise<string> {
    const campaign = await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId: org.organizationId,
          name,
          status: 'COMPLETED',
          audienceType: 'ALL',
          templateName: 'Kurier',
          subject: 'Paczka',
          bodyHtml: '<p><a href="{{trackingLink}}">x</a></p>',
          lessonHtml: '<p>l</p>',
          senderName: 'Kurier',
          senderLocalPart: 'kurier',
          windowStart: new Date(createdAt.getTime() - DAY),
          windowEnd: new Date(createdAt.getTime() + DAY),
          createdByEmail: email('a'),
          createdAt,
        },
      }),
    );
    return campaign.id;
  }

  // Sales: 5 dostarczonych (2 kliknęło, 1 wysłało formularz) + 1 niepewny + 1 nieudany; IT: 4 (1 klik); Tiny: 2 (oba kliknęły, 1 formularz);
  // bez działu: 1 (klik). Razem dostarczonych 12, kliknęło 6, formularz 2.
  async function seedCampaignA() {
    orgA.campaignId = await createCampaign(orgA, 'Kampania A1');
    const id = orgA.campaignId;
    const sales = [
      ['s1', { clicked: true, submitted: true }],
      ['s2', { clicked: true }],
      ['s3', {}],
      ['s4', {}],
      ['s5', {}],
    ] as const;
    for (const [label, behavior] of sales) {
      await addUser(orgA, label, 'EMPLOYEE', 'Sales', { firstName: `Imię-${label}`, lastName: 'Sprzedaż' });
      await recipient(orgA, id, label, 'Sales', { sent: true, ...behavior });
    }
    await addUser(orgA, 's-uncertain', 'EMPLOYEE', 'Sales', { firstName: 'Niepewny', lastName: 'Sprzedaż' });
    await recipient(orgA, id, 's-uncertain', 'Sales', { failure: 'TIMEOUT_UNKNOWN' });
    await addUser(orgA, 's-failed', 'EMPLOYEE', 'Sales', { firstName: '=HYPERLINK("http://evil.example","x")', lastName: 'Nieudany' });
    await recipient(orgA, id, 's-failed', 'Sales', { failure: 'HTTP_422' });
    for (const [label, clicked] of [['i1', true], ['i2', false], ['i3', false], ['i4', false]] as const) {
      await addUser(orgA, label, 'EMPLOYEE', 'IT', { firstName: `Imię-${label}`, lastName: 'IT' });
      await recipient(orgA, id, label, 'IT', { sent: true, clicked });
    }
    for (const [label, submitted] of [['t1', true], ['t2', false]] as const) {
      await addUser(orgA, label, 'EMPLOYEE', 'Tiny', { firstName: `Imię-${label}`, lastName: 'Mały' });
      await recipient(orgA, id, label, 'Tiny', { sent: true, clicked: true, submitted });
    }
    await addUser(orgA, 'n1', 'EMPLOYEE', null, { firstName: 'Bez', lastName: 'Działu' });
    await recipient(orgA, id, 'n1', null, { sent: true, clicked: true });
  }

  async function seedCampaignB() {
    orgB.campaignId = await createCampaign(orgB, 'Kampania B1');
    for (const label of ['b1', 'b2', 'b3', 'b4']) {
      await addUser(orgB, label, 'EMPLOYEE', 'Marketing', { firstName: `Imię-${label}`, lastName: 'Marketing' });
      await recipient(orgB, orgB.campaignId, label, 'Marketing', { sent: true, clicked: label === 'b1' });
    }
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set(auth(token));
  const post = (token: string, path: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set(auth(token)).send(body as object);
  const results = (orgId: string, suffixPath: string) => `/phishing/results/campaigns/${orgId}${suffixPath}`;

  const auditRows = (org: Org) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingResultVisibilityAudit.findMany({ where: { organizationId: org.organizationId }, orderBy: { createdAt: 'asc' } }));
  const setFlag = (org: Org, enabled: boolean) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingResultSettings.upsert({
        where: { organizationId: org.organizationId },
        create: { organizationId: org.organizationId, personalResultsEnabled: enabled, justification: enabled ? JUSTIFICATION : null, changedByEmail: 'test@test.pl' },
        update: { personalResultsEnabled: enabled, justification: enabled ? JUSTIFICATION : null },
      }),
    );
  const clearAudit = async () => {
    // Dziennik jest append-only dla roli aplikacji; sprzątamy przez usunięcie organizacji NIE - testy liczą różnice.
  };

  // ---- agregaty ----------------------------------------------------------------------------------------------------

  describe('agregaty per dział z progiem minimalnej liczebności', () => {
    it('ORG_ADMIN: cała organizacja + działy >= 3 osoby; dział 2-osobowy NIE ma własnego wiersza (łączony w "Pozostałe")', async () => {
      const response = await get(orgA.adminToken, results(orgA.campaignId, '/departments')).expect(200);

      expect(response.body).toMatchObject({ scope: 'ORGANIZATION', minGroupSize: 3, campaign: { name: 'Kampania A1' } });
      expect(response.body.total).toMatchObject({ delivered: 12, clicked: 6, submitted: 2, clickRate: 50, submitRate: 16.7, insufficientData: false });
      const names = response.body.departments.map((row: { name: string }) => row.name);
      expect(names).toEqual(['Sales', 'IT', expect.stringContaining('Pozostałe działy')]);
      expect(names.join()).not.toMatch(/Tiny|Bez działu/);
      const [sales, it, other] = response.body.departments;
      expect(sales).toMatchObject({ delivered: 5, clicked: 2, submitted: 1, clickRate: 40 });
      expect(it).toMatchObject({ delivered: 4, clicked: 1, clickRate: 25 });
      expect(other).toMatchObject({ kind: 'OTHER', delivered: 3, clicked: 3 }); // Tiny (2) + bez działu (1) = 3 >= próg
      // Suma opublikowanych wierszy = suma organizacji: żadnej małej grupy nie da się odjąć.
      expect(response.body.departments.reduce((sum: number, row: { delivered: number }) => sum + row.delivered, 0)).toBe(12);
    });

    it('odpowiedź agregatów NIE zawiera osób: brak e-maili, identyfikatorów użytkowników, imion i nazwisk', async () => {
      const response = await get(orgA.adminToken, results(orgA.campaignId, '/departments')).expect(200);
      const text = JSON.stringify(response.body);

      expect(text).not.toMatch(/@|userId|Imię-|Sprzedaż|Nieudany|HYPERLINK|s-uncertain/);
      for (const id of Object.values(orgA.users)) expect(text).not.toContain(id);
    });

    it('CSV agregatów: BOM, nagłówek, wiersze z progiem, brak osób i małych działów', async () => {
      const response = await get(orgA.adminToken, results(orgA.campaignId, '/departments.csv')).expect(200);

      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['cache-control']).toBe('no-store');
      const text = response.text;
      expect(text.startsWith(BOM)).toBe(true);
      expect(text).toContain('Dział,Dostarczono,Kliknęło,Wysłało formularz,Zgłosiło,W tym zgłosiło po kliknięciu,% kliknęło,% wysłało formularz,% zgłosiło,Uwagi');
      expect(text).toContain('Sales,5,2,1,0,0,40,20,0'); // dostarczono, kliknęło, formularz, zgłosiło, po kliknięciu, %kl, %form, %zgł
      expect(text).not.toMatch(/Tiny|@|Imię-|HYPERLINK/);
    });

    it('DEPARTMENT_MANAGER: WYŁĄCZNIE własny dział (jeden wiersz), bez sumy organizacji, bez innych działów i bez danych osobowych', async () => {
      const response = await get(managerSales, results(orgA.campaignId, '/departments')).expect(200);

      expect(response.body).toMatchObject({ scope: 'DEPARTMENT', total: null });
      expect(response.body.departments).toHaveLength(1);
      expect(response.body.departments[0]).toMatchObject({ name: 'Sales', delivered: 5, clicked: 2, insufficientData: false });
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/IT|Tiny|Pozostałe|Bez działu|@|Imię-|Sprzedaż|userId/);
    });

    it('DEPARTMENT_MANAGER małego działu (2 osoby): "za mało danych", żadnych liczb; CSV też', async () => {
      const response = await get(managerTiny, results(orgA.campaignId, '/departments')).expect(200);
      const csv = await get(managerTiny, results(orgA.campaignId, '/departments.csv')).expect(200);

      expect(response.body.departments).toEqual([expect.objectContaining({ name: 'Tiny', insufficientData: true, delivered: null, clicked: null, submitted: null, clickRate: null, submitRate: null })]);
      expect(csv.text).toContain('Za mało danych');
      expect(csv.text).not.toMatch(/Tiny,2|,100|,50/);
    });

    it('DEPARTMENT_MANAGER bez działu: pusta lista (nie widzi organizacji); dział brany z bazy, nie z tokenu', async () => {
      const overview = await get(managerNoDept, '/phishing/results/overview').expect(200);
      await get(managerNoDept, results(orgA.campaignId, '/departments')).expect(404); // nie uczestniczył: kampania "nie istnieje"

      expect(overview.body).toMatchObject({ scope: 'DEPARTMENT', total: null, campaignsCount: null, departments: [] });
      // Zmiana działu kierownika w bazie działa od razu (ten sam token): dział czytany na każde żądanie.
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users['manager-none'] }, data: { departmentId: orgA.departments.IT } }));
      const moved = await get(managerNoDept, results(orgA.campaignId, '/departments')).expect(200);
      expect(moved.body.departments).toEqual([expect.objectContaining({ name: 'IT', delivered: 4 })]);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users['manager-none'] }, data: { departmentId: null } }));
    });

    it('przegląd (90 dni): ORG_ADMIN widzi organizację, manager tylko swój dział; kampanie starsze niż 90 dni nie wchodzą', async () => {
      const old = await createCampaign(orgA, 'Stara kampania', new Date(Date.now() - 100 * DAY));
      await recipient(orgA, old, 's3', 'Sales', { sent: true, clicked: true });
      await recipient(orgA, old, 's4', 'Sales', { sent: true, clicked: true });
      await recipient(orgA, old, 's5', 'Sales', { sent: true, clicked: true });

      const admin = await get(orgA.adminToken, '/phishing/results/overview').expect(200);
      const manager = await get(managerSales, '/phishing/results/overview').expect(200);

      expect(admin.body.total).toMatchObject({ delivered: 12, clicked: 6 }); // stara kampania pominięta
      expect(admin.body.campaignsCount).toBe(1);
      expect(manager.body.departments).toEqual([expect.objectContaining({ name: 'Sales', delivered: 5, clicked: 2 })]);
      expect(manager.body.total).toBeNull();
      expect(manager.body.campaignsCount).toBeNull(); // metadane całej organizacji nie trafiają do managera
    });

    it('DEPARTMENT_MANAGER nie dowie się o kampanii, w której jego dział nie uczestniczył: 404 (także CSV), a admin ją widzi', async () => {
      const salesOnly = await createCampaign(orgA, 'Tylko sprzedaż');
      for (const label of ['s1', 's2', 's3']) await recipient(orgA, salesOnly, label, 'Sales', { sent: true });

      const admin = await get(orgA.adminToken, results(salesOnly, '/departments')).expect(200);
      const tinyJson = await get(managerTiny, results(salesOnly, '/departments'));
      const tinyCsv = await get(managerTiny, results(salesOnly, '/departments.csv'));
      const salesManager = await get(managerSales, results(salesOnly, '/departments')).expect(200);

      expect(admin.body.campaign.name).toBe('Tylko sprzedaż');
      expect([tinyJson.status, tinyCsv.status]).toEqual([404, 404]);
      expect(JSON.stringify(tinyJson.body) + tinyCsv.text).not.toContain('Tylko sprzedaż');
      expect(salesManager.body.departments[0]).toMatchObject({ name: 'Sales', delivered: 3 });
      // Sprzątanie: kolejne testy liczą KPI/przegląd na kampanii A1.
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.delete({ where: { id: salesOnly } }));
    });

    it('cała organizacja poniżej progu (2 dostarczone): wiersz "za mało danych" bez liczb, KPI null', async () => {
      const small = await newOrg('small');
      await addUser(small, 'x1', 'EMPLOYEE', 'Solo');
      await addUser(small, 'x2', 'EMPLOYEE', 'Solo');
      small.campaignId = await createCampaign(small, 'Mała');
      await recipient(small, small.campaignId, 'x1', 'Solo', { sent: true, clicked: true });
      await recipient(small, small.campaignId, 'x2', 'Solo', { sent: true });

      const view = await get(small.adminToken, results(small.campaignId, '/departments')).expect(200);
      const overview = await get(small.adminToken, '/dashboard/overview').expect(200);

      expect(view.body.total).toMatchObject({ insufficientData: true, delivered: null, clickRate: null });
      expect(view.body.departments).toEqual([expect.objectContaining({ kind: 'ALL', insufficientData: true, clicked: null })]);
      expect(overview.body).toMatchObject({ phishingClickRate: null, phishingSubmitRate: null });
    });
  });

  describe('KPI dashboardu i eksport dashboardu', () => {
    it('KPI "podatność na phishing": zagregowany % całej organizacji, bez danych osobowych', async () => {
      const response = await get(orgA.adminToken, '/dashboard/overview').expect(200);

      expect(response.body).toMatchObject({ phishingClickRate: 50, phishingSubmitRate: 16.7, phishingReportRate: 0 }); // 12 dostarczonych, 0 zgłoszeń (zgłoszenia: phishing-results-reports.e2e-spec.ts)
      expect(JSON.stringify(response.body)).not.toMatch(/@|Imię-/);
    });

    it('KPI dostępne wyłącznie dla ORG_ADMIN (manager i pracownik: 403), izolacja: KPI organizacji B liczy tylko B', async () => {
      await get(managerSales, '/dashboard/overview').expect(403);
      await get(employeeToken, '/dashboard/overview').expect(403);

      const b = await get(orgB.adminToken, '/dashboard/overview').expect(200);

      expect(b.body).toMatchObject({ phishingClickRate: 25, phishingSubmitRate: 0 }); // 1 z 4
    });

    it('eksport dashboardu NIE zawiera wyników symulacji - ani przy wyłączonej, ani przy włączonej fladze wyników osobowych', async () => {
      await setFlag(orgA, false);
      const off = await get(orgA.adminToken, '/dashboard/export?format=csv').expect(200);
      await setFlag(orgA, true);
      const on = await get(orgA.adminToken, '/dashboard/export?format=csv').expect(200);
      await setFlag(orgA, false);

      for (const csv of [off.text, on.text]) {
        expect(csv.split('\r\n')[0]).toBe('Email,Dział,Ukończone/Wszystkie obowiązkowe,Ostatnie ukończenie kursu');
        expect(csv).not.toMatch(/klik|formularz/i);
        expect(csv).not.toMatch(/HTTP_422|TIMEOUT_UNKNOWN|SENT|UNCERTAIN|FAILED|Kampania A1/); // kody i nazwa kampanii (wielkość liter: e-maile testowe zawierają "failed")
      }
      expect(on.text).toEqual(off.text);
    });
  });

  // ---- wyniki osobowe ----------------------------------------------------------------------------------------------

  describe('wyniki osobowe: guard z flagą i audyt', () => {
    it('DOMYŚLNIE wyłączone: widok osobowy i jego CSV => 403 PERSONAL_RESULTS_DISABLED, bez danych i bez wpisu audytu', async () => {
      await setFlag(orgA, false);
      const before = (await auditRows(orgA)).length;

      const view = await get(orgA.adminToken, results(orgA.campaignId, '/people'));
      const csv = await get(orgA.adminToken, results(orgA.campaignId, '/people.csv'));

      expect([view.status, view.body.code, csv.status, csv.body.code]).toEqual([403, 'PERSONAL_RESULTS_DISABLED', 403, 'PERSONAL_RESULTS_DISABLED']);
      expect(view.text + csv.text).not.toMatch(/@|Imię-|Sprzedaż/);
      expect((await auditRows(orgA)).length).toBe(before); // odmowa niczego nie zapisuje
      const settings = await get(orgA.adminToken, '/phishing/results/settings').expect(200);
      expect(settings.body.personalResultsEnabled).toBe(false);
    });

    it('organizacja bez wiersza ustawień (nigdy nie włączała): też wyłączone', async () => {
      const fresh = await newOrg('fresh');
      fresh.campaignId = await createCampaign(fresh, 'Nowa');

      const response = await get(fresh.adminToken, results(fresh.campaignId, '/people'));

      expect([response.status, response.body.code]).toEqual([403, 'PERSONAL_RESULTS_DISABLED']);
    });

    it('włączenie wymaga uzasadnienia (>= 20 znaków): brak, za krótkie, same spacje => 400; nic nie jest zmieniane ani audytowane', async () => {
      const before = (await auditRows(orgA)).length;

      for (const body of [{ enabled: true }, { enabled: true, justification: 'za krótko' }, { enabled: true, justification: ' '.repeat(40) }, { enabled: true, justification: null }]) {
        const response = await post(orgA.adminToken, '/phishing/results/settings/personal-results', body);
        expect([response.status]).toEqual([400]);
      }

      expect((await auditRows(orgA)).length).toBe(before);
      expect((await get(orgA.adminToken, '/phishing/results/settings').expect(200)).body.personalResultsEnabled).toBe(false);
    });

    it('włączenie z uzasadnieniem: ustawienie + wpis audytu ENABLED (uzasadnienie, e-mail aktora); powtórzenie => 409 bez dubla', async () => {
      const before = (await auditRows(orgA)).length;

      const enabled = await post(orgA.adminToken, '/phishing/results/settings/personal-results', { enabled: true, justification: JUSTIFICATION }).expect(200);
      const again = await post(orgA.adminToken, '/phishing/results/settings/personal-results', { enabled: true, justification: JUSTIFICATION });

      expect(enabled.body).toMatchObject({ personalResultsEnabled: true, justification: JUSTIFICATION, changedByEmail: email('a') });
      expect([again.status, again.body.code]).toEqual([409, 'PERSONAL_RESULTS_UNCHANGED']);
      const rows = await auditRows(orgA);
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ action: 'ENABLED', justification: JUSTIFICATION, actorEmail: email('a'), campaignId: null });
      expect(rows.at(-1)?.actorUserId).not.toBeNull();
    });

    it('po włączeniu: lista osobowa z imionami/e-mailami i statusami dostarczenia; KAŻDY wgląd zostawia wpis VIEWED z kampanią', async () => {
      await setFlag(orgA, true);
      const before = (await auditRows(orgA)).length;

      const response = await get(orgA.adminToken, results(orgA.campaignId, '/people')).expect(200);

      expect(response.body).toHaveLength(14); // 5+1+1 Sales, 4 IT, 2 Tiny, 1 bez działu
      const byEmail = new Map<string, Record<string, unknown>>(response.body.map((row: { email: string }) => [row.email, row]));
      expect(byEmail.get(email('s1'))).toMatchObject({ name: 'Imię-s1 Sprzedaż', departmentName: 'Sales', delivery: 'SENT', failureCode: null });
      expect((byEmail.get(email('s1')) as { clickedAt: unknown; submittedAt: unknown }).clickedAt).not.toBeNull();
      expect(byEmail.get(email('s-uncertain'))).toMatchObject({ delivery: 'UNCERTAIN', failureCode: 'TIMEOUT_UNKNOWN' });
      expect(byEmail.get(email('s-failed'))).toMatchObject({ delivery: 'FAILED', failureCode: 'HTTP_422' });
      expect(byEmail.get(email('n1'))).toMatchObject({ departmentName: null });
      const rows = await auditRows(orgA);
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ action: 'VIEWED', campaignId: orgA.campaignId, actorEmail: email('a'), filter: 'ALL', rowCount: 14 });
    });

    it('filtr PROBLEMS = odbiorcy nieudani i "niepewni"; CLICKED i SUBMITTED zawężają; zły filtr => 400', async () => {
      await setFlag(orgA, true);

      const problems = await get(orgA.adminToken, results(orgA.campaignId, '/people?filter=PROBLEMS')).expect(200);
      const clicked = await get(orgA.adminToken, results(orgA.campaignId, '/people?filter=CLICKED')).expect(200);
      const submitted = await get(orgA.adminToken, results(orgA.campaignId, '/people?filter=SUBMITTED')).expect(200);
      await get(orgA.adminToken, results(orgA.campaignId, '/people?filter=DROP')).expect(400);

      expect(problems.body.map((row: { delivery: string }) => row.delivery).sort()).toEqual(['FAILED', 'UNCERTAIN']);
      expect(clicked.body).toHaveLength(6);
      expect(submitted.body).toHaveLength(2);
    });

    it('CSV osobowy: wpis EXPORTED, BOM, ochrona przed formułami w imieniu, uwzględnia filtr', async () => {
      await setFlag(orgA, true);
      const before = (await auditRows(orgA)).length;

      const response = await get(orgA.adminToken, results(orgA.campaignId, '/people.csv?filter=PROBLEMS')).expect(200);

      expect(response.text.startsWith(BOM)).toBe(true);
      expect(response.text).toContain('Imię i nazwisko,E-mail,Dział,Dostarczenie,Kod,Wysłano,Kliknięcie,Wysłanie formularza');
      expect(response.text).toContain(`'=HYPERLINK`); // komórka z formułą dostaje apostrof
      expect(response.text).not.toMatch(/(^|,|")=HYPERLINK/m);
      expect(response.text).toContain('UNCERTAIN,TIMEOUT_UNKNOWN');
      expect(response.text).not.toContain(email('s1')); // filtr PROBLEMS
      const rows = await auditRows(orgA);
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ action: 'EXPORTED', campaignId: orgA.campaignId, filter: 'PROBLEMS', rowCount: 2 }); // zakres i liczba osób w śladzie
    });

    it('flaga jest czytana z bazy na KAŻDYM żądaniu: wyłączenie działa natychmiast na tym samym tokenie (także przez wyłączenie w bazie)', async () => {
      await setFlag(orgA, true);
      await get(orgA.adminToken, results(orgA.campaignId, '/people')).expect(200);

      await setFlag(orgA, false);

      const view = await get(orgA.adminToken, results(orgA.campaignId, '/people'));
      const csv = await get(orgA.adminToken, results(orgA.campaignId, '/people.csv'));
      expect([view.status, csv.status]).toEqual([403, 403]);
    });

    it('wyłączenie przez API: audyt DISABLED (uzasadnienie opcjonalne), potem dostęp zablokowany', async () => {
      await setFlag(orgA, true);
      const before = (await auditRows(orgA)).length;

      const disabled = await post(orgA.adminToken, '/phishing/results/settings/personal-results', { enabled: false }).expect(200);

      expect(disabled.body.personalResultsEnabled).toBe(false);
      const rows = await auditRows(orgA);
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ action: 'DISABLED', actorEmail: email('a') });
      await get(orgA.adminToken, results(orgA.campaignId, '/people')).expect(403);
    });

    it('endpoint audytu zwraca dziennik (najnowsze pierwsze) bez identyfikatorów użytkowników', async () => {
      const response = await get(orgA.adminToken, '/phishing/results/settings/audit').expect(200);

      expect(response.body.length).toBeGreaterThan(3);
      expect(response.body[0].createdAt >= response.body.at(-1).createdAt).toBe(true);
      expect(Object.keys(response.body[0]).sort()).toEqual(['action', 'actorEmail', 'campaignId', 'createdAt', 'filter', 'id', 'justification', 'rowCount']);
      expect(response.body.map((row: { action: string }) => row.action)).toEqual(expect.arrayContaining(['ENABLED', 'DISABLED', 'VIEWED', 'EXPORTED']));
    });

    it('dziennik jest append-only dla roli aplikacji: UPDATE i DELETE odrzucone przez bazę', async () => {
      const [row] = await auditRows(orgA);

      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingResultVisibilityAudit.update({ where: { id: row.id }, data: { justification: 'zmieniono' } }))).rejects.toThrow(/permission denied/i);
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingResultVisibilityAudit.deleteMany({ where: { organizationId: orgA.organizationId } }))).rejects.toThrow(/permission denied/i);
    });

    it('baza wymusza uzasadnienie: włączone ustawienie i wpis ENABLED bez uzasadnienia są odrzucone (CHECK)', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingResultSettings.update({ where: { organizationId: orgA.organizationId }, data: { personalResultsEnabled: true, justification: 'krótkie' } })),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingResultVisibilityAudit.create({ data: { organizationId: orgA.organizationId, action: 'ENABLED', justification: null, actorEmail: 'x@x.pl' } })),
      ).rejects.toThrow(/check constraint/i);
    });

    it('użytkownik usunięty: wiersz w wynikach zostaje z "(usunięty pracownik)", audyt zachowuje e-mail aktora po usunięciu jego konta', async () => {
      await setFlag(orgA, true);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: orgA.users.i4 } }));

      const response = await get(orgA.adminToken, results(orgA.campaignId, '/people')).expect(200);
      const csv = await get(orgA.adminToken, results(orgA.campaignId, '/people.csv')).expect(200);

      expect(response.body).toHaveLength(14);
      expect(response.body.filter((row: { userId: unknown }) => row.userId === null)).toHaveLength(1);
      expect(csv.text).toContain('(usunięty pracownik)');
      await setFlag(orgA, false);
      await clearAudit();
    });
  });

  // ---- role i izolacja ---------------------------------------------------------------------------------------------

  describe('uprawnienia: DEPARTMENT_MANAGER i EMPLOYEE nie dostają wyników osobowych ani ustawień', () => {
    const personalPaths = (org: Org) => [
      ['get', results(org.campaignId, '/people')],
      ['get', results(org.campaignId, '/people.csv')],
      ['get', '/phishing/results/settings'],
      ['get', '/phishing/results/settings/audit'],
      ['post', '/phishing/results/settings/personal-results'],
    ] as const;

    it('DEPARTMENT_MANAGER dostaje 403 na wyniki osobowe, CSV osobowy, ustawienia, audyt i przełącznik - także przy WŁĄCZONEJ fladze', async () => {
      await setFlag(orgA, true);
      const before = (await auditRows(orgA)).length;

      for (const [method, path] of personalPaths(orgA)) {
        const response = method === 'get' ? await get(managerSales, path) : await post(managerSales, path, { enabled: false });
        expect([method, path, response.status]).toEqual([method, path, 403]);
        expect(response.text).not.toMatch(/@|Imię-/);
      }

      expect((await auditRows(orgA)).length).toBe(before); // odmowy niczego nie audytują ani nie ujawniają
      expect((await get(orgA.adminToken, '/phishing/results/settings').expect(200)).body.personalResultsEnabled).toBe(true); // nie wyłączył
      await setFlag(orgA, false);
    });

    it('rola i status czytane z BAZY: zdegradowany albo zdezaktywowany ORG_ADMIN traci dostęp od razu (ten sam token), także do przełącznika', async () => {
      const token = await loginAs(orgA, 'admin-two', 'ORG_ADMIN', 'IT');
      await setFlag(orgA, true);
      await get(token, results(orgA.campaignId, '/people')).expect(200);
      const adminTwo = orgA.users['admin-two'];
      const setUser = (data: { role?: 'EMPLOYEE' | 'ORG_ADMIN'; status?: 'INVITED' }) => tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: adminTwo }, data }));

      await setUser({ role: 'EMPLOYEE' }); // zdegradowany, token nadal mówi ORG_ADMIN
      const blocked = [
        await get(token, results(orgA.campaignId, '/people')),
        await get(token, results(orgA.campaignId, '/people.csv')),
        await post(token, '/phishing/results/settings/personal-results', { enabled: false }),
        await get(token, results(orgA.campaignId, '/departments')),
      ];
      await setUser({ role: 'ORG_ADMIN' });
      await setUser({ status: 'INVITED' }); // zdezaktywowany
      const inactive = [await get(token, results(orgA.campaignId, '/people')), await get(token, results(orgA.campaignId, '/departments'))];

      expect(blocked.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect(inactive.map((r) => r.status)).toEqual([403, 403]);
      expect((await get(orgA.adminToken, '/phishing/results/settings').expect(200)).body.personalResultsEnabled).toBe(true); // nie wyłączył
      await setFlag(orgA, false);
    });

    it('RÓWNOLEGŁE włączenia flagi: dokładnie jedno wygrywa (200), reszta 409, jeden wpis ENABLED, zero błędów 500', async () => {
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingResultSettings.deleteMany({ where: { organizationId: orgA.organizationId } }));
      const before = (await auditRows(orgA)).filter((row) => row.action === 'ENABLED').length;

      const responses = await Promise.all(Array.from({ length: 6 }, () => post(orgA.adminToken, '/phishing/results/settings/personal-results', { enabled: true, justification: JUSTIFICATION })));

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect((await auditRows(orgA)).filter((row) => row.action === 'ENABLED').length).toBe(before + 1);
      await setFlag(orgA, false);
    });

    it('wgląd osobowy ma limit żądań (dziennik nie do zalania): po 30 wglądach na minutę 429', async () => {
      await setFlag(orgA, true);

      const statuses: number[] = [];
      for (let i = 0; i < 32; i += 1) statuses.push((await get(orgA.adminToken, results(orgA.campaignId, '/people'))).status);

      expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
      expect(statuses.slice(30)).toEqual([429, 429]);
      await setFlag(orgA, false);
    });

    it('EMPLOYEE: 403 na każdym endpoincie wyników (także agregatach); bez tokenu 401', async () => {
      const paths = [['get', '/phishing/results/overview'], ['get', results(orgA.campaignId, '/departments')], ['get', results(orgA.campaignId, '/departments.csv')], ...personalPaths(orgA)] as const;
      for (const [method, path] of paths) {
        const asEmployee = method === 'get' ? await get(employeeToken, path) : await post(employeeToken, path, { enabled: true, justification: JUSTIFICATION });
        const anonymous = method === 'get' ? await request(app.getHttpServer()).get(path) : await request(app.getHttpServer()).post(path).send({ enabled: false });
        expect([method, path, asEmployee.status, anonymous.status]).toEqual([method, path, 403, 401]);
      }
      expect((await get(orgA.adminToken, '/phishing/results/settings').expect(200)).body.personalResultsEnabled).toBe(false); // pracownik niczego nie włączył
    });

    it('organizacja PENDING: 403 ORGANIZATION_PENDING_DOMAIN_VERIFICATION', async () => {
      const { body } = await registerVerified(app, tenantPrisma, { email: email('pending'), password: DEFAULT_TEST_PASSWORD }, { activateOrganization: false });

      for (const path of ['/phishing/results/overview', '/phishing/results/settings']) {
        const response = await get(body.accessToken, path);
        expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
      }
    });

    it('identyfikator kampanii z niebezpiecznymi znakami => 400; nieistniejąca => 404 (także przy włączonej fladze, bez wpisu audytu)', async () => {
      await setFlag(orgA, true);
      const before = (await auditRows(orgA)).length;

      await get(orgA.adminToken, results('..%2F', '/people')).expect(400);
      await get(orgA.adminToken, results('nieistnieje', '/people')).expect(404);
      await get(orgA.adminToken, results('nieistnieje', '/departments')).expect(404);

      expect((await auditRows(orgA)).length).toBe(before);
      await setFlag(orgA, false);
    });
  });

  describe('izolacja tenantów (Zasada nr 1)', () => {
    it('B nie widzi wyników A (agregaty, osobowe, CSV) nawet z włączoną własną flagą; A nie widzi B', async () => {
      await setFlag(orgA, true);
      await setFlag(orgB, true);

      for (const path of ['/departments', '/departments.csv', '/people', '/people.csv']) {
        expect([path, (await get(orgB.adminToken, results(orgA.campaignId, path))).status]).toEqual([path, 404]);
        expect([path, (await get(orgA.adminToken, results(orgB.campaignId, path))).status]).toEqual([path, 404]);
      }
      await setFlag(orgA, false);
      await setFlag(orgB, false);
    });

    it('flaga i audyt są per organizacja: włączenie w A nie włącza B, a B nie widzi audytu A', async () => {
      await setFlag(orgA, true);
      await setFlag(orgB, false);

      const bView = await get(orgB.adminToken, results(orgB.campaignId, '/people'));
      const bAudit = await get(orgB.adminToken, '/phishing/results/settings/audit').expect(200);

      expect([bView.status, bView.body.code]).toEqual([403, 'PERSONAL_RESULTS_DISABLED']);
      expect(JSON.stringify(bAudit.body)).not.toContain(email('a'));
      await setFlag(orgA, false);
    });

    it('agregaty B liczą tylko odbiorców B; przegląd A nie zawiera działu Marketing z B', async () => {
      const b = await get(orgB.adminToken, results(orgB.campaignId, '/departments')).expect(200);
      const overviewA = await get(orgA.adminToken, '/phishing/results/overview').expect(200);

      expect(b.body.total).toMatchObject({ delivered: 4, clicked: 1 });
      expect(JSON.stringify(overviewA.body)).not.toContain('Marketing');
    });

    it('RLS w bazie (bez filtra w kodzie): kontekst B nie widzi ustawień i audytu A i niczego w nich nie zmieni', async () => {
      await setFlag(orgA, true);

      const result = await tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => ({
        settings: (await tx.phishingResultSettings.findMany()).map((row) => row.organizationId),
        audit: (await tx.phishingResultVisibilityAudit.findMany()).map((row) => row.organizationId),
        updated: (await tx.phishingResultSettings.updateMany({ data: { personalResultsEnabled: false } })).count,
      }));

      expect(result.settings).not.toContain(orgA.organizationId);
      expect(result.audit).not.toContain(orgA.organizationId);
      expect((await get(orgA.adminToken, '/phishing/results/settings').expect(200)).body.personalResultsEnabled).toBe(true);
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.phishingResultVisibilityAudit.create({ data: { organizationId: orgA.organizationId, action: 'VIEWED', actorEmail: 'x@x.pl' } })),
      ).rejects.toThrow();
      await setFlag(orgA, false);
    });

    it('audyt: aktor musi należeć do tej samej organizacji (złożone FK)', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
          tx.phishingResultVisibilityAudit.create({ data: { organizationId: orgA.organizationId, action: 'VIEWED', actorUserId: orgB.users.b1, actorEmail: 'x@x.pl' } }),
        ),
      ).rejects.toThrow(/foreign key/i);
    });
  });
});
