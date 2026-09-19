import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RegistrationService } from '../src/auth/registration.service';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { postRegister, registrationPayload } from './helpers/auth';

// Samoobsługowa rejestracja firmy (etap 2): dane, domena publiczna,
// anty-enumeracja, zgody, wyścigi, izolacja nowych tabel.
describe('Rejestracja firmy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'registration-e2e.local';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;
  // Wszystkie nazwy kończą się sufiksem - afterAll sprzątanie po nazwie.
  const orgName = (label: string) => `Firma ${label}.${domainSuffix}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
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
    await app.close();
  });

  async function orgOf(userEmail: string) {
    const user = await tenantPrisma.runAuthLookup({ email: userEmail });
    return { user: user!, organizationId: user!.organizationId };
  }

  describe('utworzone dane', () => {
    it('tworzy organizację PENDING z podaną nazwą, admina, dane do faktury, domenę do weryfikacji i dwie zgody', async () => {
      const adminEmail = email('full');
      const response = await postRegister(app, adminEmail, undefined, {
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
      expect(user).toMatchObject({ role: 'ORG_ADMIN', firstName: 'Zofia', lastName: 'Nowak-Kowalska', emailVerifiedAt: null });

      const details = await tenantPrisma.runInOrgContext(organizationId, async (tx) => ({
        billing: await tx.organizationBillingDetails.findUnique({ where: { organizationId } }),
        domains: await tx.organizationDomain.findMany(),
        acceptances: await tx.legalAcceptance.findMany({ orderBy: { documentType: 'asc' } }),
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
      await postRegister(app, adminEmail, undefined, { organizationName: orgName('Zupełnie Inna') });

      const { organizationId } = await orgOf(adminEmail);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org.name).toBe(orgName('Zupełnie Inna'));
      expect(org.name).not.toBe(`nameless.${domainSuffix}`);
    });

    it('wysyła link weryfikacyjny (24 h) na adres admina', async () => {
      const adminEmail = email('linkmail');
      await postRegister(app, adminEmail);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: adminEmail, templateName: 'email-verification' }),
      );
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

  describe('anty-enumeracja', () => {
    it('odpowiedź (status i ciało) jest identyczna dla nowego adresu, zweryfikowanego konta i konta czekającego na potwierdzenie', async () => {
      const verified = email('enum-verified');
      const pending = email('enum-pending');
      await postRegister(app, verified);
      await postRegister(app, pending);
      const { user, organizationId } = await orgOf(verified);
      await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      );

      const forNew = await postRegister(app, email('enum-new'));
      const forVerified = await postRegister(app, verified);
      const forPending = await postRegister(app, pending);

      expect([forNew.status, forVerified.status, forPending.status]).toEqual([201, 201, 201]);
      expect(forVerified.body).toEqual(forNew.body);
      expect(forPending.body).toEqual(forNew.body);
      expect(Object.keys(forNew.body)).toEqual(['message']);
    });

    it('konto zweryfikowane: nie powstaje nowa organizacja, właściciel dostaje mail "konto już istnieje"', async () => {
      const adminEmail = email('exists');
      await postRegister(app, adminEmail, undefined, { organizationName: orgName('Istniejąca') });
      const { user, organizationId } = await orgOf(adminEmail);
      await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      );
      sendSpy.mockClear();

      // Inne dane firmy w drugim żądaniu - nie mogą nic zmienić ani utworzyć.
      // Okno limitera (pierwsza rejestracja je zużyła) przesuwamy o 11 minut.
      const realNow = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60_000);
      const again = await postRegister(app, adminEmail, 'Inne-Haslo-123!', { organizationName: orgName('Nowa Nazwa') });
      clock.mockRestore();

      expect(again.status).toBe(201);
      expect(await prisma.organization.count({ where: { name: orgName('Nowa Nazwa') } })).toBe(0);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: adminEmail, templateName: 'registration-existing-account' }),
      );
      // Hasło z drugiego żądania nie zostało nadpisane.
      await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: 'Inne-Haslo-123!' }).expect(401);
    });

    // Limiter (1 mail / adres / 10 min) działa w pamięci procesu na Date.now();
    // upływ okna symulujemy przesunięciem zegara.
    async function withClockAdvanced<T>(ms: number, fn: () => Promise<T>): Promise<T> {
      const realNow = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + ms);
      try {
        return await fn();
      } finally {
        spy.mockRestore();
      }
    }

    it('konto niepotwierdzone: po upływie okna limitera dostaje nowy link weryfikacyjny (nie informację o istnieniu konta)', async () => {
      const adminEmail = email('unverified');
      await postRegister(app, adminEmail);
      sendSpy.mockClear();

      const again = await withClockAdvanced(11 * 60_000, () => postRegister(app, adminEmail));

      expect(again.status).toBe(201);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: adminEmail, templateName: 'email-verification' }));
    });

    it('limiter: seria żądań na ten sam adres w oknie 10 min nie wysyła nic ponad pierwszy mail; po oknie znów jeden', async () => {
      const adminEmail = email('spam');
      await postRegister(app, adminEmail);
      const { user, organizationId } = await orgOf(adminEmail);
      await tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      );
      sendSpy.mockClear();

      for (let i = 0; i < 4; i += 1) {
        expect((await postRegister(app, adminEmail)).status).toBe(201);
      }
      // Pierwsza rejestracja zużyła okno limitera, więc te próby nie wysyłają nic.
      expect(sendSpy).not.toHaveBeenCalled();

      await withClockAdvanced(11 * 60_000, () => postRegister(app, adminEmail));
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

    it('konto ZAPROSZONE (INVITED) na tym adresie dostaje link aktywacyjny (user-invite), nie weryfikacyjny', async () => {
      const inviteeEmail = email('invitee');
      const org = await prisma.organization.create({ data: { name: orgName('Zapraszająca'), status: 'ACTIVE' } });
      await tenantPrisma.runInOrgContext(org.id, (tx) =>
        tx.user.create({
          data: { organizationId: org.id, email: inviteeEmail, passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED', firstName: 'Ida', lastName: 'Zaproszona' },
        }),
      );
      sendSpy.mockClear();

      const response = await postRegister(app, inviteeEmail);

      expect(response.status).toBe(201);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: inviteeEmail, templateName: 'user-invite' }));
    });

    it('domena IDN i jej punycode to ta sama skrzynka: drugie żądanie nie tworzy drugiego konta ani organizacji', async () => {
      const idnDomain = `b${String.fromCharCode(0xfc)}cher-${suffix}.${domainSuffix}`;
      const name = orgName('Idn');
      await postRegister(app, `jan@${idnDomain}`, undefined, { organizationName: name });
      const punycodeEmail = `jan@${new URL(`http://${idnDomain}`).hostname}`;

      const stored = await tenantPrisma.runAuthLookup({ email: punycodeEmail });
      expect(stored).not.toBeNull();

      await postRegister(app, punycodeEmail, undefined, { organizationName: name });
      expect(await prisma.organization.count({ where: { name } })).toBe(1);
    });

    it('wyścig: dwie równoległe rejestracje tego samego adresu => oba 201, jedno konto, jedna organizacja', async () => {
      const adminEmail = email('race');
      const name = orgName('Wyścig');

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/auth/register').send(registrationPayload(adminEmail, undefined, { organizationName: name })),
        request(app.getHttpServer()).post('/auth/register').send(registrationPayload(adminEmail, undefined, { organizationName: name })),
      ]);

      // Praca idzie w tle - czekamy na jej koniec, zanim sprawdzimy bazę.
      await app.get(RegistrationService).flushBackgroundTasks();

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      expect(await prisma.organization.count({ where: { name } })).toBe(1);
      expect(await tenantPrisma.runAuthLookup({ email: adminEmail })).not.toBeNull();
    });

    it('odpowiedź błędu walidacji nie ujawnia stanu kont (tylko treść walidacji)', async () => {
      const response = await postRegister(app, email('validation'), undefined, { taxId: '5260250275' });

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
      const response = await postRegister(app, email('bad'), undefined, overrides);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.message)).toMatch(message);
      expect(await tenantPrisma.runAuthLookup({ email: email('bad') })).toBeNull();
    });

    it('nie da się nadać sobie statusu ACTIVE ani roli SUPER_ADMIN przez dodatkowe pola', async () => {
      const response = await postRegister(app, email('escalate'), undefined, { status: 'ACTIVE', role: 'SUPER_ADMIN' });

      expect(response.status).toBe(400);
    });

    it('brak zgód w ogóle => 400 i nic nie jest zapisane (transakcja)', async () => {
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
