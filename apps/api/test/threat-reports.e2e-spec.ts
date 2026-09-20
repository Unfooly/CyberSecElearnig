import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { sha256Hex } from '../src/phishing/token-hash';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { CONTENT_RETENTION_DAYS, ThreatReportRetentionService } from '../src/threat-reports/threat-report-retention.service';
import { REPORTS_PER_HOUR } from '../src/threat-reports/threat-reports.service';
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from './helpers/auth';

const DAY = 24 * 3_600_000;
const SENDER_DOMAIN = 'symulacje.example.test';
const CAMPAIGN_SUBJECT = 'Twoja paczka czeka na odbiór';

describe('Zgłaszanie podejrzanych wiadomości (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let retention: ThreatReportRetentionService;
  let owner: PrismaClient;

  const suffix = Date.now();
  const domainSuffix = 'threat-reports-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;

  type Person = { id: string; token: string };
  type Org = { organizationId: string; departmentId: string; campaignId: string; adminToken: string; users: Record<string, Person> };
  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = SENDER_DOMAIN;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    retention = app.get(ThreatReportRetentionService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    orgA = await newOrg('a', ['e1', 'e2', 'e3', 'spam1', 'spam2']);
    orgB = await newOrg('b', ['b1']);
  }, 60_000);

  afterAll(async () => {
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  });

  // Każdy test zaczyna od czystych zgłoszeń i odbiorców (limity per użytkownik i dopasowanie zależą od historii).
  // Rola aplikacji nie ma DELETE na threat_reports (celowo), więc sprzątamy jako właściciel schematu.
  afterEach(async () => {
    const organizationIds = [orgA.organizationId, orgB.organizationId];
    await owner.threatReport.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await owner.phishingCampaignRecipient.deleteMany({ where: { organizationId: { in: organizationIds } } });
  });

  async function newOrg(label: string, members: string[]): Promise<Org> {
    const { organizationId } = await createVerifiedUser(app, tenantPrisma, { email: email(label), password: DEFAULT_TEST_PASSWORD });
    const department = await tenantPrisma.runInOrgContext(organizationId, (tx) => tx.department.create({ data: { organizationId, name: 'Finanse' } }));
    const admin = await request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);
    const users: Record<string, Person> = {};
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
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email(`${label}-${member}`), password: DEFAULT_TEST_PASSWORD }).expect(200);
      users[member] = { id: user.id, token: login.body.accessToken };
    }
    const campaign = await newCampaign(organizationId, 'RUNNING', CAMPAIGN_SUBJECT);
    return { organizationId, departmentId: department.id, campaignId: campaign.id, adminToken: admin.body.accessToken, users };
  }

  function newCampaign(organizationId: string, status: 'RUNNING' | 'CANCELLED' | 'COMPLETED', subject: string) {
    return tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId,
          name: `Kampania ${subject}`,
          status,
          audienceType: 'ALL',
          templateName: 'Kurier',
          subject,
          bodyHtml: '<p><a href="{{trackingLink}}">Odbierz</a></p>',
          lessonHtml: '<p>Lekcja</p>',
          senderName: 'Kurier',
          senderLocalPart: 'kurier',
          windowStart: new Date(Date.now() - DAY),
          windowEnd: new Date(Date.now() + DAY),
          createdByEmail: 'x@example.test',
        },
      }),
    );
  }

  /** Odbiorca kampanii z ZNANYM tokenem (w bazie tylko hash), po wysyłce. */
  async function recipient(org: Org, userLabel: string, overrides: { campaignId?: string; sentAt?: Date | null } = {}) {
    const token = randomBytes(32).toString('base64url');
    const row = await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaignRecipient.create({
        data: {
          organizationId: org.organizationId,
          campaignId: overrides.campaignId ?? org.campaignId,
          userId: org.users[userLabel].id,
          scheduledAt: new Date(Date.now() - 60_000),
          claimedAt: new Date(),
          sentAt: overrides.sentAt === undefined ? new Date() : overrides.sentAt,
          tokenHash: sha256Hex(token),
        },
      }),
    );
    return { token, id: row.id };
  }

  const report = (token: string, body: Record<string, unknown>) => request(app.getHttpServer()).post('/threat-reports').set('Authorization', `Bearer ${token}`).send(body);
  const realReport = (overrides: Record<string, unknown> = {}) => ({
    sender: 'Ktoś Obcy <obcy@zlosliwa-domena.example>',
    subject: 'Pilna faktura do zapłaty',
    body: 'Kliknij tutaj, aby zapłacić.',
    headers: 'Received: from mail.zlosliwa-domena.example',
    comment: 'Wygląda podejrzanie',
    ...overrides,
  });
  const reportRow = (org: Org, id: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.threatReport.findFirstOrThrow({ where: { id, organizationId: org.organizationId } }));
  const reportedAt = async (org: Org, recipientId: string) =>
    (await tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaignRecipient.findFirstOrThrow({ where: { id: recipientId, organizationId: org.organizationId } }))).reportedAt;
  const countReports = (org: Org, userLabel: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.threatReport.count({ where: { organizationId: org.organizationId, reporterUserId: org.users[userLabel].id } }));

  describe('prawdziwe zgłoszenie', () => {
    it('zapisuje treść, nagłówki i komentarz oraz dział zgłaszającego; nie ustawia dopasowania', async () => {
      const response = await report(orgA.users.e1.token, realReport()).expect(201);

      expect(response.body).toEqual({ id: expect.any(String), isSimulation: false });
      const row = await reportRow(orgA, response.body.id);
      expect(row).toMatchObject({
        kind: 'REAL',
        status: 'NEW',
        reporterUserId: orgA.users.e1.id,
        reporterDepartmentId: orgA.departmentId,
        subject: 'Pilna faktura do zapłaty',
        body: 'Kliknij tutaj, aby zapłacić.',
        headers: 'Received: from mail.zlosliwa-domena.example',
        comment: 'Wygląda podejrzanie',
        matchedRecipientId: null,
        matchMethod: null,
      });
    });

    it('zapisuje domenę nadawcy małymi literami (do statystyk); bez adresu w polu nadawcy domena jest pusta', async () => {
      const withAddress = await report(orgA.users.e1.token, realReport({ sender: 'Ktoś <Obcy@Zlosliwa-Domena.EXAMPLE>' })).expect(201);
      const withoutAddress = await report(orgA.users.e1.token, realReport({ sender: 'Sam Nadawca Bez Adresu' })).expect(201);

      expect((await reportRow(orgA, withAddress.body.id)).senderDomain).toBe('zlosliwa-domena.example');
      expect((await reportRow(orgA, withoutAddress.body.id)).senderDomain).toBeNull();
    });

    it('sanityzuje do czystego tekstu: znaki sterujące i nadpisania kierunku znikają, HTML zostaje tekstem', async () => {
      const response = await report(orgA.users.e1.token, realReport({ subject: 'Temat\u0000 z‮ dziwnym\nznakiem', body: '<script>alert(1)</script>\u0007ok' })).expect(201);

      const row = await reportRow(orgA, response.body.id);
      expect(row.subject).toBe('Temat z dziwnym znakiem');
      expect(row.body).toBe('<script>alert(1)</script>ok');
    });

    it('maskuje linki śledzące w KAŻDYM polu: token cudzego odbiorcy nie trafia do bazy zgłoszeń', async () => {
      const victim = await recipient(orgA, 'e2');
      const link = `https://firma.example/t/${victim.token}`;

      const response = await report(orgA.users.e1.token, realReport({ body: `Dostałem ${link}`, headers: `X-Link: ${link}`, comment: link })).expect(201);

      expect(response.body.isSimulation).toBe(false); // cudzy token nie daje dopasowania
      const row = await reportRow(orgA, response.body.id);
      for (const field of [row.body, row.headers, row.comment, row.subject, row.senderText]) {
        expect(field ?? '').not.toContain(victim.token);
      }
      expect(row.body).toContain('/t/[token-usuniety]');
      expect(await reportedAt(orgA, victim.id)).toBeNull(); // cudza symulacja nie została "zgłoszona" za e2
    });
  });

  describe('linki przepisane przez bramki poczty (zakodowany ukośnik)', () => {
    const safeLink = (token: string) => `https://safelinks.example/?url=https%3A%2F%2Ffirma.example%2Ft%2F${token}&data=abc`;

    it('cudzy token w zakodowanym linku jest maskowany w bazie (nie wycieka do skrzynki zgłoszeń) i niczego nie dopasowuje', async () => {
      const victim = await recipient(orgA, 'e2');

      const response = await report(orgA.users.e1.token, realReport({ body: safeLink(victim.token), headers: safeLink(victim.token) })).expect(201);

      expect(response.body.isSimulation).toBe(false);
      const row = await reportRow(orgA, response.body.id);
      expect(row.body).not.toContain(victim.token);
      expect(row.headers).not.toContain(victim.token);
      expect(await reportedAt(orgA, victim.id)).toBeNull();
    });

    it('WŁASNY token w zakodowanym linku dopasowuje symulację (TOKEN)', async () => {
      const own = await recipient(orgA, 'e1');

      const response = await report(orgA.users.e1.token, realReport({ body: safeLink(own.token) })).expect(201);

      expect(response.body.isSimulation).toBe(true);
      expect(await reportRow(orgA, response.body.id)).toMatchObject({ kind: 'SIMULATION', matchMethod: 'TOKEN', matchedRecipientId: own.id, body: null });
    });
  });

  describe('dopasowanie do symulacji', () => {
    it('token własnego odbiorcy w tekście: symulacja (TOKEN), treść, nagłówki i komentarz NIE są zapisywane, reportedAt ustawione', async () => {
      const own = await recipient(orgA, 'e1');

      const response = await report(orgA.users.e1.token, realReport({ body: `Link: https://firma.example/t/${own.token}` })).expect(201);

      expect(response.body.isSimulation).toBe(true);
      const row = await reportRow(orgA, response.body.id);
      expect(row).toMatchObject({ kind: 'SIMULATION', matchMethod: 'TOKEN', matchedRecipientId: own.id, body: null, headers: null, comment: null });
      expect(row.subject).toBe('Pilna faktura do zapłaty'); // temat i nadawca zostają
      expect(row.senderText).toContain('obcy@zlosliwa-domena.example');
      expect(await reportedAt(orgA, own.id)).toBeInstanceOf(Date);
    });

    it('dokładny nadawca ORAZ temat (po normalizacji Re:/wielkości liter): symulacja (SENDER_SUBJECT)', async () => {
      const own = await recipient(orgA, 'e1');

      const response = await report(orgA.users.e1.token, {
        sender: `Kurier Ekspres <KURIER@${SENDER_DOMAIN}>`,
        subject: `RE:  TWOJA paczka czeka  na odbiór`,
        body: 'treść',
        comment: 'komentarz',
      }).expect(201);

      expect(response.body.isSimulation).toBe(true);
      expect(await reportRow(orgA, response.body.id)).toMatchObject({ kind: 'SIMULATION', matchMethod: 'SENDER_SUBJECT', matchedRecipientId: own.id, body: null, comment: null });
      expect(await reportedAt(orgA, own.id)).toBeInstanceOf(Date);
    });

    it.each([
      ['sam nadawca (inny temat)', { sender: `kurier@${SENDER_DOMAIN}`, subject: 'Zupełnie inny temat' }],
      ['sam temat (inny nadawca)', { sender: 'obcy@zlosliwa-domena.example', subject: CAMPAIGN_SUBJECT }],
      ['nadawca z inną domeną niż nasza', { sender: 'kurier@inna-domena.example', subject: CAMPAIGN_SUBJECT }],
      ['nadawca bez adresu (samo imię)', { sender: 'Kurier', subject: CAMPAIGN_SUBJECT }],
      ['inna część lokalna', { sender: `ktos@${SENDER_DOMAIN}`, subject: CAMPAIGN_SUBJECT }],
    ])('NIE dopasowuje: %s', async (_label, fields) => {
      const own = await recipient(orgA, 'e1');

      const response = await report(orgA.users.e1.token, { ...fields, body: 'treść' }).expect(201);

      expect(response.body.isSimulation).toBe(false);
      expect(await reportedAt(orgA, own.id)).toBeNull();
      expect((await reportRow(orgA, response.body.id)).body).toBe('treść');
    });

    it('nie dopasowuje, gdy zgłaszający NIE był adresatem (cudza symulacja tej samej kampanii)', async () => {
      await recipient(orgA, 'e2'); // e2 dostał, e3 nie

      const response = await report(orgA.users.e3.token, { sender: `kurier@${SENDER_DOMAIN}`, subject: CAMPAIGN_SUBJECT }).expect(201);

      expect(response.body.isSimulation).toBe(false);
    });

    it('nie dopasowuje starszej niż 30 dni, niewysłanej ani anulowanej kampanii (po nadawcy i temacie)', async () => {
      const old = await recipient(orgA, 'e1', { sentAt: new Date(Date.now() - 31 * DAY) });
      const unsent = await recipient(orgA, 'e2', { sentAt: null });
      const cancelled = await newCampaign(orgA.organizationId, 'CANCELLED', 'Anulowana kampania');
      await recipient(orgA, 'e3', { campaignId: cancelled.id });

      const oldReport = await report(orgA.users.e1.token, { sender: `kurier@${SENDER_DOMAIN}`, subject: CAMPAIGN_SUBJECT }).expect(201);
      const unsentReport = await report(orgA.users.e2.token, { sender: `kurier@${SENDER_DOMAIN}`, subject: CAMPAIGN_SUBJECT }).expect(201);
      const cancelledReport = await report(orgA.users.e3.token, { sender: `kurier@${SENDER_DOMAIN}`, subject: 'Anulowana kampania' }).expect(201);

      expect([oldReport, unsentReport, cancelledReport].map((r) => r.body.isSimulation)).toEqual([false, false, false]);
      expect(await reportedAt(orgA, old.id)).toBeNull();
      expect(await reportedAt(orgA, unsent.id)).toBeNull();
    });

    it('reportedAt ustawiane RAZ: kolejne zgłoszenie tej samej wiadomości go nie zmienia', async () => {
      const own = await recipient(orgA, 'e1');
      await report(orgA.users.e1.token, realReport({ body: `https://f.example/t/${own.token}` })).expect(201);
      const first = await reportedAt(orgA, own.id);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const again = await report(orgA.users.e1.token, realReport({ body: `https://f.example/t/${own.token}` })).expect(201);

      expect(again.body.isSimulation).toBe(true);
      expect(await reportedAt(orgA, own.id)).toEqual(first);
    });
  });

  describe('walidacja i limity', () => {
    it('401 bez tokenu; 400 dla braku wymaganych pól, nieznanego pola i zbyt długich pól', async () => {
      await request(app.getHttpServer()).post('/threat-reports').send(realReport()).expect(401);
      await report(orgA.users.e1.token, { subject: 'x' }).expect(400);
      await report(orgA.users.e1.token, realReport({ nieznane: 1 })).expect(400);
      await report(orgA.users.e1.token, realReport({ body: 'a'.repeat(20_001) })).expect(400);
      await report(orgA.users.e1.token, realReport({ headers: 'a'.repeat(20_001) })).expect(400);
      await report(orgA.users.e1.token, realReport({ subject: 'a'.repeat(301) })).expect(400);
      await report(orgA.users.e1.token, realReport({ comment: 'a'.repeat(1001) })).expect(400);
      await report(orgA.users.e1.token, realReport({ sender: 'a'.repeat(321) })).expect(400);
      expect(await countReports(orgA, 'e1')).toBe(0);
    });

    it('400 REPORT_INVALID, gdy nadawca lub temat po sanityzacji są puste', async () => {
      const response = await report(orgA.users.e1.token, realReport({ sender: '\u0000​', subject: 'ok' })).expect(400);

      expect(response.body.code).toBe('REPORT_INVALID');
    });

    it('limit na użytkownika: po 5 zgłoszeniach w godzinie kolejne dostaje 429 REPORT_RATE_LIMIT, inny użytkownik nie jest blokowany', async () => {
      for (let i = 0; i < REPORTS_PER_HOUR; i += 1) {
        await report(orgA.users.spam1.token, realReport({ subject: `Zgłoszenie ${i}` })).expect(201);
      }

      const blocked = await report(orgA.users.spam1.token, realReport()).expect(429);

      expect(blocked.body.code).toBe('REPORT_RATE_LIMIT');
      expect(await countReports(orgA, 'spam1')).toBe(REPORTS_PER_HOUR);
      await report(orgA.users.e2.token, realReport()).expect(201);
    });

    it('RÓWNOLEGŁE zgłoszenia nie obchodzą limitu: powstaje dokładnie 5', async () => {
      const responses = await Promise.allSettled(Array.from({ length: 8 }, (_v, i) => report(orgA.users.spam2.token, realReport({ subject: `Równolegle ${i}` }))));

      const statuses = responses.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
      expect(statuses.filter((s) => s === 201)).toHaveLength(REPORTS_PER_HOUR);
      expect(statuses.filter((s) => s === 429)).toHaveLength(3);
      expect(await countReports(orgA, 'spam2')).toBe(REPORTS_PER_HOUR);
    });

    it('organizacja PENDING (niezweryfikowana domena) dostaje 403', async () => {
      const pending = await createVerifiedUser(app, tenantPrisma, { email: email('pending'), password: DEFAULT_TEST_PASSWORD }, { activateOrganization: false });
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email('pending'), password: DEFAULT_TEST_PASSWORD }).expect(200);

      await report(login.body.accessToken, realReport()).expect(403);
      expect(pending.organizationId).toBeDefined();
    });
  });

  describe('izolacja organizacji (Zasada nr 1)', () => {
    it('token z organizacji A użyty przez pracownika B nie dopasowuje i nie zmienia odbiorcy A; zgłoszenia B są niewidoczne w A i odwrotnie', async () => {
      const own = await recipient(orgA, 'e1');

      const foreign = await report(orgB.users.b1.token, realReport({ body: `https://f.example/t/${own.token}` })).expect(201);
      const local = await report(orgA.users.e2.token, realReport()).expect(201);

      expect(foreign.body.isSimulation).toBe(false);
      expect(await reportedAt(orgA, own.id)).toBeNull();
      // RLS: w kontekście B nie ma zgłoszeń A i odwrotnie (także bez filtra organizationId w zapytaniu).
      const seenByB = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.threatReport.findMany({ select: { id: true } }));
      const seenByA = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReport.findMany({ select: { id: true } }));
      expect(seenByB.map((r) => r.id)).toContain(foreign.body.id);
      expect(seenByB.map((r) => r.id)).not.toContain(local.body.id);
      expect(seenByA.map((r) => r.id)).toContain(local.body.id);
      expect(seenByA.map((r) => r.id)).not.toContain(foreign.body.id);
    });

    it('rola aplikacji nie może wstawić zgłoszenia do cudzej organizacji ani usunąć zgłoszenia (RLS, REVOKE DELETE)', async () => {
      const created = await report(orgA.users.e1.token, realReport()).expect(201);

      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.threatReport.create({ data: { organizationId: orgA.organizationId, kind: 'REAL', senderText: 'x', subject: 'x' } }),
        ),
      ).rejects.toThrow();
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReport.deleteMany({ where: { id: created.body.id } }))).rejects.toThrow();
    });
  });

  describe('gwarancje bazy danych', () => {
    it('CHECK: zgłoszenie symulacyjne nie może przechowywać treści, nagłówków ani komentarza (nawet przy błędzie w kodzie)', async () => {
      const own = await recipient(orgA, 'e1');
      const base = { organizationId: orgA.organizationId, kind: 'SIMULATION' as const, senderText: 'x', subject: 'x', matchMethod: 'TOKEN' as const, matchedRecipientId: own.id };

      for (const content of [{ body: 'x' }, { headers: 'x' }, { comment: 'x' }]) {
        await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReport.create({ data: { ...base, ...content } }))).rejects.toThrow();
      }
      // matchMethod ustawiony tylko dla symulacji
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.threatReport.create({ data: { organizationId: orgA.organizationId, kind: 'REAL', senderText: 'x', subject: 'x', matchMethod: 'TOKEN' } })),
      ).rejects.toThrow();
    });

    it('złożone FK: nie da się powiązać zgłoszenia z odbiorcą ani zgłaszającym z INNEJ organizacji', async () => {
      const own = await recipient(orgA, 'e1');

      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.threatReport.create({ data: { organizationId: orgB.organizationId, kind: 'SIMULATION', senderText: 'x', subject: 'x', matchMethod: 'TOKEN', matchedRecipientId: own.id } }),
        ),
      ).rejects.toThrow();
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.threatReport.create({ data: { organizationId: orgB.organizationId, kind: 'REAL', senderText: 'x', subject: 'x', reporterUserId: orgA.users.e1.id } }),
        ),
      ).rejects.toThrow();
    });

    it('usunięcie konta zgłaszającego zeruje reporterUserId, a zgłoszenie zostaje', async () => {
      const temp = await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) =>
        tx.user.create({ data: { organizationId: orgA.organizationId, email: email('a-temp'), passwordHash: 'x', role: 'EMPLOYEE', status: 'ACTIVE' } }),
      );
      const created = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.threatReport.create({ data: { organizationId: orgA.organizationId, kind: 'REAL', senderText: 'x', subject: 'x', reporterUserId: temp.id } }),
      );

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: temp.id } }));

      expect(await reportRow(orgA, created.id)).toMatchObject({ reporterUserId: null });
    });
  });

  describe('retencja treści (90 dni)', () => {
    const insert = (org: Org, kind: 'REAL' | 'SIMULATION', ageDays: number, extra: Record<string, unknown> = {}) =>
      tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
        tx.threatReport.create({
          data: {
            organizationId: org.organizationId,
            kind,
            senderText: 'obcy@example.test',
            senderDomain: 'example.test',
            subject: 'Temat',
            createdAt: new Date(Date.now() - ageDays * DAY),
            ...(kind === 'REAL' ? { body: 'treść', headers: 'nagłówki', comment: 'komentarz' } : {}),
            ...extra,
          },
        }),
      );

    it('czyści body/headers/comment prawdziwych zgłoszeń starszych niż 90 dni we WSZYSTKICH organizacjach; zostawia temat, nadawcę i młodsze zgłoszenia; jest idempotentna', async () => {
      const oldA = await insert(orgA, 'REAL', CONTENT_RETENTION_DAYS + 1);
      const freshA = await insert(orgA, 'REAL', CONTENT_RETENTION_DAYS - 1);
      const oldB = await insert(orgB, 'REAL', CONTENT_RETENTION_DAYS + 5);
      const simulation = await insert(orgA, 'SIMULATION', CONTENT_RETENTION_DAYS + 30, { matchMethod: 'TOKEN' });
      const now = new Date();

      const first = await retention.run(now);
      const second = await retention.run(now);

      expect(first.purged).toBeGreaterThanOrEqual(2);
      expect(first.failed).toBe(0);
      expect(second.purged).toBe(0);
      // Po 90 dniach znika treść, nagłówki, komentarz, nadawca i temat; zostaje domena nadawcy (statystyki) i powiązania.
      expect(await reportRow(orgA, oldA.id)).toMatchObject({
        body: null,
        headers: null,
        comment: null,
        senderText: null,
        subject: null,
        senderDomain: 'example.test',
        reporterUserId: null,
        contentPurgedAt: now,
      });
      expect(await reportRow(orgB, oldB.id)).toMatchObject({ body: null, headers: null, comment: null, senderText: null, subject: null, senderDomain: 'example.test' });
      expect(await reportRow(orgA, freshA.id)).toMatchObject({ body: 'treść', headers: 'nagłówki', comment: 'komentarz', senderText: 'obcy@example.test', subject: 'Temat', contentPurgedAt: null });
      // Symulacje nie mają treści; temat i nadawca zostają (powiązanie z odbiorcą kampanii), retencja ich nie rusza.
      expect(await reportRow(orgA, simulation.id)).toMatchObject({ contentPurgedAt: null, senderText: 'obcy@example.test', subject: 'Temat' });
    });

    it('samoleczenie: rekord już "spurgowany" wcześniejszą wersją retencji (treść usunięta, nadawca i temat zostały) też zostaje wyczyszczony', async () => {
      const now = new Date();
      const legacy = await insert(orgA, 'REAL', CONTENT_RETENTION_DAYS + 10, { body: null, headers: null, comment: null, contentPurgedAt: new Date(now.getTime() - 5 * DAY) });
      expect(await reportRow(orgA, legacy.id)).toMatchObject({ senderText: 'obcy@example.test', subject: 'Temat' });

      const first = await retention.run(now);
      const second = await retention.run(now);

      expect(first.purged).toBeGreaterThanOrEqual(1);
      expect(second.purged).toBe(0); // idempotentne: po wyczyszczeniu nic już nie pasuje do warunku
      expect(await reportRow(orgA, legacy.id)).toMatchObject({ senderText: null, subject: null, senderDomain: 'example.test' });
    });

    it('granica: zgłoszenie dokładnie sprzed 90 dni jest czyszczone, sprzed 90 dni minus sekunda nie', async () => {
      const now = new Date();
      const atBoundary = await insert(orgA, 'REAL', 0, { createdAt: new Date(now.getTime() - CONTENT_RETENTION_DAYS * DAY) });
      const justYounger = await insert(orgA, 'REAL', 0, { createdAt: new Date(now.getTime() - CONTENT_RETENTION_DAYS * DAY + 1000) });

      await retention.run(now);

      expect((await reportRow(orgA, atBoundary.id)).body).toBeNull();
      expect((await reportRow(orgA, justYounger.id)).body).toBe('treść');
    });
  });
});
