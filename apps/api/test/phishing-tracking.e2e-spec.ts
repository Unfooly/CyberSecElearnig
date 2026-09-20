import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureBodyParsing } from '../src/common/body-parsing';
import { EmailService } from '../src/email/email.service';
import { sha256Hex } from '../src/phishing/token-hash';
import { TRACKING_RATE_LIMIT } from '../src/phishing/tracking/tracking.controller';
import { DEFAULT_LESSON_HTML, FOLLOW_UP_COURSE_DUE_MS, TRACKING_TOKEN_TTL_MS, TrackingService } from '../src/phishing/tracking/tracking.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from './helpers/auth';
import * as bcrypt from 'bcrypt';

const DAY = 24 * 3_600_000;
const LESSON_A = '<h2>Lekcja organizacji A</h2><p>Sprawdź nadawcę.</p>';

describe('Publiczne śledzenie symulacji (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let tracking: TrackingService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-tracking-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;

  type Org = { organizationId: string; users: Record<string, string>; campaignId: string };
  let orgA: Org;
  let orgB: Org;
  let createdCourseId: string | null = null;
  let expectedCourseId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Tak jak main.ts: własne parsowanie ciała z middleware błędów (błędy parsera nie ujawniają fragmentu ciała).
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureBodyParsing(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    tracking = app.get(TrackingService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    // Kurs uzupełniający: najstarszy z kategorii PHISHING_SOCIAL_ENGINEERING (katalog kursów jest globalny).
    let course = await prisma.course.findFirst({ where: { category: 'PHISHING_SOCIAL_ENGINEERING' }, orderBy: { createdAt: 'asc' } });
    if (!course) {
      course = await prisma.course.create({ data: { title: 'Kurs testowy - phishing', category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 5, contentBlocks: [] } });
      createdCourseId = course.id;
    }
    expectedCourseId = course.id;

    orgA = await newOrg('a', ['u1', 'u2'], LESSON_A);
    orgB = await newOrg('b', ['b1'], '<h2>Lekcja organizacji B</h2>');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    if (createdCourseId) {
      await prisma.course.delete({ where: { id: createdCourseId } });
    }
    await app.close();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  async function newOrg(label: string, members: string[], lessonHtml: string): Promise<Org> {
    const { organizationId } = await createVerifiedUser(app, tenantPrisma, { email: email(label), password: DEFAULT_TEST_PASSWORD });
    const users: Record<string, string> = {};
    for (const member of members) {
      const user = await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
        tx.user.create({
          data: { organizationId, email: email(`${label}-${member}`), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
        }),
      );
      users[member] = user.id;
    }
    const campaign = await tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId,
          name: `Kampania ${label}`,
          status: 'RUNNING',
          audienceType: 'ALL',
          templateName: 'Kurier',
          subject: 'Paczka',
          bodyHtml: '<p><a href="{{trackingLink}}">Odbierz</a></p>',
          lessonHtml,
          senderName: 'Kurier',
          senderLocalPart: 'kurier',
          windowStart: new Date(Date.now() - DAY),
          windowEnd: new Date(Date.now() + DAY),
          createdByEmail: email(label),
        },
      }),
    );
    return { organizationId, users, campaignId: campaign.id };
  }

  /** Odbiorca z ZNANYM tokenem (w bazie tylko jego hash), jak po wysyłce. */
  async function recipient(org: Org, userLabel: string | null, overrides: Record<string, unknown> = {}) {
    const token = randomBytes(32).toString('base64url');
    const row = await tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.phishingCampaignRecipient.create({
        data: {
          organizationId: org.organizationId,
          campaignId: org.campaignId,
          userId: userLabel ? org.users[userLabel] : null,
          scheduledAt: new Date(Date.now() - 60_000),
          claimedAt: new Date(),
          sentAt: new Date(),
          tokenHash: sha256Hex(token),
          ...overrides,
        },
      }),
    );
    return { token, id: row.id };
  }

  const rowOf = (org: Org, id: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaignRecipient.findFirstOrThrow({ where: { id, organizationId: org.organizationId } }));
  const assignments = (org: Org, userLabel: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.courseAssignment.findMany({ where: { organizationId: org.organizationId, userId: org.users[userLabel] } }));
  const view = (token: string) => request(app.getHttpServer()).post(`/t/${token}/view`);
  const submit = (token: string) => request(app.getHttpServer()).post(`/t/${token}/submit`);
  const clicks = (org: Org) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.phishingCampaignRecipient.count({ where: { organizationId: org.organizationId, clickedAt: { not: null } } }));

  afterEach(async () => {
    for (const org of [orgA, orgB]) {
      await tenantPrisma.runInOrgContext(org.organizationId, async (tx) => {
        await tx.phishingCampaignRecipient.deleteMany({ where: { organizationId: org.organizationId } });
        await tx.courseAssignment.deleteMany({ where: { organizationId: org.organizationId } });
      });
    }
    jest.restoreAllMocks();
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });

  describe('POST /t/:token/view', () => {
    it('poprawny token: zalicza kliknięcie, przypisuje kurs i zwraca WYŁĄCZNIE lekcję kampanii (bez danych osobowych)', async () => {
      const { token, id } = await recipient(orgA, 'u1');

      const response = await view(token).expect(200);

      expect(Object.keys(response.body)).toEqual(['lessonHtml']);
      expect(response.body.lessonHtml).toContain('Lekcja organizacji A');
      expect(JSON.stringify(response.body)).not.toMatch(/@|Kampania|phishing-tracking|kurier/i);
      const row = await rowOf(orgA, id);
      expect(row.clickedAt).not.toBeNull();
      expect(row.submittedAt).toBeNull();
      const [assignment, ...rest] = await assignments(orgA, 'u1');
      expect(rest).toEqual([]);
      expect(assignment).toMatchObject({ organizationId: orgA.organizationId, courseId: expectedCourseId, status: 'NOT_STARTED' });
      expect(Math.abs((assignment.dueDate as Date).getTime() - (Date.now() + FOLLOW_UP_COURSE_DUE_MS))).toBeLessThan(60_000);
    });

    it('idempotentne: powtórzenia (także RÓWNOLEGŁE) nie zmieniają clickedAt i nie dublują przypisania kursu', async () => {
      const { token, id } = await recipient(orgA, 'u1');
      await view(token).expect(200);
      const first = (await rowOf(orgA, id)).clickedAt;

      await Promise.all(Array.from({ length: 8 }, () => view(token).expect(200)));

      expect((await rowOf(orgA, id)).clickedAt).toEqual(first);
      expect(await assignments(orgA, 'u1')).toHaveLength(1);
    });

    it('przypisanie kursu nie nadpisuje istniejącego (postęp pracownika zostaje)', async () => {
      const { token } = await recipient(orgA, 'u2');
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
        tx.courseAssignment.create({ data: { organizationId: orgA.organizationId, userId: orgA.users.u2, courseId: expectedCourseId, status: 'IN_PROGRESS', currentBlockIndex: 2 } }),
      );

      await view(token).expect(200);

      const [assignment, ...rest] = await assignments(orgA, 'u2');
      expect(rest).toEqual([]);
      expect(assignment).toMatchObject({ status: 'IN_PROGRESS', currentBlockIndex: 2 });
    });

    it('samo pobranie (GET) linku niczego nie zalicza: API nie ma takiej trasy, a wyniki się nie zmieniają', async () => {
      const { token, id } = await recipient(orgA, 'u1');

      const response = await request(app.getHttpServer()).get(`/t/${token}`);

      expect(response.status).toBe(404);
      expect((await rowOf(orgA, id)).clickedAt).toBeNull();
      expect(await assignments(orgA, 'u1')).toHaveLength(0);
    });

    it('pracownik nieaktywny (nie ACTIVE): kliknięcie zaliczone, ale kursu nie dostaje', async () => {
      const { token, id } = await recipient(orgA, 'u2');
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users.u2 }, data: { status: 'INVITED' } }));

      await view(token).expect(200);

      expect((await rowOf(orgA, id)).clickedAt).not.toBeNull();
      expect(await assignments(orgA, 'u2')).toHaveLength(0);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: orgA.users.u2 }, data: { status: 'ACTIVE' } }));
    });

    it('pracownik usunięty po wysyłce: kliknięcie zaliczone, kursu brak, odpowiedź poprawna', async () => {
      const { token, id } = await recipient(orgA, null);

      const response = await view(token).expect(200);

      expect(response.body.lessonHtml).toContain('Lekcja organizacji A');
      expect((await rowOf(orgA, id)).clickedAt).not.toBeNull();
    });

    it('odbiorca "niepewny" (timeout, ale mail mógł dojść) i kampania ANULOWANA nadal zaliczają kliknięcie', async () => {
      const uncertain = await recipient(orgA, 'u1', { sentAt: null, failedAt: new Date(), failureCode: 'TIMEOUT_UNKNOWN' });
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: orgA.campaignId }, data: { status: 'CANCELLED', cancelledAt: new Date() } }));
      const late = await recipient(orgA, 'u2');

      await view(uncertain.token).expect(200);
      await view(late.token).expect(200);

      expect((await rowOf(orgA, uncertain.id)).clickedAt).not.toBeNull();
      expect((await rowOf(orgA, late.id)).clickedAt).not.toBeNull();
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaign.update({ where: { id: orgA.campaignId }, data: { status: 'RUNNING', cancelledAt: null } }));
    });

    it('lekcja jest sanityzowana także na wyjściu (skrypty i linki usuwane)', async () => {
      const dirty = await newOrg('dirty', ['d1'], '<script>alert(1)</script><p onclick="x()">Treść</p><a href="http://evil.example.com">link</a><img src=x onerror=alert(1)>');
      const { token } = await recipient(dirty, 'd1');

      const response = await view(token).expect(200);

      expect(response.body.lessonHtml).toContain('Treść');
      expect(response.body.lessonHtml).not.toMatch(/<script|onclick|onerror|href|<img|evil\.example/i);
    });
  });

  describe('POST /t/:token/submit', () => {
    it('zalicza wysłanie formularza (i kliknięcie, gdy go brakowało); powtórzenie nic nie zmienia', async () => {
      const { token, id } = await recipient(orgA, 'u1');

      const response = await submit(token).expect(200);
      const first = await rowOf(orgA, id);
      await submit(token).expect(200);
      const second = await rowOf(orgA, id);

      expect(response.body.lessonHtml).toContain('Lekcja organizacji A');
      expect(first.clickedAt).not.toBeNull();
      expect(first.submittedAt).not.toBeNull();
      expect(second.submittedAt).toEqual(first.submittedAt);
      expect(second.clickedAt).toEqual(first.clickedAt);
      expect(await assignments(orgA, 'u1')).toHaveLength(1);
    });

    it('view po submit nie cofa ani nie nadpisuje znaczników', async () => {
      const { token, id } = await recipient(orgA, 'u1');
      await view(token).expect(200);
      const afterView = await rowOf(orgA, id);
      await submit(token).expect(200);
      await view(token).expect(200);

      const row = await rowOf(orgA, id);
      expect(row.clickedAt).toEqual(afterView.clickedAt);
      expect(row.submittedAt).not.toBeNull();
    });

    it('CIAŁO jest ignorowane: wartości z formularza nie trafiają do bazy, logów ani odpowiedzi', async () => {
      const secret = 'SEKRET-hasło-Zażółć-123!';
      const { token, id } = await recipient(orgA, 'u1');
      const logged: string[] = [];
      const capture = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation(capture);
        jest.spyOn(Logger, level).mockImplementation(capture);
      }
      for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) {
        jest.spyOn(console, level).mockImplementation(capture);
      }

      const json = await submit(token).send({ email: 'ofiara@firma.example', password: secret }).expect(200);
      const form = await submit(token).type('form').send(`password=${encodeURIComponent(secret)}`).expect(200);
      const text = await submit(token).set('Content-Type', 'text/plain').send(secret).expect(200);

      expect(logged.join('\n')).not.toContain('SEKRET');
      expect(logged.join('\n')).not.toContain('ofiara@');
      for (const body of [json.body, form.body, text.body]) {
        expect(JSON.stringify(body)).not.toContain('SEKRET');
        expect(Object.keys(body)).toEqual(['lessonHtml']);
      }
      const stored = JSON.stringify(await rowOf(orgA, id));
      expect(stored).not.toContain('SEKRET');
      expect(stored).not.toContain('ofiara@');
      const allText = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.$queryRaw<{ found: boolean }[]>`SELECT EXISTS (SELECT 1 FROM "phishing_campaign_recipients" WHERE "providerMessageId" LIKE '%SEKRET%') AS found`);
      expect(allText[0].found).toBe(false);
    });
  });

  describe('błędy parsera ciała nie ujawniają ani nie logują ciała', () => {
    it.each([
      ['uszkodzony JSON zaczynający się od "["', '[SEKRET123-haslo', 'application/json'],
      ['uszkodzony JSON obiektu', '{"password":"SEKRET123-haslo" oops', 'application/json'],
      ['niepoprawny charset', 'SEKRET123-haslo', 'application/json; charset=nieistniejacy'],
    ])('%s: stała odpowiedź 4xx bez fragmentu ciała, brak w logach', async (_label, payload, contentType) => {
      const { token, id } = await recipient(orgA, 'u1');
      const logged: string[] = [];
      const capture = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation(capture);
        jest.spyOn(Logger, level).mockImplementation(capture);
      }
      for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) {
        jest.spyOn(console, level).mockImplementation(capture);
      }

      const response = await submit(token).set('Content-Type', contentType).send(payload);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(JSON.stringify(response.body) + response.text).not.toContain('SEKRET');
      expect(response.body.message).toBe('Nieprawidłowe żądanie.');
      expect(logged.join('\n')).not.toContain('SEKRET');
      expect((await rowOf(orgA, id)).submittedAt).toBeNull(); // uszkodzone żądanie niczego nie zalicza
    });

    it('własne parsowanie ciała nie psuje zwykłych endpointów JSON (logowanie działa, walidacja DTO nadal odrzuca zły kształt)', async () => {
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email('a'), password: DEFAULT_TEST_PASSWORD });
      const invalid = await request(app.getHttpServer()).post('/auth/login').send({ email: 'nie-email', password: 1, obce: true });

      expect(login.status).toBe(200);
      expect(login.body.accessToken).toEqual(expect.any(String));
      expect(invalid.status).toBe(400);
    });

    it('za duże ciało: 413 ze stałą wiadomością, bez fragmentu ciała', async () => {
      const { token } = await recipient(orgA, 'u1');

      const response = await submit(token).set('Content-Type', 'application/json').send(`{"p":"SEKRET${'x'.repeat(300_000)}"}`);

      expect(response.status).toBe(413);
      expect(response.text).not.toContain('SEKRET');
      expect(response.body.message).toBe('Nieprawidłowe żądanie.');
    });
  });

  describe('odpowiedź neutralna i brak enumeracji tokenów', () => {
    const neutral = { lessonHtml: DEFAULT_LESSON_HTML };

    it.each([
      ['nieznany, poprawny formatem', randomBytes(32).toString('base64url')],
      ['za krótki', 'abc'],
      ['za długi', 'A'.repeat(44)],
      ['znaki spoza alfabetu', `${'A'.repeat(42)}!!`],
      ['ze ścieżką', '..%2F..%2Fetc%2Fpasswd'],
      ['unicode', `${'ą'.repeat(43)}`],
      ['hash zamiast tokenu', sha256Hex('cokolwiek')],
    ])('token %s: 200 i TA SAMA odpowiedź (lekcja domyślna), zero zapisów', async (_label, token) => {
      const before = [await clicks(orgA), await clicks(orgB)];

      const viewResponse = await view(token);
      const submitResponse = await submit(token);

      expect([viewResponse.status, submitResponse.status]).toEqual([200, 200]);
      expect(viewResponse.body).toEqual(neutral);
      expect(submitResponse.body).toEqual(neutral);
      expect([await clicks(orgA), await clicks(orgB)]).toEqual(before);
    });

    it('token niezajęty (hash null), zajęty przez odbiorcę bez wysyłki po 90 dniach i "wygasły": odpowiedź neutralna, brak zapisu', async () => {
      const expired = await recipient(orgA, 'u1', { claimedAt: new Date(Date.now() - TRACKING_TOKEN_TTL_MS - DAY), sentAt: new Date(Date.now() - TRACKING_TOKEN_TTL_MS - DAY) });
      const unclaimed = await recipient(orgA, 'u2', { claimedAt: null, sentAt: null });

      const a = await view(expired.token).expect(200);
      const b = await view(unclaimed.token).expect(200);

      expect(a.body).toEqual(neutral);
      expect(b.body).toEqual(neutral);
      expect((await rowOf(orgA, expired.id)).clickedAt).toBeNull();
      expect((await rowOf(orgA, unclaimed.id)).clickedAt).toBeNull();
      expect(await assignments(orgA, 'u1')).toHaveLength(0);
    });

    it('jawny token nie jest w bazie: wyszukiwanie po samym tokenie (bez hasha) nic nie znajduje', async () => {
      const { token } = await recipient(orgA, 'u1');

      expect(await tenantPrisma.runTrackingTokenLookup(token)).toBeNull();
      expect(await tenantPrisma.runTrackingTokenLookup(sha256Hex(token))).not.toBeNull();
    });

    it('trasa publiczna: działa bez tokenu JWT, z błędnym Bearerem i nie zależy od sesji', async () => {
      const { token } = await recipient(orgA, 'u1');

      await view(token).expect(200);
      await view(token).set('Authorization', 'Bearer nieprawidlowy.token.jwt').expect(200);
    });
  });

  describe('limit żądań', () => {
    it.each([
      ['view', view],
      ['submit', submit],
    ])('%s: po przekroczeniu limitu na minutę z jednego adresu kolejne dostają 429 (także dla tokenów nieznanych)', async (_name, call) => {
      const token = randomBytes(32).toString('base64url');

      const statuses: number[] = [];
      for (let i = 0; i < TRACKING_RATE_LIMIT + 2; i += 1) {
        statuses.push((await call(token)).status);
      }

      expect(statuses.slice(0, TRACKING_RATE_LIMIT).every((status) => status === 200)).toBe(true);
      expect(statuses.slice(TRACKING_RATE_LIMIT)).toEqual([429, 429]);
    }, 60_000);
  });

  describe('izolacja tenantów (Zasada nr 1)', () => {
    it('token organizacji A zmienia wyłącznie wiersz A; B (wiersze i przypisania) bez zmian, a kurs dostaje tylko pracownik A', async () => {
      const a = await recipient(orgA, 'u1');
      const b = await recipient(orgB, 'b1');

      await view(a.token).expect(200);

      expect((await rowOf(orgA, a.id)).clickedAt).not.toBeNull();
      expect((await rowOf(orgB, b.id)).clickedAt).toBeNull();
      expect(await assignments(orgB, 'b1')).toHaveLength(0);
      expect(await assignments(orgA, 'u1')).toHaveLength(1);
      const crossOrg = await tenantPrisma.runCrossOrgQuery((tx) => tx.courseAssignment.findMany({ where: { userId: { in: [orgA.users.u1, orgB.users.b1] } }, select: { organizationId: true, userId: true } }));
      expect(crossOrg).toEqual([{ organizationId: orgA.organizationId, userId: orgA.users.u1 }]);
    });

    it('każda organizacja dostaje swoją lekcję (treść snapshotu kampanii własnej organizacji)', async () => {
      const a = await recipient(orgA, 'u1');
      const b = await recipient(orgB, 'b1');

      expect((await view(a.token)).body.lessonHtml).toContain('organizacji A');
      expect((await view(b.token)).body.lessonHtml).toContain('organizacji B');
    });

    it('przypisanie kursu dla użytkownika INNEJ organizacji jest niemożliwe: serwis (jawny warunek organizacji) i złożone FK w bazie', async () => {
      const assigned = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tracking.assignFollowUpCourse(tx, orgB.organizationId, orgA.users.u1, new Date()));

      expect(assigned).toBe(false);
      expect(await assignments(orgA, 'u1')).toHaveLength(0);
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgB.organizationId, userId: orgA.users.u1, courseId: expectedCourseId } })),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.courseAssignment.create({ data: { organizationId: orgB.organizationId, userId: orgB.users.b1, courseId: expectedCourseId } })),
      ).rejects.toThrow();
      expect(await tenantPrisma.runCrossOrgQuery((tx) => tx.courseAssignment.count({ where: { userId: orgA.users.u1 } }))).toBe(0);
    });

    it('przypisanie kursu jest idempotentne także w wywołaniu serwisu', async () => {
      const call = () => tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tracking.assignFollowUpCourse(tx, orgA.organizationId, orgA.users.u1, new Date()));

      expect([await call(), await call()]).toEqual([true, false]);
      expect(await assignments(orgA, 'u1')).toHaveLength(1);
    });

    it('lookup po hashu zwraca WYŁĄCZNIE wąskie pola (identyfikatory i znaczniki czasu), bez e-maila i treści', async () => {
      const { token, id } = await recipient(orgA, 'u1');

      const ref = await tenantPrisma.runTrackingTokenLookup(sha256Hex(token));

      expect(Object.keys(ref ?? {}).sort()).toEqual(['campaignId', 'claimedAt', 'id', 'organizationId', 'userId']);
      expect(ref).toMatchObject({ id, organizationId: orgA.organizationId, userId: orgA.users.u1 });
    });

    it('generyczny bypass (runCrossOrgQuery) NIE widzi odbiorców kampanii - lookup tokenu ma własny sentinel', async () => {
      const { id } = await recipient(orgA, 'u1');

      const visible = await tenantPrisma.runCrossOrgQuery((tx) => tx.phishingCampaignRecipient.count({ where: { id } }));

      expect(visible).toBe(0);
    });

    it('sentinel lookupu obejmuje tylko SELECT: pod nim nie da się zmienić ani usunąć wierszy odbiorców', async () => {
      const { id } = await recipient(orgA, 'u1');

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_tracking_lookup', 'on', true)`;
        return {
          visible: await tx.phishingCampaignRecipient.count({ where: { id } }),
          updated: (await tx.phishingCampaignRecipient.updateMany({ where: { id }, data: { clickedAt: new Date() } })).count,
          deleted: (await tx.phishingCampaignRecipient.deleteMany({ where: { id } })).count,
          campaigns: await tx.phishingCampaign.count(), // sentinel nie otwiera innych tabel
          assignments: await tx.courseAssignment.count(),
        };
      });

      expect(result).toEqual({ visible: 1, updated: 0, deleted: 0, campaigns: 0, assignments: 0 });
      expect((await rowOf(orgA, id)).clickedAt).toBeNull();
    });

    it('kontekst organizacji B nie widzi ani nie zmienia odbiorców A (RLS, bez filtra w kodzie)', async () => {
      const { id } = await recipient(orgA, 'u1');

      const result = await tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => ({
        seen: (await tx.phishingCampaignRecipient.findMany()).map((row) => row.id),
        updated: (await tx.phishingCampaignRecipient.updateMany({ data: { clickedAt: new Date() } })).count,
      }));

      expect(result.seen).not.toContain(id);
      expect(result.updated).toBe(0);
    });
  });

  describe('ograniczenia w bazie', () => {
    it('submittedAt bez clickedAt i clickedAt bez tokenu => odrzucone (CHECK)', async () => {
      const { id } = await recipient(orgA, 'u1');
      const noToken = await recipient(orgA, 'u2', { tokenHash: null, claimedAt: null, sentAt: null });

      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaignRecipient.update({ where: { id }, data: { submittedAt: new Date() } }))).rejects.toThrow(/check constraint/i);
      await expect(tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.phishingCampaignRecipient.update({ where: { id: noToken.id }, data: { clickedAt: new Date() } }))).rejects.toThrow(/check constraint/i);
    });
  });
});
