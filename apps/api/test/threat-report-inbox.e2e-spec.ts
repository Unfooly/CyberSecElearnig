import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { CONTENT_RETENTION_DAYS, ThreatReportRetentionService } from '../src/threat-reports/threat-report-retention.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const DAY = 24 * 3_600_000;
type Role = 'EMPLOYEE' | 'DEPARTMENT_MANAGER' | 'ORG_ADMIN';
type Status = 'NEW' | 'IN_REVIEW' | 'THREAT' | 'SAFE';

interface Person {
  id: string;
  token: string;
  email: string;
}
interface Org {
  organizationId: string;
  adminToken: string;
  adminEmail: string;
  adminId: string;
  departments: Record<string, string>;
  people: Record<string, Person>;
}

// Skrzynka zgłoszeń (commit 3/5): ORG_ADMIN (lista, szczegóły, status, notatki z dziennikiem), DEPARTMENT_MANAGER (ograniczona
// lista własnego działu), izolacja A/B, uprawnienia bazy (append-only dziennik, UPDATE tylko kolumny note) i retencja notatek.
describe('Skrzynka zgłoszeń (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let retention: ThreatReportRetentionService;
  let owner: PrismaClient;

  const suffix = Date.now();
  const domainSuffix = 'threat-inbox-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    retention = app.get(ThreatReportRetentionService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    orgA = await newOrg('a');
    await addPerson(orgA, 'mgr-sales', 'DEPARTMENT_MANAGER', 'Sales');
    await addPerson(orgA, 's1', 'EMPLOYEE', 'Sales');
    await addPerson(orgA, 's2', 'EMPLOYEE', 'Sales');
    await addPerson(orgA, 's3', 'EMPLOYEE', 'Sales');
    await addPerson(orgA, 'i1', 'EMPLOYEE', 'IT');
    // Dział z kierownikiem i 2 pracownikami: bez kierownika za mało osób (próg liczony bez niego).
    await addPerson(orgA, 'mgr-trio', 'DEPARTMENT_MANAGER', 'Trio');
    await addPerson(orgA, 'r1', 'EMPLOYEE', 'Trio');
    await addPerson(orgA, 'r2', 'EMPLOYEE', 'Trio');
    await addPerson(orgA, 'mgr-tiny', 'DEPARTMENT_MANAGER', 'Tiny');
    await addPerson(orgA, 't1', 'EMPLOYEE', 'Tiny');
    await addPerson(orgA, 'mgr-none', 'DEPARTMENT_MANAGER', null);
    orgB = await newOrg('b');
    await addPerson(orgB, 'b1', 'EMPLOYEE', 'Ops');
  }, 120_000);

  afterAll(async () => {
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  const clearThrottle = () => (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  beforeEach(clearThrottle);

  // Każdy test zaczyna od pustej skrzynki (rola aplikacji nie ma DELETE, więc sprzątamy jako właściciel schematu).
  afterEach(async () => {
    const organizationIds = [orgA.organizationId, orgB.organizationId];
    await owner.threatReportEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await owner.threatReport.deleteMany({ where: { organizationId: { in: organizationIds } } });
  });

  // ---- fixtures ----------------------------------------------------------------------------------------------------

  async function newOrg(label: string): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { organizationId: admin!.organizationId, adminToken: body.accessToken, adminEmail: credentials.email, adminId: admin!.id, departments: {}, people: {} };
  }

  async function addPerson(org: Org, label: string, role: Role, departmentName: string | null): Promise<Person> {
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
          firstName: `Imię-${label}`,
          lastName: 'Testowy',
          departmentId: departmentName ? org.departments[departmentName] : null,
        },
      }),
    );
    clearThrottle(); // fixture loguje wielu użytkowników pod rząd - limit logowań nie jest tu przedmiotem testu
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);
    org.people[label] = { id: user.id, token: login.body.accessToken, email: email(label) };
    return org.people[label];
  }

  /** Zgłoszenie wstawione wprost (kolejność po createdAt): prawdziwe (REAL) albo symulacyjne. */
  async function insertReport(
    org: Org,
    reporter: string | null,
    departmentName: string | null,
    overrides: { kind?: 'REAL' | 'SIMULATION'; status?: Status; subject?: string; ageMs?: number; body?: string } = {},
  ) {
    const kind = overrides.kind ?? 'REAL';
    return tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.threatReport.create({
        data: {
          organizationId: org.organizationId,
          reporterUserId: reporter ? org.people[reporter].id : null,
          reporterDepartmentId: departmentName ? org.departments[departmentName] : null,
          kind,
          status: overrides.status ?? 'NEW',
          senderText: 'Obcy <obcy@zlosliwa.example>',
          senderDomain: 'zlosliwa.example',
          subject: overrides.subject ?? 'Pilna faktura',
          ...(kind === 'REAL' ? { body: overrides.body ?? 'TREŚĆ-TAJNA-ZGŁOSZENIA', headers: 'Received: NAGŁÓWKI-TAJNE', comment: 'KOMENTARZ-TAJNY' } : { matchMethod: 'TOKEN' as const }),
          createdAt: new Date(Date.now() - (overrides.ageMs ?? 0)),
        },
      }),
    );
  }

  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: unknown) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body as object);
  const events = (org: Org, reportId: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.threatReportEvent.findMany({ where: { organizationId: org.organizationId, reportId }, orderBy: { createdAt: 'asc' } }));

  // ---- ORG_ADMIN: lista i szczegóły --------------------------------------------------------------------------------

  describe('ORG_ADMIN: lista i szczegóły', () => {
    it('lista: tylko zgłoszenia PRAWDZIWE (symulacyjne nie trafiają do skrzynki), od najnowszych, z tożsamością zgłaszającego, bez treści', async () => {
      const older = await insertReport(orgA, 's1', 'Sales', { subject: 'Starsze', ageMs: 2 * 3_600_000 });
      const newer = await insertReport(orgA, 'i1', 'IT', { subject: 'Nowsze', ageMs: 3_600_000 });
      await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION', subject: 'To była symulacja' });

      const response = await get(orgA.adminToken, '/threat-reports/inbox').expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([newer.id, older.id]);
      expect(response.body.items[0]).toMatchObject({ subject: 'Nowsze', status: 'NEW', senderDomain: 'zlosliwa.example', hasContent: true });
      // Lista nie zostawia śladu w dzienniku wglądów, więc NIE ujawnia zgłaszającego (tylko audytowane szczegóły).
      expect(response.body.items[0]).not.toHaveProperty('reporter');
      expect(JSON.stringify(response.body)).not.toContain(orgA.people.i1.email);
      expect(JSON.stringify(response.body)).not.toContain(orgA.people.i1.id);
      expect(JSON.stringify(response.body)).not.toMatch(/TREŚĆ-TAJNA|NAGŁÓWKI-TAJNE|KOMENTARZ-TAJNY/); // lista bez treści
      expect(JSON.stringify(response.body)).not.toContain('SIMULATION');
    });

    it('filtr statusu i stronicowanie; nieprawidłowe parametry to 400', async () => {
      for (let i = 0; i < 5; i += 1) {
        await insertReport(orgA, 's1', 'Sales', { subject: `Zgłoszenie ${i}`, ageMs: (5 - i) * 60_000, status: i < 2 ? 'SAFE' : 'NEW' });
      }

      const safe = await get(orgA.adminToken, '/threat-reports/inbox?status=SAFE').expect(200);
      const page2 = await get(orgA.adminToken, '/threat-reports/inbox?page=2&pageSize=2').expect(200);
      const page3 = await get(orgA.adminToken, '/threat-reports/inbox?page=3&pageSize=2').expect(200);

      expect(safe.body.total).toBe(2);
      expect(page2.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(page2.body.items).toHaveLength(2);
      expect(page3.body.items).toHaveLength(1);
      await get(orgA.adminToken, '/threat-reports/inbox?status=NIEZNANY').expect(400);
      await get(orgA.adminToken, '/threat-reports/inbox?pageSize=1000').expect(400);
      await get(orgA.adminToken, '/threat-reports/inbox?page=0').expect(400);
      await get(orgA.adminToken, '/threat-reports/inbox?page=501').expect(400);
    });

    it('szczegóły: treść, nagłówki, komentarz, zgłaszający, dział i dziennik zdarzeń; zgłoszenie symulacyjne i nieistniejące to 404', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const simulation = await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION' });

      const detail = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);

      expect(detail.body).toMatchObject({
        id: report.id,
        body: 'TREŚĆ-TAJNA-ZGŁOSZENIA',
        headers: 'Received: NAGŁÓWKI-TAJNE',
        comment: 'KOMENTARZ-TAJNY',
        departmentName: 'Sales',
        events: [],
        reporter: { email: orgA.people.s1.email },
      });
      await get(orgA.adminToken, `/threat-reports/inbox/${simulation.id}`).expect(404);
      await get(orgA.adminToken, '/threat-reports/inbox/nieistniejace').expect(404);
      await get(orgA.adminToken, '/threat-reports/inbox/a%2Fb').expect(400); // identyfikator spoza allowlisty odrzuca SafeIdPipe
    });

    it('zgłaszający usunięty: zgłoszenie zostaje, reporter = null', async () => {
      const report = await insertReport(orgA, null, 'Sales');

      const detail = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);

      expect(detail.body.reporter).toBeNull();
    });
  });

  // ---- ORG_ADMIN: audyt wglądów ------------------------------------------------------------------------------------

  describe('audyt wglądów w szczegóły zgłoszenia (jak wgląd w wyniki osobowe)', () => {
    const views = (org: Org, reportId: string) =>
      tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.threatReportView.findMany({ where: { organizationId: org.organizationId, reportId }, orderBy: { createdAt: 'asc' } }));

    it('każdy wgląd zapisuje wpis (kto, kiedy, które zgłoszenie) i jest widoczny w szczegółach; lista NIE zapisuje wglądów', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await get(orgA.adminToken, '/threat-reports/inbox').expect(200);
      expect(await views(orgA, report.id)).toEqual([]);

      const first = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);
      const second = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);

      expect(first.body.views).toEqual([expect.objectContaining({ actorEmail: orgA.adminEmail })]);
      expect(second.body.views).toHaveLength(2);
      const stored = await views(orgA, report.id);
      expect(stored).toHaveLength(2);
      expect(stored.every((view) => view.actorUserId === orgA.adminId && view.organizationId === orgA.organizationId && view.actorEmail === orgA.adminEmail)).toBe(true);
    });

    it('wgląd innego admina jest osobnym wpisem z jego adresem', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const other = await addPerson(orgA, 'admin-two', 'ORG_ADMIN', null);

      await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);
      const detail = await get(other.token, `/threat-reports/inbox/${report.id}`).expect(200);

      expect(detail.body.views.map((view: { actorEmail: string }) => view.actorEmail).sort()).toEqual([orgA.adminEmail, other.email].sort());
    });

    it('zmiana statusu i notatka NIE dokładają wpisu wglądu i NIE zwracają treści ani zgłaszającego (nie są drogą do odczytu z pominięciem audytu)', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');

      const status = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE' }).expect(200);
      const note = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 'x' }).expect(201);

      expect(await views(orgA, report.id)).toEqual([]);
      for (const body of [status.body, note.body]) {
        expect(Object.keys(body).sort()).toEqual(['events', 'id', 'status']);
        expect(JSON.stringify(body)).not.toMatch(/TREŚĆ-TAJNA|NAGŁÓWKI-TAJNE|KOMENTARZ-TAJNY|zlosliwa|Pilna faktura/);
        expect(JSON.stringify(body)).not.toContain(orgA.people.s1.email);
      }
    });

    it('podsumowanie wglądów per admin (liczba, pierwszy, ostatni) nie da się zakopać wieloma odświeżeniami', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const other = await addPerson(orgA, 'viewer-two', 'ORG_ADMIN', null);
      await get(other.token, `/threat-reports/inbox/${report.id}`).expect(200);
      for (let i = 0; i < 55; i += 1) {
        await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);
        if (i % 25 === 24) clearThrottle(); // limit 30/min na GET nie jest tu przedmiotem testu
      }

      const detail = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);

      expect(detail.body.views).toHaveLength(50); // ostatnie wglądy: 50 najnowszych
      expect(detail.body.views.every((view: { actorEmail: string }) => view.actorEmail === orgA.adminEmail)).toBe(true); // wgląd drugiego admina wypchnięty z listy...
      const viewers = new Map(detail.body.viewers.map((v: { actorEmail: string; count: number }) => [v.actorEmail, v]));
      expect(viewers.get(other.email)).toMatchObject({ count: 1 }); // ...ale nadal widoczny w podsumowaniu
      expect(viewers.get(orgA.adminEmail)).toMatchObject({ count: 56 });
    });

    it('brak śladu bez wglądu i odwrotnie: odmowa (403/404) nie zostawia wpisu, a nieudany zapis wpisu cofa odczyt', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const simulation = await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION' });

      await get(orgA.people['mgr-sales'].token, `/threat-reports/inbox/${report.id}`).expect(403);
      await get(orgA.people.s1.token, `/threat-reports/inbox/${report.id}`).expect(403);
      await get(orgA.adminToken, `/threat-reports/inbox/${simulation.id}`).expect(404);
      await get(orgB.adminToken, `/threat-reports/inbox/${report.id}`).expect(404);

      expect(await views(orgA, report.id)).toEqual([]);
      expect(await views(orgA, simulation.id)).toEqual([]);
      // Zapis wpisu wglądu nie powiódł się => odpowiedź z danymi nie może wyjść (jedna transakcja).
      const original = tenantPrisma.runInOrgContext.bind(tenantPrisma);
      jest.spyOn(tenantPrisma, 'runInOrgContext').mockImplementation((async (orgId: string, fn: (tx: never) => Promise<unknown>, options?: never) =>
        original(
          orgId,
          async (tx) =>
            fn(
              new Proxy(tx, {
                get: (target, property, receiver) =>
                  property === 'threatReportView'
                    ? { ...Reflect.get(target, property, receiver), create: async () => Promise.reject(new Error('zapis audytu nie powiódł się')) }
                    : Reflect.get(target, property, receiver),
              }) as never,
            ),
          options,
        )) as never);
      try {
        const failed = await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`);
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toContain('TREŚĆ-TAJNA');
      } finally {
        jest.restoreAllMocks();
        jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
      }
    });

    it('izolacja A/B i uprawnienia bazy: wpisy wglądów są niewidoczne dla drugiej organizacji; rola aplikacji nie może ich zmienić ani usunąć', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200);
      const [view] = await views(orgA, report.id);

      const seenByB = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.threatReportView.findMany({ select: { id: true } }));

      expect(seenByB).toEqual([]);
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportView.deleteMany({ where: { id: view.id } }))).rejects.toThrow();
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportView.updateMany({ where: { id: view.id }, data: { actorEmail: 'inny@example.test' } }))).rejects.toThrow();
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.threatReportView.create({ data: { organizationId: orgB.organizationId, reportId: report.id, actorEmail: 'x@example.test' } })),
      ).rejects.toThrow(); // złożone FK: zgłoszenie musi należeć do tej samej organizacji
    });

    it('usunięcie konta admina zeruje actorUserId, a wpis i kopia e-maila zostają', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const temp = await addPerson(orgA, 'view-admin', 'ORG_ADMIN', null);
      await get(temp.token, `/threat-reports/inbox/${report.id}`).expect(200);

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: temp.id } }));

      expect((await views(orgA, report.id))[0]).toMatchObject({ actorUserId: null, actorEmail: temp.email });
    });
  });

  // ---- ORG_ADMIN: status i notatki ---------------------------------------------------------------------------------

  describe('ORG_ADMIN: zmiana statusu i notatki (dziennik zdarzeń)', () => {
    it('zmiana statusu zapisuje wpis dziennika (kto, kiedy, z jakiego na jaki) w tej samej operacji', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');

      const response = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'IN_REVIEW' }).expect(200);

      expect(response.body.status).toBe('IN_REVIEW');
      expect(response.body.events).toEqual([expect.objectContaining({ type: 'STATUS_CHANGED', fromStatus: 'NEW', toStatus: 'IN_REVIEW', actorEmail: orgA.adminEmail, note: null })]);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'THREAT' }).expect(200);
      expect((await events(orgA, report.id)).map((event) => [event.fromStatus, event.toStatus])).toEqual([['NEW', 'IN_REVIEW'], ['IN_REVIEW', 'THREAT']]);
    });

    it('ten sam status = 409 STATUS_UNCHANGED (bez wpisu w dzienniku); nieprawidłowy status = 400; symulacja i obce = 404', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const simulation = await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION' });

      const same = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'NEW' }).expect(409);

      expect(same.body.code).toBe('STATUS_UNCHANGED');
      expect(await events(orgA, report.id)).toEqual([]);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'DELETED' }).expect(400);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, {}).expect(400);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE', organizationId: 'x' }).expect(400);
      await post(orgA.adminToken, `/threat-reports/inbox/${simulation.id}/status`, { status: 'SAFE' }).expect(404);
    });

    it('RÓWNOLEGŁE zmiany: bez utraconych aktualizacji i bez błędów 5xx - każda udana zmiana ma dokładnie jeden wpis, łańcuch zdarzeń jest spójny', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const targets: Status[] = ['IN_REVIEW', 'THREAT', 'SAFE', 'IN_REVIEW', 'THREAT', 'SAFE', 'IN_REVIEW', 'THREAT'];

      const responses = await Promise.allSettled(targets.map((status) => post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status })));

      const statuses = responses.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true); // 409 = ten sam status albo zmiana w międzyczasie
      const successes = statuses.filter((s) => s === 200).length;
      expect(successes).toBeGreaterThanOrEqual(1);
      const chain = await events(orgA, report.id);
      expect(chain).toHaveLength(successes); // ani utraconej, ani zdublowanej zmiany
      // Spójność: każdy wpis zaczyna od statusu, na którym skończył poprzedni; końcowy status = ostatnie "do".
      let expectedFrom: Status = 'NEW';
      for (const event of chain) {
        expect(event.fromStatus).toBe(expectedFrom);
        expect(event.toStatus).not.toBe(event.fromStatus);
        expectedFrom = event.toStatus as Status;
      }
      expect((await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200)).body.status).toBe(expectedFrom);
    });

    it('zmiana warunkowa: status zmieniony po odczycie, ale przed zapisem, daje 409 STATUS_CONFLICT (bez wpisu w dzienniku)', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const { ThreatReportInboxService } = await import('../src/threat-reports/threat-report-inbox.service');
      const service = app.get(ThreatReportInboxService);
      const user = { userId: orgA.adminId, organizationId: orgA.organizationId, role: 'ORG_ADMIN' as never, email: orgA.adminEmail };
      // Symulacja wyścigu: pierwszy zapis wygrywa i zmienia status pod nogami drugiego (odczyt "NEW" jest już nieaktualny).
      const original = tenantPrisma.runInOrgContext.bind(tenantPrisma);
      let injected = false;
      jest.spyOn(tenantPrisma, 'runInOrgContext').mockImplementation((async (orgId: string, fn: (tx: never) => Promise<unknown>, options?: never) =>
        original(
          orgId,
          async (tx) => {
            const wrapped = new Proxy(tx, {
              get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (property === 'threatReport' && !injected) {
                  return new Proxy(value, {
                    get(model, method) {
                      if (method === 'updateMany') {
                        return async (args: unknown) => {
                          injected = true;
                          await owner.threatReport.update({ where: { id: report.id }, data: { status: 'THREAT' } }); // inny status zapisany poza transakcją
                          return model.updateMany(args);
                        };
                      }
                      return Reflect.get(model, method);
                    },
                  });
                }
                return value;
              },
            });
            return fn(wrapped as never);
          },
          options,
        )) as never);

      try {
        await expect(service.changeStatus(user, report.id, { status: 'SAFE' })).rejects.toMatchObject({ response: { code: 'STATUS_CONFLICT' } });
      } finally {
        jest.restoreAllMocks();
        jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
      }

      expect(await events(orgA, report.id)).toEqual([]);
    });

    it('notatka: wpis dziennika z autorem; tokeny linków śledzących są maskowane; puste, same znaki sterujące i zbyt długie to 400', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const token = 'A'.repeat(43);

      const response = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: `Sprawdzone.\u0000 Link https://f.example/t/${token}` }).expect(201);

      const note = response.body.events.at(-1);
      expect(note).toMatchObject({ type: 'NOTE_ADDED', actorEmail: orgA.adminEmail, fromStatus: null, toStatus: null });
      expect(note.note).toContain('Sprawdzone.');
      expect(note.note).not.toContain(token);
      expect(note.note).not.toContain('\u0000');
      const empty = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: '\u0000​  ' }).expect(400);
      expect(empty.body.code).toBe('NOTE_INVALID');
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 'a'.repeat(1001) }).expect(400);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 5 }).expect(400);
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 'ok', reportId: 'x' }).expect(400);
      expect(await events(orgA, report.id)).toHaveLength(1);
    });

    it('limit wpisów historii (200 na zgłoszenie): kolejna notatka i zmiana statusu = 409 EVENT_LIMIT, a status pozostaje bez zmian', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await owner.threatReportEvent.createMany({
        data: Array.from({ length: 200 }, () => ({ organizationId: orgA.organizationId, reportId: report.id, type: 'NOTE_ADDED' as const, note: 'x', actorEmail: 'x@example.test' })),
      });

      const note = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 'ponad limit' }).expect(409);
      const status = await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE' }).expect(409);

      expect([note.body.code, status.body.code]).toEqual(['EVENT_LIMIT', 'EVENT_LIMIT']);
      expect((await get(orgA.adminToken, `/threat-reports/inbox/${report.id}`).expect(200)).body.status).toBe('NEW');
      expect(await events(orgA, report.id)).toHaveLength(200);
    });

    it('notatki do zgłoszenia symulacyjnego lub nieistniejącego: 404', async () => {
      const simulation = await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION' });

      await post(orgA.adminToken, `/threat-reports/inbox/${simulation.id}/notes`, { note: 'x' }).expect(404);
      await post(orgA.adminToken, '/threat-reports/inbox/brak/notes', { note: 'x' }).expect(404);
    });
  });

  // ---- role --------------------------------------------------------------------------------------------------------

  describe('uprawnienia ról (rola z bazy, nie z tokenu)', () => {
    it('401 bez tokenu; pracownik nie ma dostępu do skrzynki ani do widoku działu (403)', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await request(app.getHttpServer()).get('/threat-reports/inbox').expect(401);
      const employee = orgA.people.s1.token;

      for (const path of ['/threat-reports/inbox', `/threat-reports/inbox/${report.id}`, '/threat-reports/department']) {
        await get(employee, path).expect(403);
      }
      await post(employee, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE' }).expect(403);
      await post(employee, `/threat-reports/inbox/${report.id}/notes`, { note: 'x' }).expect(403);
    });

    it('kierownik działu NIE ma dostępu do skrzynki admina, szczegółów, zmiany statusu ani notatek (403)', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const manager = orgA.people['mgr-sales'].token;

      await get(manager, '/threat-reports/inbox').expect(403);
      await get(manager, `/threat-reports/inbox/${report.id}`).expect(403);
      await post(manager, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE' }).expect(403);
      await post(manager, `/threat-reports/inbox/${report.id}/notes`, { note: 'x' }).expect(403);
      expect(await events(orgA, report.id)).toEqual([]);
    });

    it('admin nie używa widoku działu (403); degradacja lub dezaktywacja konta działa OD RAZU mimo ważnego tokenu', async () => {
      await get(orgA.adminToken, '/threat-reports/department').expect(403);
      const extra = await addPerson(orgA, 'temp-admin', 'ORG_ADMIN', null);
      await get(extra.token, '/threat-reports/inbox').expect(200);

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: extra.id }, data: { role: 'EMPLOYEE' } }));
      await get(extra.token, '/threat-reports/inbox').expect(403);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: extra.id }, data: { role: 'ORG_ADMIN', status: 'INVITED' } }));
      await get(extra.token, '/threat-reports/inbox').expect(403);
    });
  });

  // ---- kierownik działu --------------------------------------------------------------------------------------------

  describe('DEPARTMENT_MANAGER: ograniczona lista własnego działu', () => {
    it('widzi tylko zgłoszenia SWOJEGO działu jako: data, status, DOMENA nadawcy, powiązanie z symulacją (tak/nie) - bez tematu, pełnego nadawcy, zgłaszającego, treści i notatek', async () => {
      const mine = await insertReport(orgA, 's1', 'Sales', { subject: 'TEMAT-OSOBY-TRZECIEJ' });
      await insertReport(orgA, 'i1', 'IT', { subject: 'Zgłoszenie z IT' });
      const simulation = await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION', subject: 'TEMAT-SYMULACJI' });
      await post(orgA.adminToken, `/threat-reports/inbox/${mine.id}/notes`, { note: 'NOTATKA-ADMINA-TAJNA' }).expect(201);

      const response = await get(orgA.people['mgr-sales'].token, '/threat-reports/department').expect(200);

      expect(response.body).toMatchObject({ total: 2, insufficientData: false, minGroupSize: 3 });
      const byId = new Map(response.body.items.map((item: { id: string }) => [item.id, item]));
      expect(byId.get(mine.id)).toEqual({ id: mine.id, createdAt: expect.any(String), status: 'NEW', senderDomain: 'zlosliwa.example', isSimulation: false });
      // Zgłoszenie symulacyjne: bez domeny (nasza domena kampanii nie niesie informacji, a zdradzałaby trwającą kampanię) i bez statusu.
      expect(byId.get(simulation.id)).toEqual({ id: simulation.id, createdAt: expect.any(String), status: null, senderDomain: null, isSimulation: true });
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/TREŚĆ-TAJNA|NAGŁÓWKI-TAJNE|KOMENTARZ-TAJNY|NOTATKA-ADMINA-TAJNA|Zgłoszenie z IT|TEMAT-/);
      expect(text).not.toContain('obcy@zlosliwa.example'); // pełny adres nadawcy to dane osoby trzeciej - tylko domena
      expect(text).not.toContain(orgA.people.s1.email); // brak tożsamości zgłaszającego
      expect(text).not.toContain(orgA.people.s1.id);
      expect(text).not.toMatch(/reporter|events|body|headers|comment|subject|senderText/);
    });

    it('filtr statusu działa; kierownik widzi zmiany statusu (tylko wartość), nie ich autora', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'THREAT' }).expect(200);

      const threat = await get(orgA.people['mgr-sales'].token, '/threat-reports/department?status=THREAT').expect(200);
      const safe = await get(orgA.people['mgr-sales'].token, '/threat-reports/department?status=SAFE').expect(200);

      expect(threat.body.items).toHaveLength(1);
      expect(threat.body.items[0].status).toBe('THREAT');
      expect(safe.body.items).toEqual([]);
      // Filtr statusu dotyczy tylko zgłoszeń prawdziwych (symulacyjne nie mają statusu).
      await insertReport(orgA, 's2', 'Sales', { kind: 'SIMULATION' });
      expect((await get(orgA.people['mgr-sales'].token, '/threat-reports/department?status=NEW').expect(200)).body.items).toEqual([]);
      expect(JSON.stringify(threat.body)).not.toContain(orgA.adminEmail);
    });

    it('dział poniżej progu liczebności (2 aktywne osoby): "za mało danych", bez listy - zgłoszenie nie identyfikuje zgłaszającego', async () => {
      await insertReport(orgA, 't1', 'Tiny');

      const response = await get(orgA.people['mgr-tiny'].token, '/threat-reports/department').expect(200);

      expect(response.body).toMatchObject({ insufficientData: true, items: [], total: 0 });
    });

    it('próg liczebności NIE liczy samego kierownika: dział z kierownikiem i 2 pracownikami to "za mało danych"', async () => {
      await insertReport(orgA, 'r1', 'Trio');

      const response = await get(orgA.people['mgr-trio'].token, '/threat-reports/department').expect(200);

      expect(response.body).toMatchObject({ insufficientData: true, items: [], total: 0 });
    });

    it('opóźnienie widoczności: przy RESULTS_CACHE_TTL_SECONDS=3600 kierownik nie widzi zgłoszeń młodszych niż godzina (total też ich nie liczy)', async () => {
      const { ThreatReportInboxService } = await import('../src/threat-reports/threat-report-inbox.service');
      const delayed = new ThreatReportInboxService(tenantPrisma, { get: (key: string) => (key === 'RESULTS_CACHE_TTL_SECONDS' ? '3600' : undefined) } as never);
      const user = { userId: orgA.people['mgr-sales'].id, organizationId: orgA.organizationId, role: 'DEPARTMENT_MANAGER' as never, email: orgA.people['mgr-sales'].email };
      const old = await insertReport(orgA, 's1', 'Sales', { subject: 'Sprzed dwóch godzin', ageMs: 2 * 3_600_000 });
      await insertReport(orgA, 's2', 'Sales', { subject: 'Sprzed pół godziny', ageMs: 30 * 60_000 });

      const now = await delayed.listForManager(user, {});
      const later = await delayed.listForManager(user, {}, new Date(Date.now() + 3_600_000));

      expect(now.items.map((row) => row.id)).toEqual([old.id]);
      expect(now.total).toBe(1);
      expect(later.total).toBe(2); // po godzinie od zgłoszenia widać oba
      // Bez opóźnienia (domyślnie w testach) endpoint widzi oba zgłoszenia od razu.
      expect((await get(orgA.people['mgr-sales'].token, '/threat-reports/department').expect(200)).body.total).toBe(2);
    });

    it('kierownik bez przypisanego działu dostaje pustą listę (nie zgłoszenia całej organizacji)', async () => {
      await insertReport(orgA, 's1', 'Sales');

      const response = await get(orgA.people['mgr-none'].token, '/threat-reports/department').expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });
  });

  // ---- izolacja A/B ------------------------------------------------------------------------------------------------

  describe('izolacja organizacji (Zasada nr 1)', () => {
    it('admin B nie widzi, nie zmienia i nie notuje zgłoszeń A (404), a jego lista zawiera tylko zgłoszenia B', async () => {
      const a = await insertReport(orgA, 's1', 'Sales', { subject: 'Zgłoszenie A' });
      const b = await insertReport(orgB, 'b1', 'Ops', { subject: 'Zgłoszenie B' });

      const listB = await get(orgB.adminToken, '/threat-reports/inbox').expect(200);

      expect(listB.body.items.map((item: { id: string }) => item.id)).toEqual([b.id]);
      await get(orgB.adminToken, `/threat-reports/inbox/${a.id}`).expect(404);
      await post(orgB.adminToken, `/threat-reports/inbox/${a.id}/status`, { status: 'SAFE' }).expect(404);
      await post(orgB.adminToken, `/threat-reports/inbox/${a.id}/notes`, { note: 'wtargnięcie' }).expect(404);
      expect((await get(orgA.adminToken, `/threat-reports/inbox/${a.id}`).expect(200)).body).toMatchObject({ status: 'NEW', events: [] });
    });

    it('kierownik działu z A nie widzi zgłoszeń B (nawet o tej samej nazwie działu)', async () => {
      await insertReport(orgB, 'b1', 'Ops');
      const response = await get(orgA.people['mgr-sales'].token, '/threat-reports/department').expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('RLS: zdarzenia i zgłoszenia jednej organizacji są niewidoczne w kontekście drugiej (także bez filtra organizationId)', async () => {
      const a = await insertReport(orgA, 's1', 'Sales');
      await post(orgA.adminToken, `/threat-reports/inbox/${a.id}/notes`, { note: 'notatka A' }).expect(201);

      const seenByB = await tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => ({
        reports: await tx.threatReport.findMany({ select: { id: true } }),
        events: await tx.threatReportEvent.findMany({ select: { id: true } }),
      }));

      expect(seenByB.reports.map((r) => r.id)).not.toContain(a.id);
      expect(seenByB.events).toEqual([]);
    });
  });

  // ---- gwarancje bazy ----------------------------------------------------------------------------------------------

  describe('gwarancje bazy danych (dziennik zdarzeń)', () => {
    it('rola aplikacji NIE może usunąć zdarzenia ani zmienić autora, czasu i statusów - może zmienić wyłącznie kolumnę "note"', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: 'notatka' }).expect(201);
      const [event] = await events(orgA, report.id);

      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportEvent.deleteMany({ where: { id: event.id } }))).rejects.toThrow();
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportEvent.updateMany({ where: { id: event.id }, data: { actorEmail: 'inny@example.test' } }))).rejects.toThrow();
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportEvent.updateMany({ where: { id: event.id }, data: { createdAt: new Date(0) } }))).rejects.toThrow();
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportEvent.updateMany({ where: { id: event.id }, data: { note: null } }));
      expect((await events(orgA, report.id))[0]).toMatchObject({ note: null, actorEmail: orgA.adminEmail });
    });

    it('CHECK: zdarzenie zmiany statusu wymaga nowego statusu i nie ma notatki; notatka nie ma statusów', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const base = { organizationId: orgA.organizationId, reportId: report.id, actorEmail: 'x@example.test' };
      const create = (data: Record<string, unknown>) => tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReportEvent.create({ data: { ...base, ...data } as never }));

      await expect(create({ type: 'STATUS_CHANGED' })).rejects.toThrow();
      await expect(create({ type: 'STATUS_CHANGED', toStatus: 'SAFE', note: 'x' })).rejects.toThrow();
      await expect(create({ type: 'NOTE_ADDED', toStatus: 'SAFE', note: 'x' })).rejects.toThrow();
      await expect(create({ type: 'NOTE_ADDED', note: 'ok' })).resolves.toBeDefined();
    });

    it('złożone FK: zdarzenie nie może wskazywać zgłoszenia ani autora z innej organizacji', async () => {
      const a = await insertReport(orgA, 's1', 'Sales');

      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.threatReportEvent.create({ data: { organizationId: orgB.organizationId, reportId: a.id, type: 'NOTE_ADDED', note: 'x', actorEmail: 'x@example.test' } }),
        ),
      ).rejects.toThrow();
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => {
          const b = await tx.threatReport.create({ data: { organizationId: orgB.organizationId, kind: 'REAL', senderText: 'x', subject: 'x' } });
          return tx.threatReportEvent.create({ data: { organizationId: orgB.organizationId, reportId: b.id, type: 'NOTE_ADDED', note: 'x', actorEmail: 'x@example.test', actorUserId: orgA.adminId } });
        }),
      ).rejects.toThrow();
    });

    it('usunięcie konta autora zeruje actorUserId, a zdarzenie i kopia e-maila zostają', async () => {
      const report = await insertReport(orgA, 's1', 'Sales');
      const temp = await addPerson(orgA, 'ex-admin', 'ORG_ADMIN', null);
      await post(temp.token, `/threat-reports/inbox/${report.id}/notes`, { note: 'moja notatka' }).expect(201);

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: temp.id } }));

      const [event] = await events(orgA, report.id);
      expect(event).toMatchObject({ actorUserId: null, actorEmail: temp.email, note: 'moja notatka' });
    });
  });

  // ---- retencja notatek --------------------------------------------------------------------------------------------

  describe('retencja: notatki znikają razem z treścią starych zgłoszeń', () => {
    it('po 90 dniach treść notatki jest czyszczona (zdarzenie, autor i zmiany statusu zostają); notatki młodszych zgłoszeń nietknięte', async () => {
      const old = await insertReport(orgA, 's1', 'Sales', { ageMs: (CONTENT_RETENTION_DAYS + 1) * DAY });
      const fresh = await insertReport(orgA, 's2', 'Sales', { ageMs: (CONTENT_RETENTION_DAYS - 1) * DAY });
      for (const report of [old, fresh]) {
        await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/notes`, { note: `notatka-${report.id}` }).expect(201);
        await post(orgA.adminToken, `/threat-reports/inbox/${report.id}/status`, { status: 'SAFE' }).expect(200);
      }

      const first = await retention.run(new Date());
      const second = await retention.run(new Date());

      expect(first.failed).toBe(0);
      expect(second.failed).toBe(0);
      const oldEvents = await events(orgA, old.id);
      expect(oldEvents.map((event) => [event.type, event.note, event.actorEmail])).toEqual([
        ['NOTE_ADDED', null, orgA.adminEmail],
        ['STATUS_CHANGED', null, orgA.adminEmail],
      ]);
      expect((await events(orgA, fresh.id)).find((event) => event.type === 'NOTE_ADDED')?.note).toBe(`notatka-${fresh.id}`);
    });
  });

  // ---- przepływ end-to-end -----------------------------------------------------------------------------------------

  it('przepływ: pracownik zgłasza przez POST /threat-reports, admin widzi zgłoszenie w skrzynce, kierownik działu w ograniczonym widoku', async () => {
    const created = await post(orgA.people.s1.token, '/threat-reports', { sender: 'Ktoś <ktos@obcy.example>', subject: 'Prawdziwy phishing', body: 'Kliknij i zapłać' }).expect(201);

    const list = await get(orgA.adminToken, '/threat-reports/inbox').expect(200);
    const manager = await get(orgA.people['mgr-sales'].token, '/threat-reports/department').expect(200);

    expect(created.body.isSimulation).toBe(false);
    expect(list.body.items).toEqual([expect.objectContaining({ id: created.body.id, subject: 'Prawdziwy phishing' })]);
    const detail = await get(orgA.adminToken, `/threat-reports/inbox/${created.body.id}`).expect(200);
    expect(detail.body.reporter).toMatchObject({ email: orgA.people.s1.email }); // tożsamość zgłaszającego dopiero w audytowanych szczegółach
    expect(manager.body.items).toEqual([expect.objectContaining({ id: created.body.id, senderDomain: 'obcy.example', isSimulation: false })]);
    expect(JSON.stringify(manager.body)).not.toMatch(/Kliknij i zapłać|Prawdziwy phishing|ktos@obcy/);
  });
});
