import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { INVITE_PER_RUN } from '../src/users/import/invite-pace';
import { REPORT_TTL_MS } from '../src/users/import/user-import.service';
import { UserImportInviteService } from '../src/users/import/user-import-invite.service';
import { UserImportRetentionService } from '../src/users/import/user-import-retention.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IMPORT_DOMAIN = '@firma-import.test';
// Chwila "teraz" dla biegów kolejki (tokeny zaproszeń powstają na prawdziwym zegarze, więc `now` musi być bliski rzeczywistemu).
const T_NOW = new Date();
type Role = 'EMPLOYEE' | 'DEPARTMENT_MANAGER' | 'ORG_ADMIN';

interface Org {
  organizationId: string;
  adminId: string;
  adminToken: string;
  adminEmail: string;
}

// Import pracowników z CSV, krok 2 (commit 5/5): potwierdzenie (limit licencji, atomowość), kolejka zaproszeń z tempem i
// dobowym limitem, postęp, zatrzymanie, raport CSV z escapowaniem, izolacja A/B. Zegar zamrożony parametrem `now` joba.
describe('Import pracowników z CSV: potwierdzenie i kolejka zaproszeń (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let inviter: UserImportInviteService;
  let retention: UserImportRetentionService;
  let owner: PrismaClient;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'user-import-confirm-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  let orgA: Org;
  let orgB: Org;
  let employeeToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    inviter = app.get(UserImportInviteService);
    retention = app.get(UserImportRetentionService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    orgA = await newOrg('a');
    orgB = await newOrg('b');
    employeeToken = await addUser(orgA, 'emp-a', 'EMPLOYEE');
  }, 90_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  const clearThrottle = () => (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  beforeEach(async () => {
    clearThrottle();
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
    await setSeats(orgA, 10_000);
    await setSeats(orgB, 10_000);
  });

  // Czysty stan: partie (kaskada wiersze), tokeny (limit dobowy) i konta dodane w testach; konta fixture zostają.
  afterEach(async () => {
    const ids = [orgA.organizationId, orgB.organizationId];
    await owner.userImportBatch.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.passwordResetToken.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.inviteNotice.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.user.deleteMany({ where: { organizationId: { in: ids }, email: { endsWith: IMPORT_DOMAIN } } });
    await owner.department.deleteMany({ where: { organizationId: { in: ids }, name: { startsWith: 'Imp-' } } });
  });

  // ---- fixtures ----------------------------------------------------------------------------------------------------

  async function newOrg(label: string): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { organizationId: admin!.organizationId, adminId: admin!.id, adminToken: body.accessToken, adminEmail: credentials.email };
  }

  async function addUser(org: Org, label: string, role: Role, extra: Record<string, unknown> = {}): Promise<string> {
    await tenantPrisma.runInOrgContext(org.organizationId, async (tx) =>
      tx.user.create({
        data: { organizationId: org.organizationId, email: email(label), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role, status: 'ACTIVE', emailVerifiedAt: new Date(), ...extra },
      }),
    );
    clearThrottle();
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);
    return login.body.accessToken as string;
  }

  const setSeats = (org: Org, seatsLimit: number) => prisma.organization.update({ where: { id: org.organizationId }, data: { seatsLimit } });
  // Konta tworzone przez import w testach mają domenę IMPORT_DOMAIN (odróżnia je od kont fixture: administratorów i pracowników).
  const users = (org: Org) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.user.findMany({ where: { organizationId: org.organizationId, email: { endsWith: IMPORT_DOMAIN } }, orderBy: { email: 'asc' } }));
  const userCount = (org: Org) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.user.count({ where: { organizationId: org.organizationId } }));
  const batchRow = (org: Org, id: string) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.userImportBatch.findFirstOrThrow({ where: { id } }));
  const rowsOf = (org: Org, batchId: string) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.userImportRow.findMany({ where: { batchId }, orderBy: { line: 'asc' } }));
  const invites = () => sendSpy.mock.calls.map(([options]) => options as { to: string; templateName: string }).filter((options) => options.templateName === 'user-invite');
  const imp = (label: string) => `${label}-${suffix}${IMPORT_DOMAIN}`;

  const upload = (token: string, content: string) =>
    request(app.getHttpServer()).post('/users/import/preview').set('Authorization', `Bearer ${token}`).attach('file', Buffer.from(content, 'utf-8'), { filename: 'pracownicy.csv', contentType: 'text/csv' });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);
  const HEADER = 'email,firstName,lastName,departmentName';
  const csvOf = (rows: string[]) => [HEADER, ...rows].join('\n');
  const people = (count: number, prefix = 'p', department = '') => Array.from({ length: count }, (_v, i) => `${imp(`${prefix}${i}`)},Anna,Nowak,${department}`);

  /** Podgląd + potwierdzenie; zwraca identyfikator partii. */
  async function importPeople(org: Org, rows: string[]): Promise<string> {
    clearThrottle();
    const preview = await upload(org.adminToken, csvOf(rows)).expect(201);
    clearThrottle();
    await post(org.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);
    return preview.body.id as string;
  }

  // ---- potwierdzenie -----------------------------------------------------------------------------------------------

  describe('potwierdzenie importu', () => {
    it('tworzy konta INVITED (rola pracownik, dział), NIE wysyła maili w żądaniu, wynik per wiersz i postęp', async () => {
      const existing = imp('istnieje');
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.create({ data: { organizationId: orgA.organizationId, email: existing, passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED', firstName: 'Stary', lastName: 'Wpis' } }));
      const preview = await upload(orgA.adminToken, csvOf([`${imp('jan')},Jan,Kowalski,Imp-Sprzedaż`, `${imp('ewa')},Ewa,Nowak,Imp-Sprzedaż`, `${imp('ala')},Ala,Kot,`, 'zly-email,X,Y,', `${existing},Nowe,Dane,`])).expect(201);
      const before = await userCount(orgA);
      sendSpy.mockClear();
      clearThrottle();

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);

      expect(response.body).toMatchObject({ status: 'PROCESSING', validCount: 3, existingCount: 1, errorCount: 1 });
      expect(response.body.progress).toMatchObject({ accountsCreated: 3, accountsFailed: 0, invitesTotal: 3, invitesSent: 0, remaining: 3, done: false, dailyLimit: 300 });
      expect(await userCount(orgA)).toBe(before + 3);
      expect(invites()).toEqual([]); // zaproszenia idą dopiero w kolejce z tempem
      const created = await users(orgA);
      expect(created.filter((u) => u.email !== existing).map((u) => [u.role, u.status])).toEqual([['EMPLOYEE', 'INVITED'], ['EMPLOYEE', 'INVITED'], ['EMPLOYEE', 'INVITED']]);
      const jan = created.find((u) => u.email === imp('jan'));
      const department = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.department.findFirstOrThrow({ where: { organizationId: orgA.organizationId, name: 'Imp-Sprzedaż' } }));
      expect(jan).toMatchObject({ firstName: 'Jan', lastName: 'Kowalski', departmentId: department.id });
      expect(created.find((u) => u.email === existing)).toMatchObject({ firstName: 'Stary', lastName: 'Wpis' }); // istniejącego nie nadpisano
      const rows = await rowsOf(orgA, preview.body.id);
      expect(rows.filter((r) => r.accountResult === 'CREATED').map((r) => [r.inviteStatus, !!r.userId])).toEqual([['PENDING', true], ['PENDING', true], ['PENDING', true]]);
      expect(rows.find((r) => r.status === 'EXISTING')?.accountResult).toBeNull();
    });

    it('konta z importu nie mają użytecznego hasła: logowanie jest niemożliwe do czasu aktywacji linkiem z zaproszenia', async () => {
      await importPeople(orgA, [`${imp('bez-hasla')},Jan,Kowalski,`]);

      clearThrottle();
      await request(app.getHttpServer()).post('/auth/login').send({ email: imp('bez-hasla'), password: DEFAULT_TEST_PASSWORD }).expect(401);
      await request(app.getHttpServer()).post('/auth/login').send({ email: imp('bez-hasla'), password: '' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    });

    it('LIMIT LICENCJI sprawdzany przed zapisem: za mało miejsc = 409 SEAT_LIMIT z liczbą brakujących, żadne konto nie powstaje, partia zostaje podglądem', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 2);
      const preview = await upload(orgA.adminToken, csvOf(people(3))).expect(201);
      clearThrottle();

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(409);

      expect(response.body).toMatchObject({ code: 'SEAT_LIMIT', seatsAvailable: 2, seatsRequired: 3, seatsMissing: 1, settingsPath: '/dashboard/settings' });
      expect(response.body.message).toContain('Brakuje 1');
      expect(await userCount(orgA)).toBe(used);
      expect((await batchRow(orgA, preview.body.id)).status).toBe('PREVIEW');
      // Po zmianie planu ten sam podgląd da się potwierdzić.
      await setSeats(orgA, used + 3);
      clearThrottle();
      await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);
      expect(await userCount(orgA)).toBe(used + 3);
    });

    it('granica limitu: dokładnie tyle kont, ile wolnych miejsc, mieści się', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 3);

      await importPeople(orgA, people(3));

      expect(await userCount(orgA)).toBe(used + 3);
    });

    it('podwójne i RÓWNOLEGŁE potwierdzenie: dokładnie jedno wygrywa (409 IMPORT_ALREADY_CONFIRMED), konta powstają raz', async () => {
      const preview = await upload(orgA.adminToken, csvOf(people(5))).expect(201);
      const before = await userCount(orgA);

      // 3 żądania = limit 3/min na potwierdzenie (czwarte dostałoby 429 z limitu żądań, nie z logiki importu).
      const responses = await Promise.allSettled(Array.from({ length: 3 }, () => post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`)));

      const statuses = responses.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);
      expect(await userCount(orgA)).toBe(before + 5);
      clearThrottle();
      const again = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(409);
      expect(again.body.code).toBe('IMPORT_ALREADY_CONFIRMED');
    });

    it('drugi import, gdy poprzedni nadal wysyła zaproszenia: 409 IMPORT_IN_PROGRESS (jedna kolejka na organizację)', async () => {
      await importPeople(orgA, people(3, 'first'));
      clearThrottle();
      const second = await upload(orgA.adminToken, csvOf(people(2, 'second'))).expect(201);
      clearThrottle();

      const response = await post(orgA.adminToken, `/users/import/${second.body.id}/confirm`).expect(409);

      expect(response.body.code).toBe('IMPORT_IN_PROGRESS');
      expect((await batchRow(orgA, second.body.id)).status).toBe('PREVIEW');
    });

    it('nowy podgląd nie kasuje importu w toku (zastępuje tylko poprzedni PODGLĄD)', async () => {
      const running = await importPeople(orgA, people(3, 'run'));
      clearThrottle();

      await upload(orgA.adminToken, csvOf(people(1, 'nowy'))).expect(201);

      expect((await batchRow(orgA, running)).status).toBe('PROCESSING');
      expect(await rowsOf(orgA, running)).toHaveLength(3);
    });

    it('adres zajęty w INNEJ organizacji: dla administratora wiersz jak każdy inny (bez sondy), konta w A nie ma, właściciel dostaje powiadomienie', async () => {
      // Pracownik B utworzony bezpośrednio (bez maila rejestracyjnego: ten zajmuje limit "jedna wiadomość na skrzynkę na 10 minut").
      await addUser(orgB, 'emp-b', 'EMPLOYEE');
      const foreign = email('emp-b');
      const preview = await upload(orgA.adminToken, csvOf([`${foreign},Jan,Kowalski,`, ...people(2)])).expect(201);
      expect(preview.body).toMatchObject({ validCount: 3 }); // w podglądzie nie da się tego rozpoznać (brak enumeracji)
      clearThrottle();
      const before = await userCount(orgA);

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);

      // Liczniki jak dla samych nowych adresów: nic nie zdradza, że jeden z nich ma konto gdzie indziej.
      expect(response.body.progress).toMatchObject({ accountsCreated: 3, accountsFailed: 0, invitesTotal: 3, remaining: 3 });
      expect(await userCount(orgA)).toBe(before + 2);
      const taken = (await rowsOf(orgA, preview.body.id)).find((r) => r.email === foreign);
      expect(taken).toMatchObject({ accountResult: 'CREATED', accountReason: null, inviteStatus: 'PENDING', userId: null });
      // Konto z innej organizacji nietknięte (nie przeniesione ani nadpisane).
      expect(await tenantPrisma.runAuthLookup({ email: foreign })).toMatchObject({ organizationId: orgB.organizationId, status: 'ACTIVE' });

      await inviter.processOrganization(orgA.organizationId, T_NOW);

      const rows = await rowsOf(orgA, preview.body.id);
      expect(rows.map((r) => r.inviteStatus)).toEqual(['SENT', 'SENT', 'SENT']);
      expect(rows.map((r) => r.inviteReason)).toEqual([null, null, null]);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: foreign, templateName: 'invite-address-taken' }));
      expect(invites().map((i) => i.to)).not.toContain(foreign); // właściciel nie dostaje linku aktywacyjnego do cudzej organizacji
      expect(invites()).toHaveLength(2);
      // Wewnętrzny znacznik nie wycieka: ani w API (wiersze), ani w raporcie CSV.
      const api = await get(orgA.adminToken, `/users/import/${preview.body.id}/rows`).expect(200);
      expect(JSON.stringify(api.body)).not.toMatch(/addressTaken/);
      const report = await get(orgA.adminToken, `/users/import/${preview.body.id}/report.csv`).expect(200);
      const lines = report.text.split('\n').filter((l) => l.includes(foreign) || l.includes(imp('p0')));
      expect(lines[0].replace(foreign, 'X').replace(/Jan,Kowalski/, 'N').split(',').slice(2).join(',')).toBe(lines[1].replace(imp('p0'), 'X').replace(/Anna,Nowak/, 'N').split(',').slice(2).join(','));
    });

    it('konto, które pojawiło się po podglądzie, jest pomijane przy potwierdzeniu (EXISTING), a licencje liczone od stanu bieżącego', async () => {
      const preview = await upload(orgA.adminToken, csvOf([`${imp('pozniej')},Jan,Kowalski,`, ...people(2)])).expect(201);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.create({ data: { organizationId: orgA.organizationId, email: imp('pozniej'), passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED' } }));
      clearThrottle();

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);

      expect(response.body.progress).toMatchObject({ accountsCreated: 2, invitesTotal: 2 });
      const skipped = (await rowsOf(orgA, preview.body.id)).find((r) => r.email === imp('pozniej'));
      expect(skipped).toMatchObject({ status: 'EXISTING', accountResult: null });
    });

    it('nic do zrobienia (same błędy i istniejące konta): 409 IMPORT_NOTHING_TO_CONFIRM, partia zostaje podglądem', async () => {
      const preview = await upload(orgA.adminToken, csvOf(['zly,Jan,Kowalski,', `${orgA.adminEmail},Admin,Istniejacy,`])).expect(201);
      clearThrottle();

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(409);

      expect(response.body.code).toBe('IMPORT_NOTHING_TO_CONFIRM');
      expect((await batchRow(orgA, preview.body.id)).status).toBe('PREVIEW');
    });

    it('wygasły podgląd nie da się potwierdzić (404), konta nie powstają', async () => {
      const preview = await upload(orgA.adminToken, csvOf(people(2))).expect(201);
      await owner.userImportBatch.update({ where: { id: preview.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const before = await userCount(orgA);
      clearThrottle();

      await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(404);

      expect(await userCount(orgA)).toBe(before);
    });

    it('anulowanie po potwierdzeniu jest niemożliwe (409), bo konta już istnieją', async () => {
      const id = await importPeople(orgA, people(2));

      const response = await request(app.getHttpServer()).delete(`/users/import/${id}`).set('Authorization', `Bearer ${orgA.adminToken}`).expect(409);

      expect(response.body.code).toBe('IMPORT_ALREADY_CONFIRMED');
    });

    it('DUŻY import (5000 osób) potwierdza się w jednej transakcji i tworzy wszystkie konta', async () => {
      await setSeats(orgA, 20_000);
      const rows = Array.from({ length: 5000 }, (_v, i) => `${imp(`big${i}`)},Anna,Nowak,Imp-Dział ${i % 9}`);
      clearThrottle();
      const preview = await upload(orgA.adminToken, csvOf(rows)).expect(201);
      clearThrottle();
      const before = await userCount(orgA);

      const response = await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);

      expect(response.body.progress).toMatchObject({ accountsCreated: 5000, invitesTotal: 5000, remaining: 5000 });
      expect(await userCount(orgA)).toBe(before + 5000);
      const departments = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.department.count({ where: { organizationId: orgA.organizationId, name: { startsWith: 'Imp-Dział' } } }));
      expect(departments).toBe(9);
    }, 180_000);
  });

  // ---- kolejka zaproszeń z tempem ----------------------------------------------------------------------------------

  describe('kolejka zaproszeń z tempem (zegar zamrożony)', () => {
    // Zegar "zamrożony" WOKÓŁ chwili rzeczywistej: tokeny zaproszeń tworzy kod z prawdziwym czasem, a limit dobowy liczy je
    // względem `now` biegu - stała data z przyszłości wyrzuciłaby je poza okno 24 h.
    const T0 = new Date();
    const at = (ms: number) => new Date(T0.getTime() + ms);

    it('w jednym biegu najwyżej 20 zaproszeń na organizację; kolejne biegi kończą kolejkę; partia domyka się jako COMPLETED z terminem raportu (30 dni)', async () => {
      const id = await importPeople(orgA, people(45));

      const first = await inviter.processOrganization(orgA.organizationId, T0);
      const second = await inviter.processOrganization(orgA.organizationId, at(5 * 60_000));
      const third = await inviter.processOrganization(orgA.organizationId, at(10 * 60_000));
      const fourth = await inviter.processOrganization(orgA.organizationId, at(15 * 60_000));

      expect([first, second, third, fourth]).toEqual([INVITE_PER_RUN, INVITE_PER_RUN, 5, 0]);
      expect(invites()).toHaveLength(45);
      expect(new Set(invites().map((mail) => mail.to)).size).toBe(45); // nikt nie dostał dwóch zaproszeń
      const batch = await batchRow(orgA, id);
      expect(batch.status).toBe('COMPLETED');
      expect(batch.completedAt).toBeInstanceOf(Date);
      expect(batch.expiresAt.getTime() - (batch.completedAt as Date).getTime()).toBe(REPORT_TTL_MS);
      expect((await rowsOf(orgA, id)).every((row) => row.inviteStatus === 'SENT' && row.inviteSentAt)).toBe(true);
    });

    it('DOBOWY LIMIT 300: import ponad limit rozkłada się na kolejne doby ("reszta jutro"), a ETA jest podane', async () => {
      // 290 zaproszeń w ostatnich 24 h (np. ręcznych) - zostaje 10 miejsc na dziś.
      await owner.passwordResetToken.createMany({
        data: Array.from({ length: 290 }, () => ({ organizationId: orgA.organizationId, userId: orgA.adminId, tokenHash: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + HOUR), createdAt: at(-HOUR) })),
      });
      const id = await importPeople(orgA, people(30));

      const first = await inviter.processOrganization(orgA.organizationId, T0);
      const same = await inviter.processOrganization(orgA.organizationId, at(5 * 60_000)); // limit wyczerpany
      const summary = await get(orgA.adminToken, `/users/import/${id}`).expect(200);

      expect([first, same]).toEqual([10, 0]);
      expect(invites()).toHaveLength(10);
      expect(summary.body.progress).toMatchObject({ invitesSent: 10, invitesTotal: 30, remaining: 20, restTomorrow: true });
      expect(summary.body.progress.estimatedCompletionAt).toEqual(expect.any(String));
      expect(summary.body.status).toBe('PROCESSING');

      // Po dobie tokeny wychodzą z okna kroczącego i wysyłka rusza dalej, aż do końca.
      const next = await inviter.processOrganization(orgA.organizationId, at(DAY + HOUR + 60_000));
      const last = await inviter.processOrganization(orgA.organizationId, at(DAY + HOUR + 6 * 60_000));
      expect([next, last]).toEqual([INVITE_PER_RUN, 0]);
      expect((await batchRow(orgA, id)).status).toBe('COMPLETED');
      expect(invites()).toHaveLength(30);
    });

    it('limit dobowy jest WSPÓLNY z zaproszeniami ręcznymi (tokeny z ostatnich 24 h) - kolejka nie omija limitu anty-spamowego', async () => {
      await owner.passwordResetToken.createMany({
        data: Array.from({ length: 300 }, () => ({ organizationId: orgA.organizationId, userId: orgA.adminId, tokenHash: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + HOUR), createdAt: at(-HOUR) })),
      });
      await importPeople(orgA, people(5));

      expect(await inviter.processOrganization(orgA.organizationId, T0)).toBe(0);
      expect(invites()).toHaveLength(0);
    });

    it('RÓWNOLEGŁE biegi (kilka instancji): łącznie nie więcej niż tempo jednego biegu i żadnych duplikatów', async () => {
      await importPeople(orgA, people(60));

      await Promise.all(Array.from({ length: 5 }, () => inviter.processOrganization(orgA.organizationId, T0)));

      expect(invites().length).toBeLessThanOrEqual(INVITE_PER_RUN);
      expect(invites().length).toBeGreaterThan(0);
      expect(new Set(invites().map((mail) => mail.to)).size).toBe(invites().length);
    });

    it('awaria wysyłki: wiersze FAILED z powodem, BEZ ponawiania po cichu (at-most-once), partia się domyka', async () => {
      const id = await importPeople(orgA, people(3));
      sendSpy.mockResolvedValue(false);

      await inviter.processOrganization(orgA.organizationId, T0);
      sendSpy.mockResolvedValue(true);
      sendSpy.mockClear();
      await inviter.processOrganization(orgA.organizationId, at(5 * 60_000));

      const rows = await rowsOf(orgA, id);
      expect(rows.every((r) => r.inviteStatus === 'FAILED' && (r.inviteReason ?? '').includes('Wyślij zaproszenie ponownie'))).toBe(true);
      expect(invites()).toHaveLength(0); // drugi bieg niczego nie ponowił
      expect((await batchRow(orgA, id)).status).toBe('COMPLETED');
    });

    it('zajęcie przerwane awarią (SENDING starsze niż 10 min): domknięte jako FAILED "stan niepewny", nie wysyłane ponownie', async () => {
      const id = await importPeople(orgA, people(3));
      const rows = await rowsOf(orgA, id);
      await owner.userImportRow.updateMany({ where: { id: { in: rows.slice(0, 2).map((r) => r.id) } }, data: { inviteStatus: 'SENDING', inviteClaimedAt: at(-20 * 60_000) } });

      await inviter.processOrganization(orgA.organizationId, T0);

      const after = await rowsOf(orgA, id);
      expect(after.slice(0, 2).map((r) => [r.inviteStatus, r.inviteReason])).toEqual([['FAILED', expect.stringContaining('stan niepewny')], ['FAILED', expect.stringContaining('stan niepewny')]]);
      expect(after[2].inviteStatus).toBe('SENT');
      expect(invites().map((mail) => mail.to)).toEqual([after[2].email]);
    });

    it('świeże zajęcie (SENDING < 10 min) nie jest ruszane; konto aktywowane albo usunięte w międzyczasie jest pomijane (SKIPPED)', async () => {
      const id = await importPeople(orgA, people(4));
      const rows = await rowsOf(orgA, id);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: rows[0].userId as string }, data: { status: 'ACTIVE' } }));
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: rows[1].userId as string } }));
      await owner.userImportRow.update({ where: { id: rows[2].id }, data: { inviteStatus: 'SENDING', inviteClaimedAt: at(-60_000) } });

      await inviter.processOrganization(orgA.organizationId, T0);

      const after = await rowsOf(orgA, id);
      expect(after[0]).toMatchObject({ inviteStatus: 'SKIPPED' });
      expect(after[1]).toMatchObject({ inviteStatus: 'SKIPPED', userId: null }); // usunięte konto: userId wyzerowane
      expect(after[2].inviteStatus).toBe('SENDING'); // cudze, świeże zajęcie
      expect(after[3].inviteStatus).toBe('SENT');
      expect((await batchRow(orgA, id)).status).toBe('PROCESSING'); // czeka na wynik zajętego wiersza
    });

    it('zatrzymanie wysyłki: oczekujące zaproszenia są pomijane, konta zostają, partia COMPLETED; kolejne biegi nic nie wysyłają', async () => {
      const id = await importPeople(orgA, people(45));
      await inviter.processOrganization(orgA.organizationId, T0);
      sendSpy.mockClear();
      clearThrottle();

      const stopped = await post(orgA.adminToken, `/users/import/${id}/stop`).expect(200);
      const next = await inviter.processOrganization(orgA.organizationId, at(5 * 60_000));

      expect(stopped.body.status).toBe('COMPLETED');
      expect(stopped.body.progress).toMatchObject({ remaining: 0, done: true });
      expect(stopped.body.progress.invites).toMatchObject({ sent: 20, skipped: 25, pending: 0 });
      expect(next).toBe(0);
      expect(invites()).toHaveLength(0);
      expect((await users(orgA)).length).toBe(45); // konta zostają
      clearThrottle();
      const again = await post(orgA.adminToken, `/users/import/${id}/stop`).expect(409);
      expect(again.body.code).toBe('IMPORT_NOT_RUNNING');
    });

    it('izolacja A/B: kolejka B nie wpływa na A; zaproszenia idą wyłącznie do wierszy własnej partii; ogólny bieg run() obsługuje obie', async () => {
      await importPeople(orgA, people(3, 'a'));
      await importPeople(orgB, people(2, 'b'));

      const result = await inviter.run(T0);

      expect(result.failed).toBe(0);
      const recipients = invites().map((mail) => mail.to);
      expect(recipients.filter((to) => to.endsWith(IMPORT_DOMAIN))).toHaveLength(5);
      const rowsA = await rowsOf(orgA, (await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.userImportBatch.findFirstOrThrow({ where: { organizationId: orgA.organizationId } }))).id);
      expect(rowsA.every((row) => row.inviteStatus === 'SENT')).toBe(true);
      expect((await users(orgA)).length).toBe(3);
      expect((await users(orgB)).length).toBe(2);
    });
  });

  // ---- postęp i raport ---------------------------------------------------------------------------------------------

  describe('postęp i raport CSV', () => {
    it('GET /users/import/latest: ostatni potwierdzony import (trwający albo zakończony); podgląd, brak importu i wygasły dają null; izolacja A/B', async () => {
      expect((await get(orgA.adminToken, '/users/import/latest').expect(200)).body).toEqual({ batch: null });
      clearThrottle();
      const preview = await upload(orgA.adminToken, csvOf(people(2))).expect(201);
      expect((await get(orgA.adminToken, '/users/import/latest').expect(200)).body).toEqual({ batch: null }); // podgląd to nie import
      clearThrottle();
      await post(orgA.adminToken, `/users/import/${preview.body.id}/confirm`).expect(200);

      const latest = await get(orgA.adminToken, '/users/import/latest').expect(200);

      expect(latest.body.batch).toMatchObject({ id: preview.body.id, status: 'PROCESSING', progress: { invitesTotal: 2 } });
      expect((await get(orgB.adminToken, '/users/import/latest').expect(200)).body).toEqual({ batch: null });
      await get(employeeToken, '/users/import/latest').expect(403);
      await owner.userImportBatch.update({ where: { id: preview.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await get(orgA.adminToken, '/users/import/latest').expect(200)).body).toEqual({ batch: null });
    });

    it('GET :id po potwierdzeniu pokazuje postęp "wysłano X z Y", pozostałe i stan dobowego limitu; po zakończeniu done = true', async () => {
      const id = await importPeople(orgA, people(25));
      await inviter.processOrganization(orgA.organizationId, new Date());

      const running = await get(orgA.adminToken, `/users/import/${id}`).expect(200);
      await inviter.processOrganization(orgA.organizationId, new Date(Date.now() + 5 * 60_000));
      const done = await get(orgA.adminToken, `/users/import/${id}`).expect(200);

      expect(running.body.progress).toMatchObject({ invitesSent: 20, invitesTotal: 25, remaining: 5, restTomorrow: false, done: false });
      expect(running.body.progress.dailyRemaining).toBeLessThanOrEqual(280);
      expect(done.body.progress).toMatchObject({ invitesSent: 25, remaining: 0, done: true, estimatedCompletionAt: null });
      expect(done.body.status).toBe('COMPLETED');
    });

    it('wiersze po potwierdzeniu zawierają wynik konta i zaproszenia; filtr statusu i stronicowanie działają', async () => {
      const id = await importPeople(orgA, [...people(3), 'zly,Jan,Kowalski,']);
      await inviter.processOrganization(orgA.organizationId, new Date());

      const valid = await get(orgA.adminToken, `/users/import/${id}/rows?status=VALID`).expect(200);

      expect(valid.body.items).toHaveLength(3);
      expect(valid.body.items[0]).toMatchObject({ accountResult: 'CREATED', inviteStatus: 'SENT', status: 'VALID' });
    });

    it('raport CSV: nagłówek, wynik walidacji/konta/zaproszenia per wiersz, BOM, escapowanie komórek (formuły), nagłówki pliku', async () => {
      // E-mail może zaczynać się od "+", a nazwa działu od dowolnego znaku - komórki muszą być escapowane przed formułami.
      const plus = `+formula-${suffix}${IMPORT_DOMAIN}`;
      const id = await importPeople(orgA, [`${plus},Jan,Kowalski,Imp-Dział`, `${imp('ok')},Ewa,Nowak,`, 'zly,Anna,Nowak,', `${orgA.adminEmail},Admin,Istniejacy,`]);
      await inviter.processOrganization(orgA.organizationId, new Date());

      const response = await get(orgA.adminToken, `/users/import/${id}/report.csv`).expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['cache-control']).toContain('no-store');
      const text = response.text;
      const lines = (text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text).trim().split('\r\n');
      expect(lines[0]).toBe('Wiersz,E-mail,Imię,Nazwisko,Dział,Walidacja,Powód walidacji,Konto,Powód (konto),Zaproszenie,Powód (zaproszenie)');
      expect(lines[1]).toContain(`'${plus}`); // apostrof przed "+": Excel nie potraktuje komórki jako formuły
      expect(lines[1]).toContain('Poprawny');
      expect(lines[1]).toContain('Utworzono');
      expect(lines[1]).toContain('Wysłano');
      expect(lines.find((line) => line.includes('zly'))).toContain('Błąd');
      expect(lines.find((line) => line.includes(orgA.adminEmail))).toContain('Konto już istnieje');
      // Żadna komórka nie zaczyna się od znaku formuły bez apostrofu.
      for (const cell of lines.slice(1).flatMap((line) => line.split(','))) {
        expect(cell.replace(/^"/, '')).not.toMatch(/^[=+\-@|]/);
      }
    });

    it('raport przed potwierdzeniem zawiera sam wynik walidacji (bez kolumn konta i zaproszenia)', async () => {
      clearThrottle();
      const preview = await upload(orgA.adminToken, csvOf([...people(1), 'zly,Jan,Kowalski,'])).expect(201);

      const response = await get(orgA.adminToken, `/users/import/${preview.body.id}/report.csv`).expect(200);

      const lines = response.text.trim().split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain('Poprawny');
      expect(lines[2]).toContain('Błąd');
    });

    it('raport: błąd (403/404) to zawsze JSON, nigdy pobieralny plik; izolacja A/B; role', async () => {
      const id = await importPeople(orgA, people(1));

      const other = await get(orgB.adminToken, `/users/import/${id}/report.csv`).expect(404);
      const employee = await get(employeeToken, `/users/import/${id}/report.csv`).expect(403);

      for (const response of [other, employee]) {
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).toContain('application/json');
      }
      await request(app.getHttpServer()).get(`/users/import/${id}/report.csv`).expect(401);
      await get(orgA.adminToken, `/users/import/${id}/report.csv`).expect(200);
    });
  });

  // ---- izolacja, role, baza ----------------------------------------------------------------------------------------

  describe('izolacja organizacji, role i gwarancje bazy', () => {
    it('admin B nie potwierdza, nie zatrzymuje i nie czyta cudzego importu (404); pracownik 403 na potwierdzeniu i zatrzymaniu', async () => {
      const preview = await upload(orgA.adminToken, csvOf(people(2))).expect(201);
      clearThrottle();

      await post(orgB.adminToken, `/users/import/${preview.body.id}/confirm`).expect(404);
      await post(employeeToken, `/users/import/${preview.body.id}/confirm`).expect(403);
      await post(employeeToken, `/users/import/${preview.body.id}/stop`).expect(403);
      await post(orgB.adminToken, `/users/import/${preview.body.id}/stop`).expect(404);

      expect((await batchRow(orgA, preview.body.id)).status).toBe('PREVIEW');
      expect(await users(orgA)).toHaveLength(0);
    });

    it('RLS: wyniki wierszy (konta, zaproszenia) jednej organizacji są niewidoczne w kontekście drugiej', async () => {
      const id = await importPeople(orgA, people(2));

      const seen = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.userImportRow.findMany({ where: { batchId: id }, select: { id: true } }));

      expect(seen).toEqual([]);
    });

    it('CHECK: wynik konta tylko dla wierszy VALID, porażka wymaga powodu, zaproszenie tylko dla utworzonego konta', async () => {
      const preview = await upload(orgA.adminToken, csvOf([...people(1), 'zly,Jan,Kowalski,'])).expect(201);
      const [valid, error] = await rowsOf(orgA, preview.body.id);
      const update = (id: string, data: Record<string, unknown>) => tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.userImportRow.update({ where: { id }, data: data as never }));

      await expect(update(error.id, { accountResult: 'CREATED' })).rejects.toThrow(); // wiersz ERROR nie ma wyniku konta
      await expect(update(valid.id, { accountResult: 'FAILED' })).rejects.toThrow(); // porażka bez powodu
      await expect(update(valid.id, { inviteStatus: 'PENDING' })).rejects.toThrow(); // zaproszenie bez utworzonego konta
      await expect(update(valid.id, { accountResult: 'FAILED', accountReason: 'powód' })).resolves.toBeDefined();
    });

    it('retencja: zakończony import jest kasowany po 30 dniach od zakończenia (razem z wierszami z danymi z pliku); konta zostają', async () => {
      const id = await importPeople(orgA, people(3));
      await inviter.processOrganization(orgA.organizationId, new Date());
      const batch = await batchRow(orgA, id);
      expect(batch.status).toBe('COMPLETED');

      const early = await retention.run(new Date((batch.completedAt as Date).getTime() + REPORT_TTL_MS - 60_000));
      expect(await rowsOf(orgA, id)).toHaveLength(3);
      const late = await retention.run(new Date((batch.completedAt as Date).getTime() + REPORT_TTL_MS + 60_000));

      expect(early.failed + late.failed).toBe(0);
      expect(late.deleted).toBeGreaterThanOrEqual(1);
      expect(await rowsOf(orgA, id)).toHaveLength(0);
      expect(await users(orgA)).toHaveLength(3); // utworzone konta nie są usuwane
    });

    it('usunięcie konta autora potwierdzenia nie psuje partii; kopia e-maila potwierdzającego zostaje', async () => {
      const token = await addUser(orgA, 'confirmer-imp', 'ORG_ADMIN');
      clearThrottle();
      const preview = await upload(token, csvOf(people(2))).expect(201);
      clearThrottle();
      await post(token, `/users/import/${preview.body.id}/confirm`).expect(200);
      const confirmer = await tenantPrisma.runAuthLookup({ email: email('confirmer-imp') });

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: confirmer!.id } }));

      expect(await batchRow(orgA, preview.body.id)).toMatchObject({ createdByUserId: null, confirmedByEmail: email('confirmer-imp'), status: 'PROCESSING' });
    });
  });
});
