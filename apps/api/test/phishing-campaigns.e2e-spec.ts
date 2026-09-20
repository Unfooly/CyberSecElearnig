import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { CampaignReconcileService } from '../src/phishing/campaigns/campaign-reconcile.service';
import { CampaignSenderService, sha256Hex, WINDOW_GRACE_MS } from '../src/phishing/campaigns/campaign-sender.service';
import { PhishingSendQueue, SendQueueItem } from '../src/phishing/campaigns/phishing-send-queue';
import { PhishingConfigService } from '../src/phishing/phishing-config.service';
import { PhishingMailMessage, PhishingMailTransport, PhishingTransportError } from '../src/phishing/transport/phishing-mail-transport';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

// Atrapa kolejki: test nie czeka na realne opóźnienia BullMQ (osobny test z prawdziwym BullMQ: phishing-campaigns-queue).
class FakeQueue extends PhishingSendQueue {
  enqueued: SendQueueItem[] = [];
  removed: string[] = [];
  failing = false;
  async enqueue(items: SendQueueItem[]) {
    if (this.failing) throw new Error('Kolejka niedostępna');
    this.enqueued.push(...items);
  }
  async remove(recipientIds: string[]) {
    this.removed.push(...recipientIds);
  }
}

class FakeTransport extends PhishingMailTransport {
  readonly name = 'fake';
  sent: PhishingMailMessage[] = [];
  next: (() => Promise<{ providerMessageId: string | null }>) | null = null;
  async send(message: PhishingMailMessage) {
    this.sent.push(message);
    return this.next ? this.next() : { providerMessageId: 'provider-1' };
  }
}

const HOUR = 3_600_000;

describe('Kampanie symulacji phishingowych (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let sender: CampaignSenderService;
  let reconcile: CampaignReconcileService;
  const queue = new FakeQueue();
  const transport = new FakeTransport();

  const suffix = Date.now();
  const domainSuffix = 'phishing-campaigns-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;

  type Org = { token: string; organizationId: string; userId: string; departments: Record<string, string>; users: Record<string, string> };
  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    process.env.PHISHING_LANDING_BASE_URL = 'https://landing.example.test';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PhishingSendQueue)
      .useValue(queue)
      .overrideProvider(PhishingMailTransport)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // listen(0), nie init(): przy równoległych żądaniach supertest na nie-nasłuchującym serwerze pierwsze żądanie
    // "posiada" serwer i zamyka go po SWOJEJ odpowiedzi, zrywając (ECONNRESET) resztę w locie - Linux/Node 20 (CI).
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    sender = app.get(CampaignSenderService);
    reconcile = app.get(CampaignReconcileService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    orgA = await newOrg('a', { sales: ['s1', 's2'], it: ['i1'] });
    orgB = await newOrg('b', { hr: ['h1'] });
    // Domyślny limit dobowy (2 x seatsLimit = 20) ograniczałby testy tworzące wiele kampanii; jego działanie ma osobne testy.
    await prisma.organization.updateMany({ where: { id: { in: [orgA.organizationId, orgB.organizationId] } }, data: { seatsLimit: 1000 } });
    // Kierownik działu w organizacji A (aktywny, więc jest odbiorcą grona ALL; nie ma dostępu do kampanii).
    await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) =>
      tx.user.create({ data: { organizationId: orgA.organizationId, email: email('a-manager'), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role: 'DEPARTMENT_MANAGER', status: 'ACTIVE', emailVerifiedAt: new Date() } }),
    );
  });

  afterAll(async () => {
    delete process.env.PHISHING_EMAIL_DOMAIN;
    delete process.env.PHISHING_LANDING_BASE_URL;
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
    queue.enqueued = [];
    queue.removed = [];
    queue.failing = false;
    transport.sent = [];
    transport.next = null;
  });

  afterEach(async () => {
    for (const org of [orgA, orgB]) {
      await tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaign.deleteMany({ where: { organizationId: org.organizationId } }));
    }
  });

  async function newOrg(label: string, departments: Record<string, string[]>): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    const organizationId = admin!.organizationId;
    const departmentIds: Record<string, string> = {};
    const users: Record<string, string> = {};
    for (const [name, members] of Object.entries(departments)) {
      const department = await tenantPrisma.runInOrgContext(organizationId, (tx) => tx.department.create({ data: { organizationId, name } }));
      departmentIds[name] = department.id;
      for (const member of members) {
        users[member] = await addUser(organizationId, `${label}-${member}`, department.id);
      }
    }
    // Zaproszony (jeszcze nieaktywny) pracownik NIE jest odbiorcą.
    await addUser(organizationId, `${label}-invited`, null, 'INVITED');
    return { token: body.accessToken, organizationId, userId: admin!.id, departments: departmentIds, users };
  }

  async function addUser(organizationId: string, label: string, departmentId: string | null, status: 'ACTIVE' | 'INVITED' = 'ACTIVE') {
    const user = await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
      tx.user.create({
        data: { organizationId, email: email(label), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role: 'EMPLOYEE', status, departmentId, emailVerifiedAt: new Date() },
      }),
    );
    return user.id;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set(auth(token));
  const post = (token: string, path: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set(auth(token)).send(body as object);
  // Serie równoległych żądań: czekamy na WSZYSTKIE (allSettled), żeby przy błędzie jednego nie zostawały w locie
  // żądania osierocone, które kończyłyby się już po teście (zrywane połączenia, "Jest did not exit").
  async function settleAll<T>(promises: PromiseLike<T>[]): Promise<T[]> {
    const results = await Promise.allSettled(promises);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map((r) => (r as PromiseFulfilledResult<T>).value);
  }

  async function kurierTemplateId(token = orgA.token) {
    const list = await get(token, '/phishing/templates').expect(200);
    return list.body.find((t: { key: string }) => t.key === 'kurier').id as string;
  }

  const windowFromNow = (fromMs = 60_000, lengthMs = 2 * HOUR) => ({
    windowStart: new Date(Date.now() + fromMs).toISOString(),
    windowEnd: new Date(Date.now() + fromMs + lengthMs).toISOString(),
  });

  async function launchBody(overrides: Record<string, unknown> = {}, token = orgA.token) {
    return { name: 'Kampania testowa', templateId: await kurierTemplateId(token), audience: { type: 'ALL' }, ...windowFromNow(), acknowledged: true, ...overrides };
  }

  async function launch(overrides: Record<string, unknown> = {}, org: Org = orgA) {
    const response = await post(org.token, '/phishing/campaigns', await launchBody(overrides, org.token)).expect(201);
    // Zaplanowane momenty są losowe w oknie; testy wysyłki "na żądanie" robią z odbiorców zaległych (termin minął minutę temu).
    await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaignRecipient.updateMany({ where: { campaignId: response.body.id }, data: { scheduledAt: new Date(Date.now() - 60_000) } }),
    );
    return response.body as { id: string; status: string; counts: Record<string, number>; failures: { code: string; count: number; uncertain: boolean }[] };
  }

  const rows = (org: Org, campaignId: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaignRecipient.findMany({ where: { organizationId: org.organizationId, campaignId }, orderBy: { createdAt: 'asc' } }));

  const view = async (campaignId: string, org: Org = orgA) => (await get(org.token, `/phishing/campaigns/${campaignId}`).expect(200)).body;

  const campaignRow = (org: Org, campaignId: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaign.findFirstOrThrow({ where: { id: campaignId, organizationId: org.organizationId } }));

  describe('dostęp i uprawnienia', () => {
    it('bez tokenu 401; EMPLOYEE i DEPARTMENT_MANAGER 403 na każdym endpoincie kampanii', async () => {
      const employeeEmail = email('a-s1');
      const employeeToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: employeeEmail, password: DEFAULT_TEST_PASSWORD }).expect(200)).body.accessToken;
      const managerEmail = email('a-manager');
      const managerToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: managerEmail, password: DEFAULT_TEST_PASSWORD }).expect(200)).body.accessToken;
      const campaign = await launch();

      const calls: [string, string][] = [
        ['get', '/phishing/campaigns'],
        ['get', `/phishing/campaigns/${campaign.id}`],
        ['post', '/phishing/campaigns'],
        ['post', '/phishing/campaigns/audience'],
        ['post', `/phishing/campaigns/${campaign.id}/cancel`],
      ];
      for (const [method, path] of calls) {
        const call = (token?: string) => {
          const req = method === 'get' ? request(app.getHttpServer()).get(path) : request(app.getHttpServer()).post(path).send({});
          return token ? req.set(auth(token)) : req;
        };
        expect([method, path, (await call()).status]).toEqual([method, path, 401]);
        expect([method, path, (await call(employeeToken)).status]).toEqual([method, path, 403]);
        expect([method, path, (await call(managerToken)).status]).toEqual([method, path, 403]);
      }
      expect((await view(campaign.id)).status).toBe('SCHEDULED'); // nic się nie zmieniło
    });

    it('organizacja PENDING (niezweryfikowana domena): 403 ORGANIZATION_PENDING_DOMAIN_VERIFICATION', async () => {
      const { body } = await registerVerified(app, tenantPrisma, { email: email('pending'), password: DEFAULT_TEST_PASSWORD }, { activateOrganization: false });

      for (const response of [await get(body.accessToken, '/phishing/campaigns'), await post(body.accessToken, '/phishing/campaigns', {}), await post(body.accessToken, '/phishing/campaigns/audience', {})]) {
        expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
      }
    });
  });

  describe('tworzenie kampanii', () => {
    it('happy path: odbiorcy = aktywni pracownicy (bez zaproszonych), momenty w oknie, snapshot szablonu, zadania w kolejce', async () => {
      const before = Date.now();
      const body = await launchBody({}, orgA.token);

      const response = await post(orgA.token, '/phishing/campaigns', body).expect(201);

      // admin + s1 + s2 + i1 + kierownik działu (INVITED wykluczony)
      expect(response.body.counts).toEqual({ total: 5, pending: 5, sent: 0, failed: 0, uncertain: 0 });
      expect(response.body).toMatchObject({ status: 'SCHEDULED', audienceType: 'ALL', name: 'Kampania testowa', createdByEmail: email('a') });
      expect(response.body.senderAddress).toMatch(/@symulacje\.example\.test$/);
      const list = await rows(orgA, response.body.id);
      const windowStart = new Date(body.windowStart as string).getTime();
      const windowEnd = new Date(body.windowEnd as string).getTime();
      for (const row of list) {
        expect(row.scheduledAt.getTime()).toBeGreaterThanOrEqual(Math.max(windowStart, before));
        expect(row.scheduledAt.getTime()).toBeLessThanOrEqual(windowEnd);
        expect(row).toMatchObject({ claimedAt: null, sentAt: null, failedAt: null, tokenHash: null, sendAttempts: 0 });
      }
      expect(queue.enqueued.map((item) => item.recipientId).sort()).toEqual(list.map((row) => row.id).sort());
      expect(queue.enqueued.every((item) => item.organizationId === orgA.organizationId && item.delayMs >= 0 && item.delayMs <= windowEnd - before + 1000)).toBe(true);
      // Odpowiedź nie zawiera adresów odbiorców (jedyny adres to autor kampanii).
      expect(JSON.stringify(response.body)).not.toMatch(new RegExp(`${email('a-s1')}|${email('a-s2')}|${email('a-i1')}|${email('a-manager')}`));
    });

    it('snapshot szablonu: edycja i usunięcie szablonu po starcie NIE zmieniają treści wysyłanej w kampanii', async () => {
      const source = await kurierTemplateId();
      const clone = (await post(orgA.token, `/phishing/templates/${source}/clone`, { name: 'Do snapshotu' }).expect(201)).body;
      const campaign = await launch({ templateId: clone.id, audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      await request(app.getHttpServer()).patch(`/phishing/templates/${clone.id}`).set(auth(orgA.token)).send({ subject: 'ZMIENIONY TEMAT PO STARCIE', bodyHtml: '<p><a href="{{trackingLink}}">inny</a></p>' }).expect(200);
      await request(app.getHttpServer()).delete(`/phishing/templates/${clone.id}`).set(auth(orgA.token)).expect(204);

      const [recipient] = await rows(orgA, campaign.id);
      await sender.sendOne(orgA.organizationId, recipient.id, new Date());

      expect(transport.sent).toHaveLength(1);
      expect(transport.sent[0].subject).toBe(clone.subject);
      expect(transport.sent[0].subject).not.toContain('ZMIENIONY');
      expect(transport.sent[0].html).toContain(clone.bodyHtml.slice(0, 20));
    });

    it('grono DEPARTMENTS i USERS; nazwa działu zapisana jako snapshot', async () => {
      const dept = await launch({ audience: { type: 'DEPARTMENTS', departmentIds: [orgA.departments.sales] } });
      const users = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.i1] } });

      expect(dept.counts.total).toBe(2);
      expect(users.counts.total).toBe(2);
      expect((await rows(orgA, dept.id)).map((row) => row.departmentName)).toEqual(['sales', 'sales']);
    });

    it('podgląd grona (kreator): liczba odbiorców bez zapisu', async () => {
      const all = await post(orgA.token, '/phishing/campaigns/audience', { audience: { type: 'ALL' } }).expect(200);
      const dept = await post(orgA.token, '/phishing/campaigns/audience', { audience: { type: 'DEPARTMENTS', departmentIds: [orgA.departments.it] } }).expect(200);

      expect(all.body.count).toBe(5);
      expect(dept.body.count).toBe(1);
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
    });

    it.each([
      ['brak potwierdzenia (acknowledged=false)', { acknowledged: false }],
      ['brak pola acknowledged', { acknowledged: undefined }],
      ['nazwa za krótka', { name: 'a' }],
      ['nazwa ze znakiem sterującym', { name: 'Kampania\u0007' }],
      ['nadmiarowe pole', { hackerField: 1 }],
      ['zły format daty', { windowStart: 'jutro' }],
      ['koniec przed początkiem', { windowStart: new Date(Date.now() + 2 * HOUR).toISOString(), windowEnd: new Date(Date.now() + HOUR).toISOString() }],
      ['okno krótsze niż 10 minut', { windowStart: new Date(Date.now() + 60_000).toISOString(), windowEnd: new Date(Date.now() + 5 * 60_000).toISOString() }],
      ['okno dłuższe niż 30 dni', { windowStart: new Date(Date.now() + 60_000).toISOString(), windowEnd: new Date(Date.now() + 31 * 24 * HOUR).toISOString() }],
      ['początek w przeszłości (>5 min)', { windowStart: new Date(Date.now() - HOUR).toISOString(), windowEnd: new Date(Date.now() + HOUR).toISOString() }],
      ['okno całe w przeszłości', { windowStart: new Date(Date.now() - 3 * HOUR).toISOString(), windowEnd: new Date(Date.now() - HOUR).toISOString() }],
      ['nieprawidłowy identyfikator szablonu', { templateId: '../etc/passwd' }],
      ['nieprawidłowy typ grona', { audience: { type: 'EVERYONE' } }],
    ])('walidacja: %s => 400 i nic nie powstaje', async (_label, overrides) => {
      const body = { ...(await launchBody()), ...overrides };

      const response = await post(orgA.token, '/phishing/campaigns', body);

      expect(response.status).toBe(400);
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
      expect(queue.enqueued).toEqual([]);
    });

    it('spójność grona: ALL z listami, DEPARTMENTS bez listy, USERS z działami => INVALID_AUDIENCE; dział bez pracowników => NO_RECIPIENTS', async () => {
      const empty = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.department.create({ data: { organizationId: orgA.organizationId, name: 'Pusty' } }));

      const cases: [Record<string, unknown>, string][] = [
        [{ type: 'ALL', userIds: [orgA.users.s1] }, 'INVALID_AUDIENCE'],
        [{ type: 'DEPARTMENTS' }, 'INVALID_AUDIENCE'],
        [{ type: 'DEPARTMENTS', departmentIds: [orgA.departments.it], userIds: [orgA.users.s1] }, 'INVALID_AUDIENCE'],
        [{ type: 'USERS', userIds: [] }, 'INVALID_AUDIENCE'],
        [{ type: 'USERS', userIds: [orgA.users.s1], departmentIds: [orgA.departments.it] }, 'INVALID_AUDIENCE'],
        [{ type: 'USERS', userIds: ['nieistnieje'] }, 'INVALID_AUDIENCE'],
        [{ type: 'DEPARTMENTS', departmentIds: [empty.id] }, 'NO_RECIPIENTS'],
      ];
      for (const [audience, code] of cases) {
        const response = await post(orgA.token, '/phishing/campaigns', await launchBody({ audience }));
        expect([JSON.stringify(audience), response.status, response.body.code]).toEqual([JSON.stringify(audience), 400, code]);
      }
    });

    it('szablon niewidoczny dla organizacji (klon obcej organizacji) => 404', async () => {
      const foreign = (await post(orgB.token, `/phishing/templates/${await kurierTemplateId(orgB.token)}/clone`, { name: 'Klon B' }).expect(201)).body;

      const response = await post(orgA.token, '/phishing/campaigns', await launchBody({ templateId: foreign.id }));

      expect(response.status).toBe(404);
    });

    it('transport nieskonfigurowany => 409 TRANSPORT_NOT_CONFIGURED i nic nie powstaje', async () => {
      const spy = jest.spyOn(app.get(PhishingConfigService), 'status').mockReturnValue({
        transport: 'none', configured: false, reason: 'TRANSPORT_NOT_SELECTED', senderDomain: null, landingHost: null, sendsRealMail: false,
      });

      const response = await post(orgA.token, '/phishing/campaigns', await launchBody());
      spy.mockRestore();

      expect([response.status, response.body.code]).toEqual([409, 'TRANSPORT_NOT_CONFIGURED']);
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
    });

    it('limit aktywnych kampanii (10) => 409 TOO_MANY_ACTIVE_CAMPAIGNS', async () => {
      for (let i = 0; i < 10; i += 1) {
        await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      }

      const response = await post(orgA.token, '/phishing/campaigns', await launchBody());

      expect([response.status, response.body.code]).toEqual([409, 'TOO_MANY_ACTIVE_CAMPAIGNS']);
    });

    it('ponowione żądanie (podwójne kliknięcie): RÓWNOLEGŁE identyczne POST-y dają jedną kampanię, drugi dostaje 409 DUPLICATE_CAMPAIGN', async () => {
      const body = await launchBody({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });

      const responses = await settleAll([post(orgA.token, '/phishing/campaigns', body), post(orgA.token, '/phishing/campaigns', body), post(orgA.token, '/phishing/campaigns', body)]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'DUPLICATE_CAMPAIGN')).toBe(true);
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toHaveLength(1);
      expect(queue.enqueued).toHaveLength(1);
    });

    it('RÓWNOLEGŁE POST-y różnych kampanii nie obchodzą limitu aktywnych (10): dokładnie 10 powstaje', async () => {
      const bodies = await Promise.all(Array.from({ length: 14 }, async (_v, i) => launchBody({ name: `Równoległa ${i}`, audience: { type: 'USERS', userIds: [orgA.users.s1] } })));

      const responses = await settleAll(bodies.map((body) => post(orgA.token, '/phishing/campaigns', body)));

      expect(responses.filter((r) => r.status >= 500)).toEqual([]);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'TOO_MANY_ACTIVE_CAMPAIGNS')).toBe(true);
    });

    it('kolejność wysyłki nie wynika z kolejności odbiorców w bazie (czasy są tasowane)', async () => {
      // 5 odbiorców w kolejności założenia; przy braku tasowania scheduledAt rosłoby monotonicznie z createdAt w każdej kampanii.
      let monotonic = 0;
      for (let i = 0; i < 6; i += 1) {
        const body = await launchBody({ name: `Kolejność ${i}` });
        const response = await post(orgA.token, '/phishing/campaigns', body).expect(201);
        const list = await rows(orgA, response.body.id);
        const times = list.map((row) => row.scheduledAt.getTime());
        if (times.every((time, index) => index === 0 || time >= times[index - 1])) monotonic += 1;
      }

      expect(monotonic).toBeLessThan(6); // P(5 losowych czasów posortowanych) = 1/120 na kampanię
    });

    it('awaria kolejki przy starcie: kampania powstaje (201), a zadania dołoży zadanie uzgadniające', async () => {
      queue.failing = true;

      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.s2] } });
      queue.failing = false;

      expect(queue.enqueued).toEqual([]);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.phishingCampaignRecipient.updateMany({ where: { organizationId: orgA.organizationId, campaignId: campaign.id }, data: { scheduledAt: new Date(Date.now() - 10 * 60_000) } }),
      );
      await reconcile.reconcile(new Date());

      const mine = (await rows(orgA, campaign.id)).map((row) => row.id).sort();
      expect(queue.enqueued.filter((item) => mine.includes(item.recipientId)).map((item) => item.recipientId).sort()).toEqual(mine);
    });
  });

  describe('dobowy limit wysyłek (2 x seatsLimit, kroczące 24 h)', () => {
    const setSeats = (seats: number, org: Org = orgA) => prisma.organization.update({ where: { id: org.organizationId }, data: { seatsLimit: seats } });
    afterEach(async () => {
      await setSeats(1000);
      await setSeats(1000, orgB);
    });
    const users = (...labels: string[]) => ({ type: 'USERS', userIds: labels.map((label) => orgA.users[label]) });

    it('kampania przekraczająca limit => 409 DAILY_SEND_LIMIT z komunikatem (limit, wykorzystano, zostało); nic nie powstaje', async () => {
      await setSeats(2); // limit 4, a grono ALL to 5 osób

      const response = await post(orgA.token, '/phishing/campaigns', await launchBody());

      expect([response.status, response.body.code]).toEqual([409, 'DAILY_SEND_LIMIT']);
      expect(response.body.message).toMatch(/4 na dobę.*5 odbiorców.*byłoby 5 wysyłek \(już zaplanowanych: 0\)/);
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
      expect(queue.enqueued).toEqual([]);
    });

    it('limit sumuje kampanie z ostatnich 24 h; dokładnie do limitu przechodzi, powyżej nie', async () => {
      await setSeats(2); // limit 4
      await launch({ audience: users('s1', 's2', 'i1') }); // 3 z 4

      const over = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Druga', audience: users('s1', 's2') }));
      const exact = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Trzecia', audience: users('s1') }));

      expect([over.status, over.body.code]).toEqual([409, 'DAILY_SEND_LIMIT']);
      expect(over.body.message).toMatch(/byłoby 5 wysyłek \(już zaplanowanych: 3\)/);
      expect(exact.status).toBe(201); // 3 + 1 = 4
    });

    it('odbiorcy anulowani przed wysyłką nie zużywają limitu, a odbiorcy sprzed 24 h nie są liczeni', async () => {
      await setSeats(2); // limit 4
      const first = await launch({ audience: users('s1', 's2', 'i1') });
      await post(orgA.token, `/phishing/campaigns/${first.id}/cancel`).expect(200);

      const afterCancel = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Po anulowaniu', audience: users('s1', 's2', 'i1') }));
      expect(afterCancel.status).toBe(201);

      const blocked = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Zablokowana', audience: users('s1', 's2') }));
      expect(blocked.status).toBe(409);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.phishingCampaignRecipient.updateMany({ where: { organizationId: orgA.organizationId }, data: { scheduledAt: new Date(Date.now() - 25 * HOUR) } }),
      );
      const rolling = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Po dobie', audience: users('s1', 's2', 'i1') }));
      expect(rolling.status).toBe(201);
    });

    it('liczą się ZAPLANOWANE wysyłki, nie data utworzenia: kampanie tworzone w różne dni z tym samym oknem sumują się w dniu wysyłki', async () => {
      await setSeats(2); // limit 4
      const first = await launch({ audience: users('s1', 's2', 'i1') }); // 3 wysyłki w oknie najbliższych 2 h
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.phishingCampaignRecipient.updateMany({ where: { campaignId: first.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * HOUR), scheduledAt: new Date(Date.now() + HOUR) } }),
      );

      const sameDay = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'To samo okno', audience: users('s1', 's2') }));
      const nextWeek = await post(orgA.token, '/phishing/campaigns', await launchBody({ name: 'Za tydzień', audience: users('s1', 's2'), ...windowFromNow(7 * 24 * HOUR) }));

      expect([sameDay.status, sameDay.body.code]).toEqual([409, 'DAILY_SEND_LIMIT']);
      expect(nextWeek.status).toBe(201); // inna doba: limit dotyczy dowolnych 24 h, nie sumy całkowitej
    });

    it('limit dotyczy organizacji: wyczerpany limit A nie blokuje B (i odwrotnie), a RÓWNOLEGŁE żądania go nie obchodzą', async () => {
      await setSeats(2); // limit 4 dla A
      const bodies = await Promise.all([1, 2, 3].map((i) => launchBody({ name: `Równolegle ${i}`, audience: users('s1', 's2') })));

      const responses = await settleAll(bodies.map((body) => post(orgA.token, '/phishing/campaigns', body)));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(2); // 2 x 2 = 4, trzecia 409
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'DAILY_SEND_LIMIT')).toBe(true);
      const bResponse = await post(orgB.token, '/phishing/campaigns', await launchBody({ audience: { type: 'ALL' } }, orgB.token));
      expect(bResponse.status).toBe(201);
    });
  });

  describe('wysyłka jednego maila (sendOne): co najwyżej raz, idempotentna, race-safe', () => {
    async function oneRecipientCampaign(user = 's1') {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users[user]] } });
      const [recipient] = await rows(orgA, campaign.id);
      return { campaign, recipient };
    }

    it('happy path: mail idzie do właściwej osoby, link ma 43-znakowy token, w bazie tylko jego HASH, kampania RUNNING -> COMPLETED', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();

      const outcome = await sender.sendOne(orgA.organizationId, recipient.id, new Date());

      expect(outcome).toBe('SENT');
      expect(transport.sent).toHaveLength(1);
      const [message] = transport.sent;
      expect(message.toEmail).toBe(email('a-s1'));
      expect(message.fromEmail).toMatch(/@symulacje\.example\.test$/);
      const token = /https:\/\/landing\.example\.test\/t\/([A-Za-z0-9_-]{43})/.exec(message.html)?.[1];
      expect(token).toBeDefined();
      const [row] = await rows(orgA, campaign.id);
      expect(row).toMatchObject({ failedAt: null, failureCode: null, providerMessageId: 'provider-1', sendAttempts: 1 });
      expect(row.sentAt).not.toBeNull();
      expect(row.claimedAt).not.toBeNull();
      expect(row.tokenHash).toBe(sha256Hex(token as string));
      expect(JSON.stringify(row)).not.toContain(token as string); // sam token nigdzie w bazie
      const finished = await view(campaign.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.counts).toEqual({ total: 1, pending: 0, sent: 1, failed: 0, uncertain: 0 });
      expect((await campaignRow(orgA, campaign.id)).completedAt).not.toBeNull();
    });

    it('pierwsza wysyłka zmienia kampanię z SCHEDULED na RUNNING (gdy są jeszcze oczekujący)', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.s2] } });
      const [first] = await rows(orgA, campaign.id);

      await sender.sendOne(orgA.organizationId, first.id, new Date());

      const current = await view(campaign.id);
      expect(current.status).toBe('RUNNING');
      expect(current.counts).toMatchObject({ total: 2, sent: 1, pending: 1 });
    });

    it('RÓWNOLEGŁE wywołania dla tego samego odbiorcy: dokładnie jedno wywołanie transportu i jedno SENT', async () => {
      const { recipient } = await oneRecipientCampaign();

      const outcomes = await Promise.all(Array.from({ length: 8 }, () => sender.sendOne(orgA.organizationId, recipient.id, new Date())));

      expect(outcomes.filter((outcome) => outcome === 'SENT')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'SKIPPED')).toHaveLength(7);
      expect(transport.sent).toHaveLength(1);
    });

    it('powtórne uruchomienie po wysłaniu: SKIPPED, brak drugiego maila', async () => {
      const { recipient } = await oneRecipientCampaign();
      await sender.sendOne(orgA.organizationId, recipient.id, new Date());

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('SKIPPED');
      expect(transport.sent).toHaveLength(1);
    });

    it('błąd PRZEJŚCIOWY (wiadomo, że nic nie wyszło): zajęcie zwolnione, błąd oddany do ponowienia, kolejna próba wysyła', async () => {
      const { recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new PhishingTransportError('x', true, 'HTTP_429'));

      await expect(sender.sendOne(orgA.organizationId, recipient.id, new Date())).rejects.toMatchObject({ code: 'HTTP_429' });

      const [released] = await rows(orgA, recipient.campaignId);
      expect(released).toMatchObject({ claimedAt: null, tokenHash: null, sentAt: null, failedAt: null, sendAttempts: 1 });

      transport.next = null;
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('SENT');
      expect((await rows(orgA, recipient.campaignId))[0].sendAttempts).toBe(2);
    });

    it('błąd przejściowy do wyczerpania prób (3): odbiorca nieudany z kodem błędu, bez czwartej próby', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new PhishingTransportError('x', true, 'HTTP_429'));

      await expect(sender.sendOne(orgA.organizationId, recipient.id, new Date())).rejects.toBeInstanceOf(PhishingTransportError);
      await expect(sender.sendOne(orgA.organizationId, recipient.id, new Date())).rejects.toBeInstanceOf(PhishingTransportError);
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('SKIPPED');

      expect(transport.sent).toHaveLength(3);
      const [row] = await rows(orgA, campaign.id);
      expect(row).toMatchObject({ failureCode: 'HTTP_429', sendAttempts: 3, sentAt: null });
      expect((await view(campaign.id)).counts).toMatchObject({ failed: 1, uncertain: 0 });
    });

    it('TIMEOUT: NIE jest ponawiany - TIMEOUT_UNKNOWN, w szczegółach kampanii jako "niepewne", kolejne zadanie nie wysyła drugi raz', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new PhishingTransportError('Timeout', false, 'TIMEOUT_UNKNOWN'));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('SKIPPED');

      expect(transport.sent).toHaveLength(1);
      const current = await view(campaign.id);
      expect(current.counts).toMatchObject({ sent: 0, failed: 0, uncertain: 1, pending: 0 });
      expect(current.failures).toEqual([{ code: 'TIMEOUT_UNKNOWN', count: 1, uncertain: true }]);
      expect(current.status).toBe('COMPLETED');
    });

    it('błąd TRWAŁY (np. odrzucony adres): FAILED z kodem, liczony jako nieudane (nie "niepewne"), bez ponawiania', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new PhishingTransportError('x', false, 'HTTP_422'));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect(transport.sent).toHaveLength(1);
      expect((await view(campaign.id)).counts).toMatchObject({ failed: 1, uncertain: 0 });
    });

    it('nieoczekiwany błąd w transporcie: RESULT_UNKNOWN (niepewne), nie ponawiamy', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new TypeError('boom'));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect((await view(campaign.id)).failures).toEqual([{ code: 'RESULT_UNKNOWN', count: 1, uncertain: true }]);
    });

    it('uszkodzona treść snapshotu (brak linku): COMPOSE_FAILED PRZED wysyłką - transport nie jest wołany', async () => {
      const { campaign, recipient } = await oneRecipientCampaign();
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: campaign.id }, data: { bodyHtml: '<p>bez linku</p>' } }));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect(transport.sent).toHaveLength(0);
      expect((await view(campaign.id)).failures).toEqual([{ code: 'COMPOSE_FAILED', count: 1, uncertain: false }]);
    });

    it('zadanie ruszyło ZA WCZEŚNIE (przed zaplanowanym momentem): nic nie wysyła, odbiorca zostaje nietknięty, po terminie wysyłka działa', async () => {
      const { recipient } = await oneRecipientCampaign();
      const future = new Date(Date.now() + 30 * 60_000);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaignRecipient.update({ where: { id: recipient.id }, data: { scheduledAt: future } }));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('SKIPPED');

      expect(transport.sent).toHaveLength(0);
      expect((await rows(orgA, recipient.campaignId))[0]).toMatchObject({ claimedAt: null, tokenHash: null, sendAttempts: 0, failedAt: null });
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date(future.getTime() + 1000))).toBe('SENT');
    });

    it('pracownik zdezaktywowany (nie ACTIVE) po utworzeniu kampanii nie dostaje maila: RECIPIENT_REMOVED', async () => {
      const { campaign, recipient } = await oneRecipientCampaign('s1');
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users.s1 }, data: { status: 'INVITED' } }));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect(transport.sent).toHaveLength(0);
      expect((await view(campaign.id)).failures).toEqual([{ code: 'RECIPIENT_REMOVED', count: 1, uncertain: false }]);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users.s1 }, data: { status: 'ACTIVE' } }));
    });

    it.each([500, 502, 504])('HTTP %i od dostawcy: NIE ponawiane, liczone jako "niepewne" (bramka mogła przyjąć wiadomość)', async (status) => {
      const { campaign, recipient } = await oneRecipientCampaign();
      transport.next = () => Promise.reject(new PhishingTransportError('x', false, `HTTP_${status}`));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect((await view(campaign.id)).counts).toMatchObject({ uncertain: 1, failed: 0 });
      expect(transport.sent).toHaveLength(1);
    });

    it('koniec okna: po windowEnd + 15 min odbiorca NIE dostaje maila (WINDOW_EXPIRED); w okresie łaski jeszcze dostaje', async () => {
      const first = await oneRecipientCampaign('s1');
      const second = await oneRecipientCampaign('s2');
      const end = (await campaignRow(orgA, first.campaign.id)).windowEnd.getTime();

      expect(await sender.sendOne(orgA.organizationId, first.recipient.id, new Date(end + WINDOW_GRACE_MS + 1000))).toBe('FAILED');
      expect(await sender.sendOne(orgA.organizationId, second.recipient.id, new Date(end + WINDOW_GRACE_MS - 1000))).toBe('SENT');

      expect(transport.sent).toHaveLength(1);
      expect((await view(first.campaign.id)).failures).toEqual([{ code: 'WINDOW_EXPIRED', count: 1, uncertain: false }]);
    });

    it('pracownik usunięty przed wysyłką: RECIPIENT_REMOVED, wiersz wyniku zostaje (userId NULL, dział zachowany)', async () => {
      const { campaign, recipient } = await oneRecipientCampaign('i1');
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: orgA.users.i1 } }));

      const [afterDelete] = await rows(orgA, campaign.id);
      expect(afterDelete).toMatchObject({ userId: null, departmentName: 'it' });
      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect(transport.sent).toHaveLength(0);
      const current = await view(campaign.id);
      expect(current.counts.total).toBe(1);
      expect(current.failures).toEqual([{ code: 'RECIPIENT_REMOVED', count: 1, uncertain: false }]);
      // przywracamy pracownika dla kolejnych testów
      orgA.users.i1 = await addUser(orgA.organizationId, 'a-i1', orgA.departments.it);
    });

    it('usunięcie pracownika PO wysyłce zachowuje wynik (sentAt), userId zerowane', async () => {
      const { campaign, recipient } = await oneRecipientCampaign('s2');
      await sender.sendOne(orgA.organizationId, recipient.id, new Date());

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: orgA.users.s2 } }));

      const [row] = await rows(orgA, campaign.id);
      expect(row.userId).toBeNull();
      expect(row.sentAt).not.toBeNull();
      expect((await view(campaign.id)).counts.sent).toBe(1);
      orgA.users.s2 = await addUser(orgA.organizationId, 'a-s2', orgA.departments.sales);
    });

    it('zadanie z obcej organizacji: cudzy odbiorca nie jest widoczny ani wysyłany (SKIPPED, brak maila)', async () => {
      const { recipient } = await oneRecipientCampaign();

      const outcome = await sender.sendOne(orgB.organizationId, recipient.id, new Date());

      expect(outcome).toBe('SKIPPED');
      expect(transport.sent).toHaveLength(0);
      expect((await rows(orgA, recipient.campaignId))[0]).toMatchObject({ claimedAt: null, sentAt: null, failedAt: null });
    });
  });

  describe('anulowanie', () => {
    it('cancel: niewysłani => nieudani z kodem CANCELLED, zadania usunięte z kolejki, wysłani zostają; kolejne zadanie nic nie wysyła', async () => {
      const campaign = await launch({ audience: { type: 'ALL' } });
      const all = await rows(orgA, campaign.id);
      await sender.sendOne(orgA.organizationId, all[0].id, new Date());
      transport.sent = [];

      const cancelled = await post(orgA.token, `/phishing/campaigns/${campaign.id}/cancel`).expect(200);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.counts).toMatchObject({ total: 5, sent: 1, failed: 4, pending: 0 });
      expect(cancelled.body.failures).toEqual([{ code: 'CANCELLED', count: 4, uncertain: false }]);
      expect(queue.removed.sort()).toEqual(all.slice(1).map((row) => row.id).sort());
      for (const row of all.slice(1)) {
        expect(await sender.sendOne(orgA.organizationId, row.id, new Date())).toBe('SKIPPED');
      }
      expect(transport.sent).toHaveLength(0);
    });

    it('wyścig: kampania anulowana, ale zadanie jeszcze w kolejce (odbiorca bez wyniku) => zajęcie odrzucone warunkiem statusu, brak maila', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const [recipient] = await rows(orgA, campaign.id);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }));

      expect(await sender.sendOne(orgA.organizationId, recipient.id, new Date())).toBe('FAILED');

      expect(transport.sent).toHaveLength(0);
      expect((await view(campaign.id)).failures).toEqual([{ code: 'CANCELLED', count: 1, uncertain: false }]);
    });

    it('drugie anulowanie => 409, nieistniejąca kampania => 404', async () => {
      const campaign = await launch();
      await post(orgA.token, `/phishing/campaigns/${campaign.id}/cancel`).expect(200);

      expect((await post(orgA.token, `/phishing/campaigns/${campaign.id}/cancel`)).body.code).toBe('CAMPAIGN_NOT_ACTIVE');
      await post(orgA.token, '/phishing/campaigns/nieistnieje/cancel').expect(404);
      await post(orgA.token, '/phishing/campaigns/..%2F/cancel').expect(400); // identyfikator odrzucony zanim trafi do zapytania
    });

    it('zakończonej kampanii nie da się anulować (409)', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const [recipient] = await rows(orgA, campaign.id);
      await sender.sendOne(orgA.organizationId, recipient.id, new Date());

      const response = await post(orgA.token, `/phishing/campaigns/${campaign.id}/cancel`);

      expect([response.status, response.body.code]).toEqual([409, 'CAMPAIGN_NOT_ACTIVE']);
    });
  });

  describe('zadanie uzgadniające (reconcile)', () => {
    const now = () => new Date();

    it('zajęcie bez wyniku starsze niż 10 min => INTERRUPTED_UNKNOWN (niepewne, NIE ponawiane); świeże zajęcie nietknięte', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.s2] } });
      const [stale, fresh] = await rows(orgA, campaign.id);
      const current = now();
      await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) => {
        await tx.phishingCampaignRecipient.update({ where: { id: stale.id }, data: { claimedAt: new Date(current.getTime() - 11 * 60_000), tokenHash: 'h1' } });
        await tx.phishingCampaignRecipient.update({ where: { id: fresh.id }, data: { claimedAt: new Date(current.getTime() - 5 * 60_000), tokenHash: 'h2' } });
      });

      queue.enqueued = [];

      await reconcile.reconcile(current);

      const after = await rows(orgA, campaign.id);
      expect(after.find((row) => row.id === stale.id)).toMatchObject({ failureCode: 'INTERRUPTED_UNKNOWN', sentAt: null });
      expect(after.find((row) => row.id === fresh.id)).toMatchObject({ failedAt: null, failureCode: null });
      expect(queue.enqueued.map((item) => item.recipientId)).not.toContain(stale.id);
      expect(transport.sent).toHaveLength(0);
      expect((await view(campaign.id)).counts).toMatchObject({ uncertain: 1, pending: 1 });
    });

    it('zaległy odbiorca (>2 min po terminie, bez zajęcia) dostaje zadanie; nie-zaległy nie; powtórka jest bezpieczna (deduplikacja w kolejce)', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.s2] } });
      const [overdue, future] = await rows(orgA, campaign.id);
      const current = now();
      await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) => {
        await tx.phishingCampaignRecipient.update({ where: { id: overdue.id }, data: { scheduledAt: new Date(current.getTime() - 3 * 60_000) } });
        await tx.phishingCampaignRecipient.update({ where: { id: future.id }, data: { scheduledAt: new Date(current.getTime() + HOUR) } });
      });
      queue.enqueued = [];

      await reconcile.reconcile(current);
      await reconcile.reconcile(current);

      const mine = queue.enqueued.filter((item) => [overdue.id, future.id].includes(item.recipientId));
      expect(mine.map((item) => item.recipientId)).toEqual([overdue.id, overdue.id]); // dedup robi kolejka po jobId
      expect(mine.every((item) => item.delayMs === 0 && item.organizationId === orgA.organizationId)).toBe(true);
    });

    it('kampania ANULOWANA: wiszące zwolnione claimy => CANCELLED, stare zajęcia => INTERRUPTED_UNKNOWN (oczekujące schodzą do zera), nic nie jest ponawiane', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1, orgA.users.s2] } });
      const [dangling, stale] = await rows(orgA, campaign.id);
      const current = now();
      await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) => {
        await tx.phishingCampaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: new Date(current.getTime() - 60_000) } });
        await tx.phishingCampaignRecipient.update({ where: { id: stale.id }, data: { claimedAt: new Date(current.getTime() - 20 * 60_000), tokenHash: 'h3' } });
      });
      queue.enqueued = [];

      await reconcile.reconcile(current);

      const after = await rows(orgA, campaign.id);
      expect(after.find((row) => row.id === dangling.id)).toMatchObject({ failureCode: 'CANCELLED' });
      expect(after.find((row) => row.id === stale.id)).toMatchObject({ failureCode: 'INTERRUPTED_UNKNOWN' });
      expect((await view(campaign.id)).counts.pending).toBe(0);
      expect(queue.enqueued.filter((item) => [dangling.id, stale.id].includes(item.recipientId))).toEqual([]);
    });

    it('anulowana kampania sprzed ponad 7 dni nie jest już uzgadniana', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const [recipient] = await rows(orgA, campaign.id);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.phishingCampaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: new Date(Date.now() - 8 * 24 * HOUR) } }),
      );

      await reconcile.reconcile(now());

      expect((await rows(orgA, campaign.id))[0]).toMatchObject({ id: recipient.id, failedAt: null });
    });

    it('po końcu okna (+15 min) niewysłani => WINDOW_EXPIRED, a kampania COMPLETED', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const current = now();
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.phishingCampaign.update({ where: { id: campaign.id }, data: { windowStart: new Date(current.getTime() - 3 * HOUR), windowEnd: new Date(current.getTime() - HOUR) } }),
      );

      await reconcile.reconcile(current);

      const finished = await view(campaign.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.failures).toEqual([{ code: 'WINDOW_EXPIRED', count: 1, uncertain: false }]);
      expect(transport.sent).toHaveLength(0);
    });

    it('kampania, w której wszyscy mają wynik, ale status został RUNNING => COMPLETED', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) => {
        await tx.phishingCampaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
        await tx.phishingCampaignRecipient.updateMany({ where: { campaignId: campaign.id }, data: { failedAt: new Date(), failureCode: 'HTTP_422' } });
      });

      await reconcile.reconcile(now());

      expect((await view(campaign.id)).status).toBe('COMPLETED');
    });

    it('izolacja A/B: kampanie obu organizacji są uzgadniane we własnym kontekście, a błąd jednej nie blokuje drugiej', async () => {
      const campaignA = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const campaignB = await launch({ audience: { type: 'USERS', userIds: [orgB.users.h1] }, templateId: await kurierTemplateId(orgB.token) }, orgB);
      const current = now();
      for (const [org, campaign] of [[orgA, campaignA], [orgB, campaignB]] as const) {
        await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
          tx.phishingCampaignRecipient.updateMany({ where: { campaignId: campaign.id }, data: { scheduledAt: new Date(current.getTime() - 10 * 60_000) } }),
        );
      }
      const original = queue.enqueue.bind(queue);
      jest.spyOn(queue, 'enqueue').mockImplementation(async (items) => {
        if (items.some((item) => item.organizationId === orgA.organizationId)) throw new Error('awaria dla A');
        return original(items);
      });
      queue.enqueued = [];

      const report = await reconcile.reconcile(current);
      jest.restoreAllMocks();
      jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

      expect(report.errors).toBeGreaterThanOrEqual(1);
      const [rowB] = await rows(orgB, campaignB.id);
      expect(queue.enqueued).toContainEqual({ organizationId: orgB.organizationId, recipientId: rowB.id, delayMs: 0 });
      const [rowA] = await rows(orgA, campaignA.id);
      expect(queue.enqueued.map((item) => item.recipientId)).not.toContain(rowA.id);
    });
  });

  describe('izolacja tenantów (Zasada nr 1)', () => {
    it('B nie widzi kampanii A (lista, szczegóły, anulowanie) i nie może jej zmienić', async () => {
      const campaign = await launch();

      expect((await get(orgB.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
      await get(orgB.token, `/phishing/campaigns/${campaign.id}`).expect(404);
      await post(orgB.token, `/phishing/campaigns/${campaign.id}/cancel`).expect(404);
      expect((await view(campaign.id)).status).toBe('SCHEDULED');
      expect(queue.removed).toEqual([]);
    });

    it('obce identyfikatory pracowników i działów => INVALID_AUDIENCE (w kampanii i w podglądzie grona); nic nie powstaje', async () => {
      const foreignUsers = { type: 'USERS', userIds: [orgB.users.h1] };
      const foreignDepartments = { type: 'DEPARTMENTS', departmentIds: [orgB.departments.hr] };
      const mixed = { type: 'USERS', userIds: [orgA.users.s1, orgB.users.h1] };

      for (const audience of [foreignUsers, foreignDepartments, mixed]) {
        const create = await post(orgA.token, '/phishing/campaigns', await launchBody({ audience }));
        const preview = await post(orgA.token, '/phishing/campaigns/audience', { audience });
        expect([create.status, create.body.code, preview.status, preview.body.code]).toEqual([400, 'INVALID_AUDIENCE', 400, 'INVALID_AUDIENCE']);
      }
      expect((await get(orgA.token, '/phishing/campaigns').expect(200)).body).toEqual([]);
    });

    it('grono ALL obejmuje wyłącznie własną organizację (podgląd B liczy tylko B)', async () => {
      const preview = await post(orgB.token, '/phishing/campaigns/audience', { audience: { type: 'ALL' } }).expect(200);

      expect(preview.body.count).toBe(2); // admin B + h1
    });

    it('RLS w bazie (bez filtra w kodzie): kontekst B widzi/zmienia/usuwa 0 wierszy A; INSERT w cudzej organizacji odrzucony', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      const [recipient] = await rows(orgA, campaign.id);

      const result = await tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => ({
        campaigns: await tx.phishingCampaign.findMany(),
        recipients: await tx.phishingCampaignRecipient.findMany(),
        updatedCampaigns: (await tx.phishingCampaign.updateMany({ data: { name: 'HACK' } })).count,
        updatedRecipients: (await tx.phishingCampaignRecipient.updateMany({ data: { failedAt: new Date(), failureCode: 'HACK' } })).count,
        deletedRecipients: (await tx.phishingCampaignRecipient.deleteMany()).count,
        deletedCampaigns: (await tx.phishingCampaign.deleteMany()).count,
      }));

      expect(result).toMatchObject({ campaigns: [], recipients: [], updatedCampaigns: 0, updatedRecipients: 0, deletedRecipients: 0, deletedCampaigns: 0 });
      expect((await campaignRow(orgA, campaign.id)).name).toBe('Kampania testowa');
      expect((await rows(orgA, campaign.id))[0]).toMatchObject({ id: recipient.id, failedAt: null });
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.phishingCampaign.create({ data: { organizationId: orgA.organizationId, name: 'x', audienceType: 'ALL', templateName: 't', subject: 's', bodyHtml: 'b', lessonHtml: 'l', senderName: 'n', senderLocalPart: 'p', windowStart: new Date(), windowEnd: new Date(Date.now() + HOUR), createdByEmail: 'x@x.pl' } }),
        ),
      ).rejects.toThrow();
    });

    it('bypass (runCrossOrgQuery) pozwala tylko ODCZYTAĆ kampanie; odbiorców w ogóle nie widzi i niczego nie zmieni ani nie usunie', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });

      const result = await tenantPrisma.runCrossOrgQuery(async (tx) => ({
        visible: (await tx.phishingCampaign.findMany({ where: { id: campaign.id }, select: { id: true } })).length,
        recipients: await tx.phishingCampaignRecipient.count({ where: { campaignId: campaign.id } }),
        updated: (await tx.phishingCampaign.updateMany({ where: { id: campaign.id }, data: { name: 'HACK' } })).count,
        deleted: (await tx.phishingCampaign.deleteMany({ where: { id: campaign.id } })).count,
        recipientsUpdated: (await tx.phishingCampaignRecipient.updateMany({ where: { campaignId: campaign.id }, data: { failedAt: new Date(), failureCode: 'HACK' } })).count,
        recipientsDeleted: (await tx.phishingCampaignRecipient.deleteMany({ where: { campaignId: campaign.id } })).count,
      }));

      // Odbiorców kampanii generyczny bypass NIE widzi (osobny sentinel lookupu tokenu), a kampanie tylko odczytuje.
      expect(result).toEqual({ visible: 1, recipients: 0, updated: 0, deleted: 0, recipientsUpdated: 0, recipientsDeleted: 0 });
      expect((await campaignRow(orgA, campaign.id)).name).toBe('Kampania testowa');
    });

    it('złożone FK: odbiorca ani autor kampanii nie mogą wskazywać użytkownika innej organizacji', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });

      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
          tx.phishingCampaignRecipient.create({ data: { organizationId: orgA.organizationId, campaignId: campaign.id, userId: orgB.users.h1, scheduledAt: new Date() } }),
        ),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: campaign.id }, data: { createdByUserId: orgB.users.h1 } })),
      ).rejects.toThrow(/foreign key/i);
    });

    it('złożone FK kampanii: odbiorca organizacji B nie może należeć do kampanii organizacji A', async () => {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });

      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.phishingCampaignRecipient.create({ data: { organizationId: orgB.organizationId, campaignId: campaign.id, userId: orgB.users.h1, scheduledAt: new Date() } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('niezmienniki w bazie ("co najwyżej raz")', () => {
    async function firstRecipient() {
      const campaign = await launch({ audience: { type: 'USERS', userIds: [orgA.users.s1] } });
      return (await rows(orgA, campaign.id))[0];
    }
    const update = (id: string, data: Record<string, unknown>) =>
      tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaignRecipient.update({ where: { id }, data }));

    it('wynik jest jeden: sentAt i failedAt naraz => odrzucone przez CHECK', async () => {
      const recipient = await firstRecipient();

      await expect(update(recipient.id, { claimedAt: new Date(), tokenHash: 'x1', sentAt: new Date(), failedAt: new Date(), failureCode: 'X' })).rejects.toThrow(/check constraint/i);
    });

    it('failedAt bez failureCode (i odwrotnie) => odrzucone', async () => {
      const recipient = await firstRecipient();

      await expect(update(recipient.id, { failedAt: new Date() })).rejects.toThrow(/check constraint/i);
      await expect(update(recipient.id, { failureCode: 'X' })).rejects.toThrow(/check constraint/i);
    });

    it('sentAt bez wcześniejszego zajęcia (claimedAt/tokenHash) => odrzucone', async () => {
      const recipient = await firstRecipient();

      await expect(update(recipient.id, { sentAt: new Date() })).rejects.toThrow(/check constraint/i);
    });

    it('jeden odbiorca na osobę w kampanii (unikalność) i okno end > start', async () => {
      const recipient = await firstRecipient();

      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
          tx.phishingCampaignRecipient.create({ data: { organizationId: orgA.organizationId, campaignId: recipient.campaignId, userId: recipient.userId, scheduledAt: new Date() } }),
        ),
      ).rejects.toThrow(/unique/i);
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: recipient.campaignId }, data: { windowEnd: new Date(0) } })),
      ).rejects.toThrow(/check constraint/i);
    });

    it('usunięcie organizacji kasuje kampanie i odbiorców (kaskada; sprzątanie PENDING się nie zatnie)', async () => {
      const { body } = await registerVerified(app, tenantPrisma, { email: email('cascade'), password: DEFAULT_TEST_PASSWORD });
      const admin = await tenantPrisma.runAuthLookup({ email: email('cascade') });
      const organizationId = admin!.organizationId;
      const created = await post(body.accessToken, '/phishing/campaigns', await launchBody({}, body.accessToken)).expect(201);

      await prisma.organization.delete({ where: { id: organizationId } });

      const left = await tenantPrisma.runCrossOrgQuery((tx) => tx.phishingCampaign.count({ where: { id: created.body.id } }));
      expect(left).toBe(0);
    });
  });
});
