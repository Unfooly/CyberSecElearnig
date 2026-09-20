import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { REGISTRATION_ACCEPTED_MESSAGE, RegistrationService } from '../src/auth/registration.service';
import { EmailService } from '../src/email/email.service';
import { RedisService } from '../src/redis/redis.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { postRegister, registrationPayload } from './helpers/auth';

// Samoobsługowa rejestracja firmy: dane, domena publiczna, brak hasła w
// rejestracji (link "ustaw hasło" = potwierdzenie skrzynki), anty-enumeracja,
// zgody, wyścigi, izolacja nowych tabel.
describe('Rejestracja firmy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'registration-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;
  // Wszystkie nazwy kończą się sufiksem - afterAll sprząta po nazwie.
  const orgName = (label: string) => `Firma ${label}.${domainSuffix}`;

  beforeAll(async () => {
    // Własny prefiks kluczy Redisa: czyszczenie limitera w testach nie dotyka kluczy innego środowiska.
    process.env.REDIS_KEY_PREFIX = `unfooly-test-reg-${suffix}`;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });

  beforeEach(() => {
    sendSpy.mockClear();
    // /auth/register ma limit 10 żądań/min na IP (throttler w pamięci) - czyścimy
    // magazyn, żeby testy nie blokowały się nawzajem (429).
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await clearLimiterKeys();
    delete process.env.REDIS_KEY_PREFIX;
    await app.close();
  });

  async function orgOf(userEmail: string) {
    const user = await tenantPrisma.runAuthLookup({ email: userEmail });
    return { user: user!, organizationId: user!.organizationId };
  }

  // Link z maila rejestracyjnego -> surowy token (z ostatniego maila 'registration-activation').
  function activationTokenFromMail(): string {
    const call = [...sendSpy.mock.calls].reverse().find(([opts]) => opts.templateName === 'registration-activation');
    expect(call).toBeDefined();
    const url = (call![0].templateData as { activationUrl: string }).activationUrl;
    expect(new URL(url).pathname).toBe('/reset-password');
    return new URL(url).searchParams.get('token') as string;
  }

  // Symuluje upływ okna limitera maili (10 min): stan limitera jest w Redisie i wygasa wg
  // czasu Redisa (zegar aplikacji go nie dotyczy), więc usuwamy klucze limitera. Dotyczy to
  // WYŁĄCZNIE unikalnego prefiksu tego pakietu (REDIS_KEY_PREFIX ustawiony w beforeAll).
  async function withClockAdvanced<T>(fn: () => Promise<T>): Promise<T> {
    await clearLimiterKeys();
    return fn();
  }

  async function clearLimiterKeys(): Promise<void> {
    const redis = app.get(RedisService);
    if (!redis.client) {
      throw new Error('Ten pakiet e2e wymaga Redisa (REDIS_URL) - limiter maili jest w Redisie.');
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.client.scan(cursor, 'MATCH', redis.key('reg-mail', '*'), 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await redis.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  describe('utworzone dane', () => {
    it('tworzy organizację PENDING z podaną nazwą, admina bez hasła (INVITED), dane do faktury, domenę do weryfikacji i dwie zgody', async () => {
      const adminEmail = email('full');
      const response = await postRegister(app, adminEmail, {
        organizationName: orgName('Wyświetlana'),
        organizationLegalName: 'Formalna Nazwa Sp. z o.o.',
        taxId: '526-025-02-74',
        addressLine: 'ul. Długa 5/7',
        postalCode: '80-001',
        city: 'Gdańsk',
        firstName: 'Zofia',
        lastName: 'Nowak-Kowalska',
      });
      expect(response.status).toBe(201);

      const { user, organizationId } = await orgOf(adminEmail);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org).toMatchObject({
        name: orgName('Wyświetlana'),
        status: 'PENDING_DOMAIN_VERIFICATION',
        selfJoinEnabled: false,
        unverifiedWarningSentAt: null,
      });
      expect(user).toMatchObject({
        role: 'ORG_ADMIN',
        status: 'INVITED',
        firstName: 'Zofia',
        lastName: 'Nowak-Kowalska',
        emailVerifiedAt: null,
      });

      const details = await tenantPrisma.runInOrgContext(organizationId, async (tx) => ({
        billing: await tx.organizationBillingDetails.findUnique({ where: { organizationId } }),
        domains: await tx.organizationDomain.findMany(),
        acceptances: await tx.legalAcceptance.findMany(),
      }));
      expect(details.billing).toMatchObject({
        legalName: 'Formalna Nazwa Sp. z o.o.',
        taxId: '5260250274',
        addressLine: 'ul. Długa 5/7',
        postalCode: '80-001',
        city: 'Gdańsk',
        country: 'PL',
      });
      expect(details.domains).toHaveLength(1);
      expect(details.domains[0]).toMatchObject({ domain: `full.${domainSuffix}`, verifiedAt: null });
      expect(details.domains[0].verificationToken).toMatch(/^[0-9a-f]{64}$/);
      expect(details.acceptances.map((a) => [a.documentType, a.version, a.userId]).sort()).toEqual([
        ['PRIVACY_POLICY', 'draft-1', user.id],
        ['TERMS', 'draft-1', user.id],
      ]);
    });

    it('nazwa organizacji NIE jest wyprowadzana z domeny e-maila', async () => {
      const adminEmail = email('nameless');
      await postRegister(app, adminEmail, { organizationName: orgName('Zupełnie Inna') });

      const { organizationId } = await orgOf(adminEmail);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org.name).toBe(orgName('Zupełnie Inna'));
      expect(org.name).not.toBe(`nameless.${domainSuffix}`);
    });

    it('dwie organizacje mogą czekać na TĘ SAMĄ domenę (obie PENDING, domeny niezweryfikowane)', async () => {
      const first = `owner-${suffix}@shared.${domainSuffix}`;
      const second = `newcomer-${suffix}@shared.${domainSuffix}`;
      expect((await postRegister(app, first)).status).toBe(201);
      expect((await postRegister(app, second)).status).toBe(201);

      const a = await orgOf(first);
      const b = await orgOf(second);
      expect(a.organizationId).not.toBe(b.organizationId);
      const domainsA = await tenantPrisma.runInOrgContext(a.organizationId, (tx) => tx.organizationDomain.findMany());
      const domainsB = await tenantPrisma.runInOrgContext(b.organizationId, (tx) => tx.organizationDomain.findMany());
      expect(domainsA[0].domain).toBe(domainsB[0].domain);
      expect([domainsA[0].verifiedAt, domainsB[0].verifiedAt]).toEqual([null, null]);
    });
  });

  describe('hasło ustawiane dopiero linkiem z maila (pre-hijacking)', () => {
    it('rejestracja NIE przyjmuje hasła: pole "password" => 400, konto nie powstaje', async () => {
      const adminEmail = email('withpw');

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...registrationPayload(adminEmail), password: 'SuperSecret123!' });

      expect(response.status).toBe(400);
      expect(await tenantPrisma.runAuthLookup({ email: adminEmail })).toBeNull();
    });

    it('mail rejestracyjny to link "ustaw hasło" (24 h) - nie zwykły link weryfikacyjny; przed kliknięciem nie da się zalogować', async () => {
      const adminEmail = email('activate');
      await postRegister(app, adminEmail);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: adminEmail, templateName: 'registration-activation' }),
      );
      const { user, organizationId } = await orgOf(adminEmail);
      const tokens = await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.passwordResetToken.findMany({ where: { userId: user.id } }),
      );
      expect(tokens).toHaveLength(1);
      const hoursLeft = (tokens[0].expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hoursLeft).toBeGreaterThan(23.9);
      expect(hoursLeft).toBeLessThanOrEqual(24);

      // Żadne hasło nie jest znane nikomu (hash zastępczy) - logowanie odrzucone.
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: 'SuperSecret123!' }).expect(401);
    });

    it('link z maila ustawia hasło, potwierdza skrzynkę i aktywuje konto; drugi raz nie zadziała; organizacja zostaje PENDING', async () => {
      const adminEmail = email('setpw');
      await postRegister(app, adminEmail);
      const token = activationTokenFromMail();

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'Moje-Wlasne-Haslo-1!' })
        .expect(200);

      const { user, organizationId } = await orgOf(adminEmail);
      expect(user).toMatchObject({ status: 'ACTIVE' });
      expect(user.emailVerifiedAt).not.toBeNull();
      const reuse = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'Inne-Haslo-999!' })
        .expect(400);
      expect(reuse.body.code).toBe('TOKEN_ALREADY_USED');

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: 'Moje-Wlasne-Haslo-1!' })
        .expect(200);
      expect(login.body.accessToken).toEqual(expect.any(String));
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org.status).toBe('PENDING_DOMAIN_VERIFICATION');
    });

    it('atak: ktoś rejestruje adres ofiary - ofiara klika link i sama ustawia hasło, atakujący nie ma żadnego', async () => {
      const victim = email('victim');
      // "Atakujący" nie może podać hasła w rejestracji (400) - zostaje mu tylko wysłanie żądania.
      await postRegister(app, victim, { firstName: 'Ofiara' });
      const token = activationTokenFromMail();

      // Zgadywanie hasła atakującego (jedyne, co zna) nie działa przed kliknięciem.
      await request(app.getHttpServer()).post('/auth/login').send({ email: victim, password: 'HasloAtakujacego1!' }).expect(401);

      await request(app.getHttpServer()).post('/auth/reset-password').send({ token, newPassword: 'HasloOfiary-123!' }).expect(200);

      await request(app.getHttpServer()).post('/auth/login').send({ email: victim, password: 'HasloAtakujacego1!' }).expect(401);
      await request(app.getHttpServer()).post('/auth/login').send({ email: victim, password: 'HasloOfiary-123!' }).expect(200);
    });

    it('ponowna wysyłka (resend-verification) dla niepotwierdzonego admina PENDING: znów link "ustaw hasło"', async () => {
      const adminEmail = email('resend');
      await postRegister(app, adminEmail);
      sendSpy.mockClear();

      await request(app.getHttpServer()).post('/auth/resend-verification').send({ email: adminEmail }).expect(200);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: adminEmail, templateName: 'registration-activation' }),
      );
    });
  });

  describe('domena publiczna', () => {
    it.each(['gmail.com', 'wp.pl', 'o2.pl', 'onet.pl', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'yahoo.com'])(
      '%s => 400 PUBLIC_EMAIL_DOMAIN, nic nie powstaje, mail nie wychodzi',
      async (domain) => {
        const response = await postRegister(app, `nikt-${suffix}@${domain}`);

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('PUBLIC_EMAIL_DOMAIN');
        expect(response.body.message).toMatch(/domenie firmowej/i);
        expect(await tenantPrisma.runAuthLookup({ email: `nikt-${suffix}@${domain}` })).toBeNull();
        expect(sendSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe('domeny wewnętrzne i treść maila aktywacyjnego', () => {
    it.each(['firma.local', 'srv.firma.internal', 'ad.corp', 'router.lan'])('%s => 400 INVALID_EMAIL_DOMAIN, nic nie powstaje', async (domain) => {
      const response = await postRegister(app, `ktos-${suffix}@${domain}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_EMAIL_DOMAIN');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('mail aktywacyjny zawiera nazwę firmy (escapowaną) - ofiara rozpozna cudzą rejestrację', async () => {
      const adminEmail = email('mailname');
      const name = `Firma <b>"Ofiary"</b> & Syn ${domainSuffix}`;

      await postRegister(app, adminEmail, { organizationName: name });

      const call = sendSpy.mock.calls.find(([opts]) => opts.templateName === 'registration-activation')![0];
      expect(call.templateData).toMatchObject({ organizationName: name });
      const { renderTemplate } = await import('../src/email/templates');
      const rendered = renderTemplate('registration-activation', call.templateData as Record<string, unknown>)!;
      expect(rendered.html).toContain('Firma &lt;b&gt;');
      expect(rendered.html).not.toContain('<b>"Ofiary"');
      expect(rendered.text).toContain(name);
    });
  });

  describe('anty-enumeracja', () => {
    async function activate(adminEmail: string) {
      const { user, organizationId } = await orgOf(adminEmail);
      await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } }),
      );
    }

    it('odpowiedź (status i ciało) jest identyczna dla nowego adresu, aktywnego konta i konta czekającego na link', async () => {
      const verified = email('enum-verified');
      const pending = email('enum-pending');
      await postRegister(app, verified);
      await postRegister(app, pending);
      await activate(verified);

      const forNew = await postRegister(app, email('enum-new'));
      const forVerified = await postRegister(app, verified);
      const forPending = await postRegister(app, pending);

      expect([forNew.status, forVerified.status, forPending.status]).toEqual([201, 201, 201]);
      expect(forVerified.body).toEqual(forNew.body);
      expect(forPending.body).toEqual(forNew.body);
      expect(Object.keys(forNew.body)).toEqual(['message']);
    });

    it('konto aktywne: nie powstaje nowa organizacja, właściciel dostaje mail "konto już istnieje"', async () => {
      const adminEmail = email('exists');
      await postRegister(app, adminEmail, { organizationName: orgName('Istniejąca') });
      await activate(adminEmail);
      sendSpy.mockClear();

      // Okno limitera (pierwsza rejestracja je zużyła) przesuwamy o 11 minut.
      const again = await withClockAdvanced(() =>
        postRegister(app, adminEmail, { organizationName: orgName('Nowa Nazwa') }),
      );

      expect(again.status).toBe(201);
      expect(await prisma.organization.count({ where: { name: orgName('Nowa Nazwa') } })).toBe(0);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: adminEmail, templateName: 'registration-existing-account' }),
      );
    });

    it('konto niepotwierdzone: po upływie okna limitera dostaje nowy link (nie informację o istnieniu konta)', async () => {
      const adminEmail = email('unverified');
      await postRegister(app, adminEmail);
      sendSpy.mockClear();

      const again = await withClockAdvanced(() => postRegister(app, adminEmail));

      expect(again.status).toBe(201);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: adminEmail, templateName: 'registration-activation' }));
    });

    it('limiter: seria żądań na ten sam adres w oknie 10 min nie wysyła nic ponad pierwszy mail; po oknie znów jeden', async () => {
      const adminEmail = email('spam');
      await postRegister(app, adminEmail);
      await activate(adminEmail);
      sendSpy.mockClear();

      for (let i = 0; i < 4; i += 1) {
        expect((await postRegister(app, adminEmail)).status).toBe(201);
      }
      expect(sendSpy).not.toHaveBeenCalled();

      await withClockAdvanced(() => postRegister(app, adminEmail));
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'registration-existing-account' }));
    });

    it('alias "+tag": rejestracje ofiara@ i ofiara+1@ dzielą limiter - do tej samej skrzynki idzie jeden mail', async () => {
      const base = `alias-${suffix}`;
      const domain = `alias.${domainSuffix}`;

      await postRegister(app, `${base}@${domain}`);
      await postRegister(app, `${base}+1@${domain}`);
      await postRegister(app, `${base}+2@${domain}`);

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    // Zapraszająca organizacja; `verifiedDomain` = ma ZWERYFIKOWANĄ domenę adresu zaproszonego (zaproszenie chronione).
    async function inviteEmployee(inviteeEmail: string, verifiedDomain: boolean) {
      const org = await prisma.organization.create({ data: { name: orgName('Zapraszająca'), status: 'ACTIVE' } });
      const user = await tenantPrisma.runInOrgContext(org.id, async (tx) => {
        if (verifiedDomain) {
          await tx.organizationDomain.create({ data: { organizationId: org.id, domain: inviteeEmail.split('@')[1], verificationToken: 'tok', verifiedAt: new Date() } });
        }
        return tx.user.create({
          data: { organizationId: org.id, email: inviteeEmail, passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED', firstName: 'Ida', lastName: 'Zaproszona' },
        });
      });
      return { org, user };
    }

    it('konto ZAPROSZONE przez organizację ze zweryfikowaną domeną adresu (INVITED, pracownik) dostaje link zaproszenia (user-invite), nie link rejestracji firmy', async () => {
      const inviteeEmail = email('invitee');
      await inviteEmployee(inviteeEmail, true);
      sendSpy.mockClear();

      const response = await postRegister(app, inviteeEmail);

      expect(response.status).toBe(201);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: inviteeEmail, templateName: 'user-invite' }));
    });

    // Link z maila `registration-claim` -> surowy token.
    function claimTokenFromMail(): string {
      const call = [...sendSpy.mock.calls].reverse().find(([opts]) => opts.templateName === 'registration-claim');
      expect(call).toBeDefined();
      return new URL((call![0].templateData as { claimUrl: string }).claimUrl).searchParams.get('token') as string;
    }
    const claim = (token: string) => request(app.getHttpServer()).post('/auth/claim-registration').send({ token });
    const userCountIn = (orgId: string, userId: string) => tenantPrisma.runInOrgContext(orgId, (tx) => tx.user.count({ where: { organizationId: orgId, id: userId } }));

    describe('rejestracja na adres z nieaktywowanym zaproszeniem BEZ zweryfikowanej domeny adresu: przejęcie dopiero po kliknięciu', () => {
      it('sam POST /register niczego nie kasuje ani nie przejmuje: zaproszenie zostaje, powstaje organizacja PENDING bez admina i wpis; link idzie na adres', async () => {
        const inviteeEmail = email('squat');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        sendSpy.mockClear();

        const response = await postRegister(app, inviteeEmail);

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE }); // identyczna jak dla nowego adresu
        expect(await userCountIn(org.id, user.id)).toBe(1); // zaproszenie nietknięte
        expect(await tenantPrisma.runAuthLookup({ email: inviteeEmail })).toMatchObject({ organizationId: org.id, status: 'INVITED' });
        const newOrg = await prisma.organization.findFirstOrThrow({ where: { name: inviteeEmail.split('@')[1], NOT: { id: org.id } } });
        expect(newOrg.status).toBe('PENDING_DOMAIN_VERIFICATION');
        expect(await tenantPrisma.runInOrgContext(newOrg.id, (tx) => tx.user.count({ where: { organizationId: newOrg.id } }))).toBe(0);
        expect(await tenantPrisma.runInOrgContext(newOrg.id, (tx) => tx.pendingAdminClaim.count({ where: { organizationId: newOrg.id, email: inviteeEmail } }))).toBe(1);
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: inviteeEmail, templateName: 'registration-claim' }));
      });

      it('klik w link: adres przejęty (zaproszenie wygasa), admin organizacji powstaje (ORG_ADMIN, INVITED, zgody), idzie link aktywacyjny; drugi klik = błąd', async () => {
        const inviteeEmail = email('claim');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        sendSpy.mockClear();

        const clicked = await claim(token).expect(200);

        expect(clicked.body.message).toMatch(/linkiem do ustawienia hasła/);
        const admin = await tenantPrisma.runAuthLookup({ email: inviteeEmail });
        expect(admin).toMatchObject({ role: 'ORG_ADMIN', status: 'INVITED', firstName: 'Anna' });
        expect(admin?.organizationId).not.toBe(org.id);
        expect(await userCountIn(org.id, user.id)).toBe(0);
        expect(await tenantPrisma.runInOrgContext(admin!.organizationId, (tx) => tx.legalAcceptance.count({ where: { organizationId: admin!.organizationId } }))).toBe(2);
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: inviteeEmail, templateName: 'registration-activation' }));
        const again = await claim(token).expect(400);
        expect(again.body.code).toBe('CLAIM_INVALID_OR_EXPIRED');
        expect(await tenantPrisma.runInOrgContext(admin!.organizationId, (tx) => tx.user.count({ where: { organizationId: admin!.organizationId } }))).toBe(1);
      });

      it('bez kliknięcia w 24 h nic się nie dzieje: wpis wygasa, link nie działa, zaproszenie nietknięte', async () => {
        const inviteeEmail = email('expired');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        // Rola właściciela (omija RLS - tylko do przesunięcia zegara w teście); runtime nie ma polityki UPDATE dla tej tabeli.
        const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
        try {
          await owner.pendingAdminClaim.updateMany({ where: { email: inviteeEmail }, data: { expiresAt: new Date(Date.now() - 60_000) } });
        } finally {
          await owner.$disconnect();
        }

        const response = await claim(token).expect(400);

        expect(response.body.code).toBe('CLAIM_INVALID_OR_EXPIRED');
        expect(await userCountIn(org.id, user.id)).toBe(1);
      });

      it('zaproszony zdążył aktywować konto przed kliknięciem: klik nie przejmuje adresu (ten sam błąd), konto nietknięte', async () => {
        const inviteeEmail = email('activated');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        await tenantPrisma.runInOrgContext(org.id, (tx) => tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } }));

        const response = await claim(token).expect(400);

        expect(response.body.code).toBe('CLAIM_INVALID_OR_EXPIRED');
        expect(await tenantPrisma.runAuthLookup({ email: inviteeEmail })).toMatchObject({ organizationId: org.id, status: 'ACTIVE' });
      });

      it('organizacja-właściciel zweryfikowała domenę adresu przed kliknięciem: zaproszenie staje się chronione, klik nie przejmuje adresu', async () => {
        const inviteeEmail = email('lateverify');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        await tenantPrisma.runInOrgContext(org.id, (tx) =>
          tx.organizationDomain.create({ data: { organizationId: org.id, domain: inviteeEmail.split('@')[1], verificationToken: 'tok', verifiedAt: new Date() } }),
        );

        await claim(token).expect(400);

        expect(await userCountIn(org.id, user.id)).toBe(1);
      });

      it('token: zły format, nieznany, z cudzym organizationId (izolacja RLS) - wszystkie dają ten sam błąd i niczego nie tworzą', async () => {
        const inviteeEmail = email('tamper');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        const [, secret] = token.split('.');
        const bodies: unknown[] = [];
        for (const bad of ['nie-token', `${org.id}.${'0'.repeat(64)}`, `${org.id}.${secret}`, `${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}.${secret}`]) {
          const response = await claim(bad).expect(400);
          bodies.push(response.body);
        }

        expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
        expect(await userCountIn(org.id, user.id)).toBe(1);
        expect((await tenantPrisma.runAuthLookup({ email: inviteeEmail }))?.organizationId).toBe(org.id);
      });

      it('limiter skrzynki PRZED zapisem: druga rejestracja na ten sam adres w oknie 10 minut nie tworzy ani organizacji, ani wpisu, ani maila (odpowiedź ta sama)', async () => {
        const inviteeEmail = email('limited');
        const { org } = await inviteEmployee(inviteeEmail, false);
        const domain = inviteeEmail.split('@')[1];
        await postRegister(app, inviteeEmail);
        sendSpy.mockClear();

        const second = await postRegister(app, inviteeEmail);

        expect(second.body).toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
        expect(await prisma.organization.count({ where: { name: domain, NOT: { id: org.id } } })).toBe(1); // tylko z pierwszej rejestracji
        expect(sendSpy).not.toHaveBeenCalled();
      });

      it('ATOMOWOŚĆ: niepowodzenie tworzenia admina (zgody) cofa całość - cudze zaproszenie NIE zostaje skasowane, wpis nie zużyty, maila brak', async () => {
        const inviteeEmail = email('atomic');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        sendSpy.mockClear();
        const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
        try {
          // Wersja dokumentów dłuższa niż kolumna legal_acceptances.version (40): zapis zgód pada PO usunięciu zaproszenia i utworzeniu admina.
          await owner.pendingAdminClaim.updateMany({ where: { email: inviteeEmail }, data: { legalVersion: 'v'.repeat(50) } });

          await claim(token).expect(500);

          expect(await userCountIn(org.id, user.id)).toBe(1); // zaproszenie nietknięte (rollback)
          expect(await tenantPrisma.runAuthLookup({ email: inviteeEmail })).toMatchObject({ organizationId: org.id, status: 'INVITED' });
          expect(await owner.pendingAdminClaim.count({ where: { email: inviteeEmail } })).toBe(1); // wpis nie zużyty
          expect(sendSpy).not.toHaveBeenCalled();
        } finally {
          await owner.$disconnect();
        }
      });

      it('niepowodzenie maila z linkiem aktywacyjnym PO commicie niczego nie cofa: sukces, admin istnieje, zaproszenie wygasło', async () => {
        const inviteeEmail = email('mailfail');
        const { org, user } = await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();
        sendSpy.mockRejectedValueOnce(new Error('MailerSend down'));

        await claim(token).expect(200);

        expect(await tenantPrisma.runAuthLookup({ email: inviteeEmail })).toMatchObject({ role: 'ORG_ADMIN', status: 'INVITED' });
        expect(await userCountIn(org.id, user.id)).toBe(0);
      });

      it('równoległe kliknięcia tego samego linku: dokładnie jedno wygrywa, jeden admin', async () => {
        const inviteeEmail = email('parallel');
        await inviteEmployee(inviteeEmail, false);
        await postRegister(app, inviteeEmail);
        const token = claimTokenFromMail();

        const results = await Promise.allSettled([claim(token), claim(token), claim(token)]);

        const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        expect(statuses.filter((s) => s === 400)).toHaveLength(2);
        expect((await tenantPrisma.runAuthLookup({ email: inviteeEmail }))?.role).toBe('ORG_ADMIN');
      });
    });

    it('aktywne konto (nawet bez zweryfikowanej domeny organizacji) NIE jest przejmowane przez rejestrację', async () => {
      const inviteeEmail = email('active');
      const { org, user } = await inviteEmployee(inviteeEmail, false);
      await tenantPrisma.runInOrgContext(org.id, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } }),
      );
      sendSpy.mockClear();

      await postRegister(app, inviteeEmail);
      await app.get(RegistrationService).flushBackgroundTasks();

      expect((await tenantPrisma.runAuthLookup({ email: inviteeEmail }))?.organizationId).toBe(org.id);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: inviteeEmail, templateName: 'registration-existing-account' }));
    });

    it('domena IDN i jej punycode to ta sama skrzynka: drugie żądanie nie tworzy drugiego konta ani organizacji', async () => {
      const idnDomain = `b${String.fromCharCode(0xfc)}cher-${suffix}.${domainSuffix}`;
      const name = orgName('Idn');
      await postRegister(app, `jan@${idnDomain}`, { organizationName: name });
      const punycodeEmail = `jan@${new URL(`http://${idnDomain}`).hostname}`;

      const stored = await tenantPrisma.runAuthLookup({ email: punycodeEmail });
      expect(stored).not.toBeNull();

      await postRegister(app, punycodeEmail, { organizationName: name });
      expect(await prisma.organization.count({ where: { name } })).toBe(1);
    });

    it('wyścig: dwie równoległe rejestracje tego samego adresu => oba 201, jedno konto, jedna organizacja', async () => {
      const adminEmail = email('race');
      const name = orgName('Wyścig');

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/auth/register').send(registrationPayload(adminEmail, { organizationName: name })),
        request(app.getHttpServer()).post('/auth/register').send(registrationPayload(adminEmail, { organizationName: name })),
      ]);
      // Praca idzie w tle - czekamy na jej koniec, zanim sprawdzimy bazę.
      await app.get(RegistrationService).flushBackgroundTasks();

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      expect(await prisma.organization.count({ where: { name } })).toBe(1);
      expect(await tenantPrisma.runAuthLookup({ email: adminEmail })).not.toBeNull();
    });

    it('odpowiedź błędu walidacji nie ujawnia stanu kont (tylko treść walidacji)', async () => {
      const response = await postRegister(app, email('validation'), { taxId: '5260250275' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toMatch(/istnieje|already|exists|konto/i);
    });
  });

  describe('walidacja', () => {
    it.each([
      ['NIP z błędną sumą kontrolną', { taxId: '5260250275' }, /NIP/],
      ['kod pocztowy w złym formacie', { postalCode: '00001' }, /Kod pocztowy/],
      ['kraj inny niż PL', { country: 'DE' }, /Polski/],
      ['brak zgody na regulamin', { acceptTerms: false }, /regulaminu/],
      ['brak zgody na politykę prywatności', { acceptPrivacyPolicy: false }, /polityki prywatności/],
      ['imię z frazą phishingową', { firstName: 'Konto: kliknij http://x.pl' }, /Imię i nazwisko/],
    ])('400: %s', async (_label, overrides, message) => {
      const response = await postRegister(app, email('bad'), overrides);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.message)).toMatch(message);
      expect(await tenantPrisma.runAuthLookup({ email: email('bad') })).toBeNull();
    });

    it('nie da się nadać sobie statusu ACTIVE ani roli SUPER_ADMIN przez dodatkowe pola', async () => {
      const response = await postRegister(app, email('escalate'), { status: 'ACTIVE', role: 'SUPER_ADMIN' });

      expect(response.status).toBe(400);
    });

    it('brak zgód w ogóle => 400 i nic nie jest zapisane', async () => {
      const payload = registrationPayload(email('noconsent'));
      const { acceptTerms: _t, acceptPrivacyPolicy: _p, ...withoutConsent } = payload;
      void _t;
      void _p;

      const response = await request(app.getHttpServer()).post('/auth/register').send(withoutConsent);

      expect(response.status).toBe(400);
      expect(await tenantPrisma.runAuthLookup({ email: email('noconsent') })).toBeNull();
    });
  });

  describe('izolacja nowych tabel po rejestracji', () => {
    it('organizacja A nie widzi danych faktury, domen ani zgód organizacji B', async () => {
      const a = email('iso-a');
      const b = email('iso-b');
      await postRegister(app, a);
      await postRegister(app, b);
      const orgA = await orgOf(a);
      const orgB = await orgOf(b);

      const seenByA = await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) => ({
        billing: await tx.organizationBillingDetails.findMany(),
        domains: await tx.organizationDomain.findMany(),
        acceptances: await tx.legalAcceptance.findMany(),
      }));

      expect(seenByA.billing.map((row) => row.organizationId)).toEqual([orgA.organizationId]);
      expect(seenByA.domains.map((row) => row.organizationId)).toEqual([orgA.organizationId]);
      expect(seenByA.acceptances.every((row) => row.organizationId === orgA.organizationId)).toBe(true);
      expect(seenByA.acceptances).toHaveLength(2);
      expect(orgB.organizationId).not.toBe(orgA.organizationId);
    });
  });
});
