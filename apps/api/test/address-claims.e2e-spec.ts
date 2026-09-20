import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RegistrationMailLimiter } from '../src/auth/registration-mail-limiter';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { IMPORT_DAILY_ACCOUNTS_FACTOR } from '../src/users/import/user-import.service';
import { UserImportInviteService } from '../src/users/import/user-import-invite.service';
import { InviteExpiryService } from '../src/users/invite-expiry.service';
import { INVITE_EXPIRY_DAYS } from '../src/users/invited-accounts';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const DAY = 24 * 3_600_000;

interface Org {
  organizationId: string;
  adminToken: string;
  adminEmail: string;
}

// Pierwszeństwo do adresu e-mail i brak sondy istnienia kont: zaproszenie/import na adres zajęty w INNEJ organizacji wygląda dla
// administratora jak zwykłe zaproszenie (właściciel dostaje "ktoś próbował Cię dodać"), a nieaktywowane zaproszenie nie blokuje
// adresu organizacji ze zweryfikowaną domeną; do tego wygasanie zaproszeń po 30 dniach, limit importu i izolacja dziennika.
describe('Pierwszeństwo do adresu, brak sondy istnienia kont, wygasanie zaproszeń (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let inviter: UserImportInviteService;
  let expiry: InviteExpiryService;
  let owner: PrismaClient;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'address-claims-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  // Adresy w domenie, którą organizacja B "weryfikuje" w danym teście (domena unikalna na test: indeks unikalności zweryfikowanych).
  const inDomain = (domain: string, local: string) => `${local}-${suffix}@${domain}`;
  let orgA: Org;
  let orgB: Org;

  // Limiter "jedna wiadomość na skrzynkę na 10 minut" jest w Redisie: własny prefiks kluczy i czyszczenie przed każdym testem
  // (dotyka wyłącznie kluczy tego pakietu).
  async function clearLimiterKeys(): Promise<void> {
    const redis = app.get(RedisService);
    if (!redis.client) {
      throw new Error('Ten pakiet e2e wymaga Redisa (REDIS_URL) - limiter maili jest w Redisie.');
    }
    for (const namespace of ['reg-mail', 'invite-notice']) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.client.scan(cursor, 'MATCH', redis.key(namespace, '*'), 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) await redis.client.del(...keys);
      } while (cursor !== '0');
    }
  }

  beforeAll(async () => {
    process.env.REDIS_KEY_PREFIX = `unfooly-test-claims-${suffix}`;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    inviter = app.get(UserImportInviteService);
    expiry = app.get(InviteExpiryService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    orgA = await newOrg('a');
    orgB = await newOrg('b');
  }, 90_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await clearLimiterKeys();
    delete process.env.REDIS_KEY_PREFIX;
    await app.close();
  });

  const clearThrottle = () => (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  beforeEach(async () => {
    clearThrottle();
    await clearLimiterKeys();
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
    await prisma.organization.updateMany({ where: { id: { in: [orgA.organizationId, orgB.organizationId] } }, data: { seatsLimit: 10_000 } });
  });

  // Czysty stan: partie, tokeny, dziennik, konta dodane w testach (poza fixture) i domeny dopisane w testach.
  afterEach(async () => {
    const ids = [orgA.organizationId, orgB.organizationId];
    await owner.userImportBatch.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.passwordResetToken.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.inviteNotice.deleteMany({ where: { organizationId: { in: ids } } });
    await owner.user.deleteMany({ where: { organizationId: { in: ids }, email: { contains: `-${suffix}@` }, NOT: { email: { in: [orgA.adminEmail, orgB.adminEmail] } } } });
    await owner.organizationDomain.deleteMany({ where: { organizationId: { in: ids }, verifiedAt: { not: null } } });
  });

  async function newOrg(label: string): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { organizationId: admin!.organizationId, adminToken: body.accessToken, adminEmail: credentials.email };
  }

  const verifyDomain = (org: Org, domain: string) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.organizationDomain.create({ data: { organizationId: org.organizationId, domain, verificationToken: 'tok', verifiedAt: new Date() } }),
    );
  const owned = (address: string) => tenantPrisma.runAuthLookup({ email: address });
  const notices = (org: Org) => owner.inviteNotice.count({ where: { organizationId: org.organizationId } });
  const mailsTo = (to: string, templateName: string) => sendSpy.mock.calls.map(([o]) => o as { to: string; templateName: string }).filter((o) => o.to === to && o.templateName === templateName);
  const invite = (org: Org, address: string, extra: Record<string, unknown> = {}) => {
    clearThrottle();
    return request(app.getHttpServer())
      .post('/users/invite')
      .set('Authorization', `Bearer ${org.adminToken}`)
      .send({ email: address, firstName: 'Jan', lastName: 'Kowalski', role: 'EMPLOYEE', ...extra });
  };
  const csvOf = (addresses: string[]) => ['email,firstName,lastName,departmentName', ...addresses.map((a) => `${a},Anna,Nowak,`)].join('\n');
  async function importAddresses(org: Org, addresses: string[]): Promise<string> {
    clearThrottle();
    const preview = await request(app.getHttpServer())
      .post('/users/import/preview')
      .set('Authorization', `Bearer ${org.adminToken}`)
      .attach('file', Buffer.from(csvOf(addresses), 'utf-8'), { filename: 'lista.csv', contentType: 'text/csv' })
      .expect(201);
    clearThrottle();
    await request(app.getHttpServer()).post(`/users/import/${preview.body.id}/confirm`).set('Authorization', `Bearer ${org.adminToken}`).expect(200);
    return preview.body.id as string;
  }
  const rowsOf = (org: Org, batchId: string) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.userImportRow.findMany({ where: { batchId }, orderBy: { line: 'asc' } }));

  // ---- zaproszenie pojedyncze: brak sondy ---------------------------------------------------------------------------

  describe('zaproszenie pojedyncze na adres zajęty w innej organizacji', () => {
    it('odpowiedź identyczna jak dla nowego adresu, konta w A nie ma, właściciel dostaje powiadomienie, dziennik liczy próbę', async () => {
      const fresh = await invite(orgA, inDomain(`fresh.${domainSuffix}`, 'nowy')).expect(201);

      const taken = await invite(orgA, orgB.adminEmail).expect(201);

      // Ta sama forma odpowiedzi (klucze i typy), status INVITED, "wysłano".
      expect(Object.keys(taken.body).sort()).toEqual(Object.keys(fresh.body).sort());
      expect(Object.entries(taken.body).map(([k, v]) => [k, typeof v]).sort()).toEqual(Object.entries(fresh.body).map(([k, v]) => [k, typeof v]).sort());
      expect(taken.body).toMatchObject({ email: orgB.adminEmail, status: 'INVITED', role: 'EMPLOYEE', inviteEmailSent: true });
      expect(taken.body.id).toHaveLength(fresh.body.id.length);
      // Konto B nietknięte, w A nie powstało nic.
      expect(await owned(orgB.adminEmail)).toMatchObject({ organizationId: orgB.organizationId, status: 'ACTIVE', role: 'ORG_ADMIN' });
      expect(await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.count({ where: { organizationId: orgA.organizationId, email: orgB.adminEmail } }))).toBe(0);
      // Właściciel: "ktoś próbował Cię dodać" (bez linku aktywacyjnego do cudzej organizacji).
      expect(mailsTo(orgB.adminEmail, 'invite-address-taken')).toHaveLength(1);
      expect(mailsTo(orgB.adminEmail, 'user-invite')).toHaveLength(0);
      expect(await notices(orgA)).toBe(1);
      expect(await notices(orgB)).toBe(0);
    });

    it('konto w TEJ organizacji: ogólny błąd 400 (administrator widzi własną listę), bez powiadomienia', async () => {
      await invite(orgA, orgA.adminEmail).expect(400);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(await notices(orgA)).toBe(0);
    });

    it('powiadomienia liczą się do dobowego limitu zaproszeń: sondowanie adresów nie omija limitu 300', async () => {
      await owner.inviteNotice.createMany({ data: Array.from({ length: 300 }, () => ({ organizationId: orgA.organizationId })) });

      await invite(orgA, inDomain(`fresh.${domainSuffix}`, 'limit')).expect(429);
      await invite(orgA, orgB.adminEmail).expect(429);
    });

    it('limit skrzynki dla powiadomień jest OSOBNY od limitu maili rejestracyjnych: powiadomienie nie wycisza maila aktywacyjnego (i odwrotnie)', async () => {
      // Okno rejestracyjne skrzynki zajęte: powiadomienie mimo to wychodzi.
      expect(await app.get(RegistrationMailLimiter).tryAcquire(orgB.adminEmail)).toBe(true);
      await invite(orgA, orgB.adminEmail).expect(201);
      expect(mailsTo(orgB.adminEmail, 'invite-address-taken')).toHaveLength(1);

      // Okno powiadomień zajęte: mail rejestracyjny tej skrzynki nadal przechodzi przez SWÓJ limiter (nowy klucz, nie zajęty).
      await clearLimiterKeys();
      await invite(orgA, orgB.adminEmail).expect(201);
      expect(await app.get(RegistrationMailLimiter).tryAcquire(orgB.adminEmail)).toBe(true);
    });

    it('powtórzone próby na ten sam adres: jedna wiadomość na skrzynkę w oknie (ochrona właściciela), wszystkie wyglądają na udane', async () => {
      await invite(orgA, orgB.adminEmail).expect(201);
      await invite(orgA, orgB.adminEmail).expect(201);
      await invite(orgA, orgB.adminEmail).expect(201);

      expect(mailsTo(orgB.adminEmail, 'invite-address-taken').length).toBeLessThanOrEqual(1);
      expect(await notices(orgA)).toBe(3);
    });
  });

  // ---- pierwszeństwo organizacji ze zweryfikowaną domeną ------------------------------------------------------------

  describe('pierwszeństwo organizacji ze zweryfikowaną domeną adresu', () => {
    it('zaproszenie: nieaktywowane zaproszenie obcej organizacji wygasa, adres przejmuje B, konto powstaje w B (izolacja: A traci konto, B nie widzi danych A)', async () => {
      const domain = `zaproszenie.${domainSuffix}`;
      const address = inDomain(domain, 'ktos');
      await invite(orgA, address).expect(201); // A nie ma domeny: konto INVITED powstaje normalnie
      expect(await owned(address)).toMatchObject({ organizationId: orgA.organizationId, status: 'INVITED' });
      await verifyDomain(orgB, domain);

      const response = await invite(orgB, address).expect(201);

      expect(await owned(address)).toMatchObject({ organizationId: orgB.organizationId, status: 'INVITED' });
      expect(response.body).toMatchObject({ email: address, status: 'INVITED', inviteEmailSent: true });
      expect(await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.count({ where: { organizationId: orgA.organizationId, email: address } }))).toBe(0);
      expect(mailsTo(address, 'user-invite')).toHaveLength(2); // A i B; przejęcie nie wysyła "ktoś próbował"
      expect(mailsTo(address, 'invite-address-taken')).toHaveLength(0);
      expect(await notices(orgB)).toBe(0);
    });

    it('A NIE przejmie adresu od B (B ma zweryfikowaną domenę, A nie): odpowiedź jak dla nowego adresu, konto B nietknięte', async () => {
      const domain = `odwrotnie.${domainSuffix}`;
      const address = inDomain(domain, 'osoba');
      await verifyDomain(orgB, domain);
      await invite(orgB, address).expect(201);

      const response = await invite(orgA, address).expect(201);

      expect(response.body).toMatchObject({ email: address, status: 'INVITED', inviteEmailSent: true });
      expect(await owned(address)).toMatchObject({ organizationId: orgB.organizationId });
      expect(mailsTo(address, 'invite-address-taken')).toHaveLength(1);
    });

    it('konto ZAKTYWOWANE nigdy nie jest przejmowane, nawet przez organizację ze zweryfikowaną domeną', async () => {
      const domain = `aktywne.${domainSuffix}`;
      const address = inDomain(domain, 'aktywny');
      await invite(orgA, address).expect(201);
      await owner.user.updateMany({ where: { email: address }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } });
      await verifyDomain(orgB, domain);

      await invite(orgB, address).expect(201);

      expect(await owned(address)).toMatchObject({ organizationId: orgA.organizationId, status: 'ACTIVE' });
      expect(mailsTo(address, 'invite-address-taken')).toHaveLength(1);
    });

    it('konto ORG_ADMIN nie jest przejmowane (organizacja nie zostanie bez administratora)', async () => {
      const domain = `admin.${domainSuffix}`;
      await verifyDomain(orgB, domain);
      const adminAddress = inDomain(domain, 'szef');
      await owner.user.create({ data: { organizationId: orgA.organizationId, email: adminAddress, passwordHash: 'x', role: 'ORG_ADMIN', status: 'INVITED' } });

      await invite(orgB, adminAddress).expect(201);

      expect(await owned(adminAddress)).toMatchObject({ organizationId: orgA.organizationId, role: 'ORG_ADMIN' });
    });

    it('import: B ze zweryfikowaną domeną przejmuje adres (kolejka), zaproszenie A wygasa ze statusem "wygasło" bez informacji o przejęciu', async () => {
      const domain = `import.${domainSuffix}`;
      const address = inDomain(domain, 'osoba');
      const batchA = await importAddresses(orgA, [address]);
      await inviter.processOrganization(orgA.organizationId, new Date());
      expect(await owned(address)).toMatchObject({ organizationId: orgA.organizationId });
      await verifyDomain(orgB, domain);

      const batchB = await importAddresses(orgB, [address]);
      await inviter.processOrganization(orgB.organizationId, new Date());

      // B: konto istnieje, wiersz jak każdy inny (zaproszenie wysłane).
      expect(await owned(address)).toMatchObject({ organizationId: orgB.organizationId, status: 'INVITED' });
      const [rowB] = await rowsOf(orgB, batchB);
      expect(rowB).toMatchObject({ accountResult: 'CREATED', inviteStatus: 'SENT', addressTaken: false });
      expect(rowB.userId).toBeTruthy();
      expect(mailsTo(address, 'user-invite')).toHaveLength(2);
      expect(mailsTo(address, 'invite-address-taken')).toHaveLength(0);
      // A: zaproszenie wygasło, powód ogólny.
      const [rowA] = await rowsOf(orgA, batchA);
      expect(rowA).toMatchObject({ inviteStatus: 'EXPIRED', inviteReason: 'Zaproszenie wygasło', userId: null });
      expect(JSON.stringify(rowA)).not.toContain(orgB.organizationId);
    });

    it('import bez zweryfikowanej domeny: adres zajęty w innej organizacji => powiadomienie do właściciela, konta w A nie ma, wiersz "wysłano"', async () => {
      const address = orgB.adminEmail;
      const batch = await importAddresses(orgA, [address, inDomain(`swiezy.${domainSuffix}`, 'nowa')]);

      await inviter.processOrganization(orgA.organizationId, new Date());

      const rows = await rowsOf(orgA, batch);
      expect(rows.map((r) => [r.accountResult, r.inviteStatus, r.inviteReason])).toEqual([['CREATED', 'SENT', null], ['CREATED', 'SENT', null]]);
      expect(rows[0].userId).toBeNull();
      expect(mailsTo(address, 'invite-address-taken')).toHaveLength(1);
      expect(await notices(orgA)).toBe(1);
    });
  });

  // ---- limit importu nowych kont na dobę ----------------------------------------------------------------------------

  describe('limit importu nowych kont na dobę (2 x seatsLimit)', () => {
    async function seedHistory(org: Org, count: number) {
      const batch = await owner.userImportBatch.create({
        data: {
          organizationId: org.organizationId,
          createdByEmail: org.adminEmail,
          status: 'COMPLETED',
          delimiter: ',',
          totalRows: count,
          validCount: count,
          existingCount: 0,
          errorCount: 0,
          skippedEmpty: 0,
          ignoredColumns: [],
          expiresAt: new Date(Date.now() + DAY),
          confirmedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await owner.userImportRow.createMany({
        data: Array.from({ length: count }, (_v, i) => ({
          organizationId: org.organizationId,
          batchId: batch.id,
          line: i + 2,
          email: `hist${i}-${suffix}@hist.${domainSuffix}`,
          firstName: 'H',
          lastName: 'H',
          status: 'VALID' as const,
          accountResult: 'CREATED' as const,
        })),
      });
    }

    it('import ponad limit kroczących 24 h => 429 IMPORT_DAILY_LIMIT, konta nie powstają; w granicach limitu przechodzi', async () => {
      await prisma.organization.update({ where: { id: orgA.organizationId }, data: { seatsLimit: 6 } });
      const limit = IMPORT_DAILY_ACCOUNTS_FACTOR * 6;
      await seedHistory(orgA, limit - 1);
      const before = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.count({ where: { organizationId: orgA.organizationId } }));
      clearThrottle();
      const preview = await request(app.getHttpServer())
        .post('/users/import/preview')
        .set('Authorization', `Bearer ${orgA.adminToken}`)
        .attach('file', Buffer.from(csvOf([inDomain(`lim.${domainSuffix}`, 'a'), inDomain(`lim.${domainSuffix}`, 'b')]), 'utf-8'), { filename: 'lista.csv', contentType: 'text/csv' })
        .expect(201);
      clearThrottle();

      const rejected = await request(app.getHttpServer()).post(`/users/import/${preview.body.id}/confirm`).set('Authorization', `Bearer ${orgA.adminToken}`).expect(429);

      expect(rejected.body.code).toBe('IMPORT_DAILY_LIMIT');
      expect(await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.count({ where: { organizationId: orgA.organizationId } }))).toBe(before);
      // Wiersze wyjęte z 24 h (stara partia) nie liczą się do limitu.
      await owner.userImportBatch.updateMany({ where: { organizationId: orgA.organizationId, status: 'COMPLETED' }, data: { confirmedAt: new Date(Date.now() - 25 * 3_600_000) } });
      clearThrottle();
      await request(app.getHttpServer()).post(`/users/import/${preview.body.id}/confirm`).set('Authorization', `Bearer ${orgA.adminToken}`).expect(200);
    });

    it('izolacja: historia importów organizacji A nie zużywa limitu organizacji B', async () => {
      await prisma.organization.updateMany({ where: { id: { in: [orgA.organizationId, orgB.organizationId] } }, data: { seatsLimit: 6 } });
      await seedHistory(orgA, IMPORT_DAILY_ACCOUNTS_FACTOR * 6);

      await importAddresses(orgB, [inDomain(`iz.${domainSuffix}`, 'x')]); // wystarczy, że nie rzuca (200)
    });
  });

  // ---- wygasanie zaproszeń po 30 dniach -----------------------------------------------------------------------------

  describe('job wygaszania zaproszeń (30 dni)', () => {
    const OLD = new Date(Date.now() - (INVITE_EXPIRY_DAYS + 1) * DAY);

    it('wygasza nieaktywowane po 30 dniach (z oznaczeniem wiersza importu), oszczędza świeże, aktywne i ORG_ADMIN; idempotentny; osobno dla każdej organizacji', async () => {
      const batch = await importAddresses(orgA, [inDomain(`wyg.${domainSuffix}`, 'imp')]);
      await inviter.processOrganization(orgA.organizationId, new Date());
      const stale = await owned(inDomain(`wyg.${domainSuffix}`, 'imp'));
      await owner.user.update({ where: { id: stale!.id }, data: { createdAt: OLD } });
      const make = (org: Org, local: string, over: Record<string, unknown>) =>
        owner.user.create({ data: { organizationId: org.organizationId, email: inDomain(`wyg.${domainSuffix}`, local), passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED', ...over } });
      await make(orgA, 'swiezy', { createdAt: new Date(Date.now() - 29 * DAY) });
      await make(orgA, 'aktywny', { createdAt: OLD, status: 'ACTIVE', emailVerifiedAt: new Date() });
      await make(orgA, 'admin', { createdAt: OLD, role: 'ORG_ADMIN' });
      await make(orgB, 'starb', { createdAt: OLD });

      const first = await expiry.run(new Date());

      expect(first.failed).toBe(0);
      expect(first.expired).toBeGreaterThanOrEqual(2);
      expect(await owned(inDomain(`wyg.${domainSuffix}`, 'imp'))).toBeNull();
      expect(await owned(inDomain(`wyg.${domainSuffix}`, 'starb'))).toBeNull();
      for (const kept of ['swiezy', 'aktywny', 'admin']) {
        expect(await owned(inDomain(`wyg.${domainSuffix}`, kept))).not.toBeNull();
      }
      const [row] = await rowsOf(orgA, batch);
      expect(row).toMatchObject({ inviteStatus: 'EXPIRED', inviteReason: 'Zaproszenie wygasło', userId: null });
      const second = await expiry.run(new Date());
      expect(second.expired).toBe(0);
    });

    it('dziennik powiadomień starszy niż 2 dni jest kasowany (tylko własnej organizacji nie dotyka cudzych świeżych wpisów)', async () => {
      await owner.inviteNotice.createMany({
        data: [
          { organizationId: orgA.organizationId, createdAt: new Date(Date.now() - 3 * DAY) },
          { organizationId: orgA.organizationId, createdAt: new Date(Date.now() - 1 * DAY) },
          { organizationId: orgB.organizationId, createdAt: new Date() },
        ],
      });

      await expiry.run(new Date());

      expect(await notices(orgA)).toBe(1);
      expect(await notices(orgB)).toBe(1);
    });

    it('granica 30 dni: konto starsze o dzień wygasa, młodsze o dzień nie (zegar zamrożony parametrem)', async () => {
      const created = new Date(Date.now() - 10 * DAY);
      await owner.user.create({ data: { organizationId: orgA.organizationId, email: inDomain(`gran.${domainSuffix}`, 'g'), passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED', createdAt: created } });

      await expiry.run(new Date(created.getTime() + (INVITE_EXPIRY_DAYS - 1) * DAY));
      expect(await owned(inDomain(`gran.${domainSuffix}`, 'g'))).not.toBeNull();
      await expiry.run(new Date(created.getTime() + (INVITE_EXPIRY_DAYS + 1) * DAY));
      expect(await owned(inDomain(`gran.${domainSuffix}`, 'g'))).toBeNull();
    });
  });

  // ---- izolacja dziennika i ograniczenia bazy -----------------------------------------------------------------------

  describe('dziennik powiadomień (RLS) i ograniczenia bazy', () => {
    it('RLS: B nie widzi wpisów A, nie zapisze wpisu w imieniu A, nie usunie cudzych', async () => {
      await owner.inviteNotice.create({ data: { organizationId: orgA.organizationId } });

      const seenByB = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.inviteNotice.findMany({}));
      expect(seenByB).toHaveLength(0);
      await expect(tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.inviteNotice.create({ data: { organizationId: orgA.organizationId } }))).rejects.toBeDefined();
      const deleted = await tenantPrisma.runInOrgContext(orgB.organizationId, (tx) => tx.inviteNotice.deleteMany({}));
      expect(deleted.count).toBe(0);
      expect(await notices(orgA)).toBe(1);
    });

    it('CHECK: wiersz z zajętym adresem nie może mieć konta ani wyniku innego niż CREATED', async () => {
      const batch = await importAddresses(orgA, [inDomain(`chk.${domainSuffix}`, 'c')]);
      const [row] = await rowsOf(orgA, batch);
      const account = await owned(inDomain(`chk.${domainSuffix}`, 'c'));

      await expect(owner.userImportRow.update({ where: { id: row.id }, data: { addressTaken: true, userId: account!.id } })).rejects.toBeDefined();
      await expect(owner.userImportRow.update({ where: { id: row.id }, data: { addressTaken: true, userId: null, accountResult: null, inviteStatus: null } })).rejects.toBeDefined();
    });
  });
});
