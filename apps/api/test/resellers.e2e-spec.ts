import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

/**
 * Panel resellera, krok 1 (D-069, zgłoszenie B-092).
 *
 * Najważniejsze w tych testach: izolacja PIĘTRO WYŻEJ niż zwykle - nie między organizacjami
 * klienckimi, tylko między PARTNERAMI. Reseller A nie może zobaczyć klientów resellera B,
 * a klient nie może dotknąć niczego z panelu operatora (przypisanie i odłączenie robi
 * wyłącznie operator - decyzja właściciela produktu).
 */
describe('Panel resellera: operator, partner, izolacja (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const clientAEmail = `res-klient-a-${suffix}@klient-a.reseller-e2e.test`;
  const clientBEmail = `res-klient-b-${suffix}@klient-b.reseller-e2e.test`;
  const operatorEmail = `res-operator-${suffix}@operator.reseller-e2e.test`;

  let operatorToken: string;
  let clientAToken: string;
  let clientAOrganizationId: string;
  let clientBOrganizationId: string;
  let resellerAId: string;
  let resellerBId: string;
  let resellerATokenPromise: () => Promise<string>;

  /** Ustawia hasło zaproszonemu administratorowi partnera i loguje go (bez maila). */
  async function loginAsResellerAdmin(email: string): Promise<string> {
    const user = await tenantPrisma.runAuthLookup({ email });
    if (!user) {
      throw new Error(`Nie utworzono konta partnera ${email}`);
    }
    const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4);
    await tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() } }),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_TEST_PASSWORD })
      .expect(200);
    return login.body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Równoległe żądania wymagają nasłuchującego serwera (CLAUDE.md, reguła 9).
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    const clientA = await registerVerified(app, tenantPrisma, { email: clientAEmail, password: DEFAULT_TEST_PASSWORD });
    clientAToken = clientA.body.accessToken;
    const clientB = await registerVerified(app, tenantPrisma, { email: clientBEmail, password: DEFAULT_TEST_PASSWORD });

    const clientAUser = await tenantPrisma.runAuthLookup({ email: clientAEmail });
    const clientBUser = await tenantPrisma.runAuthLookup({ email: clientBEmail });
    clientAOrganizationId = clientAUser!.organizationId;
    clientBOrganizationId = clientBUser!.organizationId;
    expect(clientB.body.accessToken).toBeDefined();

    // Operator platformy: konto SUPER_ADMIN w osobnej organizacji (jak w panelu operacyjnym).
    const operator = await registerVerified(app, tenantPrisma, { email: operatorEmail, password: DEFAULT_TEST_PASSWORD });
    const operatorUser = await tenantPrisma.runAuthLookup({ email: operatorEmail });
    await tenantPrisma.runInOrgContext(operatorUser!.organizationId, (tx) =>
      tx.user.update({ where: { id: operatorUser!.id }, data: { role: 'SUPER_ADMIN' } }),
    );
    // Rola jest w tokenie, więc po zmianie w bazie trzeba zalogować się ponownie.
    const operatorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: operatorEmail, password: DEFAULT_TEST_PASSWORD })
      .expect(200);
    operatorToken = operatorLogin.body.accessToken;
    expect(operator.body.accessToken).toBeDefined();
  });

  afterAll(async () => {
    // Organizacje partnerów i klientów (kaskadowo: użytkownicy, przypisania).
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'reseller-e2e.test' } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: `Partner ${suffix}` } } });
    await app.close();
  });

  describe('Operator (SUPER_ADMIN)', () => {
    it('zakłada partnera i zaprasza jego administratora', async () => {
      const response = await request(app.getHttpServer())
        .post('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: `Partner ${suffix} A`,
          adminEmail: `partner-a-${suffix}@partner-a.reseller-e2e.test`,
          adminFirstName: 'Anna',
          adminLastName: 'Partnerska',
        })
        .expect(201);

      expect(response.body).toEqual(
        expect.objectContaining({ name: `Partner ${suffix} A`, clientCount: 0 }),
      );
      resellerAId = response.body.id;
      resellerATokenPromise = () => loginAsResellerAdmin(`partner-a-${suffix}@partner-a.reseller-e2e.test`);

      // Organizacja partnera powstaje od razu jako ACTIVE (operator tworzy ją świadomie).
      const organization = await prisma.organization.findUnique({ where: { id: resellerAId } });
      expect(organization).toEqual(expect.objectContaining({ kind: 'RESELLER', status: 'ACTIVE' }));

      const second = await request(app.getHttpServer())
        .post('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: `Partner ${suffix} B`,
          adminEmail: `partner-b-${suffix}@partner-b.reseller-e2e.test`,
          adminFirstName: 'Bartosz',
          adminLastName: 'Partnerski',
        })
        .expect(201);
      resellerBId = second.body.id;
    });

    it('przypisuje organizacje klienckie partnerom, a druga próba tej samej kończy się konfliktem', async () => {
      await request(app.getHttpServer())
        .post(`/resellers/${resellerAId}/organizations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationId: clientAOrganizationId })
        .expect(204);

      await request(app.getHttpServer())
        .post(`/resellers/${resellerBId}/organizations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationId: clientBOrganizationId })
        .expect(204);

      // Jeden opiekun na klienta - przepięcie wymaga najpierw odłączenia.
      await request(app.getHttpServer())
        .post(`/resellers/${resellerBId}/organizations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationId: clientAOrganizationId })
        .expect(409);
    });

    it('nie przypisze organizacji partnera jako klienta ani organizacji nieistniejącej', async () => {
      await request(app.getHttpServer())
        .post(`/resellers/${resellerAId}/organizations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationId: resellerBId })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/resellers/${resellerAId}/organizations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ organizationId: 'nieistniejaca' })
        .expect(404);
    });

    it('lista organizacji do przypisania zawiera WYŁĄCZNIE organizacje klienckie, z aktualnym opiekunem', async () => {
      const response = await request(app.getHttpServer())
        .get('/resellers/assignable-organizations')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const byId = new Map(response.body.map((organization: { id: string }) => [organization.id, organization]));
      // Organizacje partnerów nie są klientami - nie wolno ich nikomu przypisać.
      expect(byId.has(resellerAId)).toBe(false);
      expect(byId.has(resellerBId)).toBe(false);
      expect(byId.get(clientAOrganizationId)).toEqual(
        expect.objectContaining({ resellerId: resellerAId, resellerName: `Partner ${suffix} A` }),
      );
    });

    it('istniejący raport operatora (/dashboard/admin/organizations) NIE miesza organizacji partnerów z klientami', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/admin/organizations')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const ids = response.body.map((organization: { id: string }) => organization.id);
      expect(ids).toContain(clientAOrganizationId);
      expect(ids).not.toContain(resellerAId);
      expect(ids).not.toContain(resellerBId);
    });

    it('adres zajęty w innej organizacji: partner NIE powstaje (bez osieroconej organizacji)', async () => {
      const before = await request(app.getHttpServer())
        .get('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: `Partner ${suffix} C`,
          // Adres administratora klienta A - ma już konto w innej organizacji.
          adminEmail: clientAEmail,
          adminFirstName: 'Cezary',
          adminLastName: 'Partnerski',
        })
        .expect(409);

      const after = await request(app.getHttpServer())
        .get('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(after.body).toHaveLength(before.body.length);
      expect(after.body.some((reseller: { name: string }) => reseller.name === `Partner ${suffix} C`)).toBe(false);
    });

    it('lista partnerów pokazuje liczbę klientów', async () => {
      const response = await request(app.getHttpServer())
        .get('/resellers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const partnerA = response.body.find((reseller: { id: string }) => reseller.id === resellerAId);
      expect(partnerA).toEqual(expect.objectContaining({ clientCount: 1 }));
      // Liczby użytkowników świadomie nie ma: `users` jest pod RLS, więc bez kontekstu organizacji
      // wyszłoby zawsze 0 - lepiej nie pokazywać pola niż pokazywać mylącą wartość.
      expect(partnerA).not.toHaveProperty('userCount');
    });
  });

  describe('Partner (RESELLER_ADMIN)', () => {
    it('widzi WYŁĄCZNIE swoich klientów - izolacja A/B na poziomie partnerów', async () => {
      const resellerAToken = await resellerATokenPromise();

      const response = await request(app.getHttpServer())
        .get('/reseller/clients')
        .set('Authorization', `Bearer ${resellerAToken}`)
        .expect(200);

      const ids = response.body.map((client: { id: string }) => client.id);
      expect(ids).toContain(clientAOrganizationId);
      expect(ids).not.toContain(clientBOrganizationId);
      // Żadnych danych klienta poza metadanymi organizacji.
      expect(Object.keys(response.body[0]).sort()).toEqual(
        ['assignedAt', 'id', 'name', 'plan', 'seatsLimit', 'status'].sort(),
      );
    });

    it('nie ma dostępu do panelu operatora', async () => {
      const resellerAToken = await resellerATokenPromise();

      await request(app.getHttpServer()).get('/resellers').set('Authorization', `Bearer ${resellerAToken}`).expect(403);
      await request(app.getHttpServer())
        .post(`/resellers/${resellerAId}/organizations`)
        .set('Authorization', `Bearer ${resellerAToken}`)
        .send({ organizationId: clientBOrganizationId })
        .expect(403);
    });

    it('nie ma dostępu do danych organizacji klienta (wejście w organizację to osobny, niezbudowany krok)', async () => {
      const resellerAToken = await resellerATokenPromise();

      // Token partnera niesie jego własne organizationId, więc listy pracowników klienta nie zobaczy.
      const users = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${resellerAToken}`);
      expect(users.status).toBe(403);
    });
  });

  describe('Klient (ORG_ADMIN)', () => {
    it('widzi nazwę swojego opiekuna w GET /organization/me', async () => {
      const response = await request(app.getHttpServer())
        .get('/organization/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);

      expect(response.body.reseller).toEqual({ name: `Partner ${suffix} A` });
    });

    it('NIE może przypisać ani odłączyć resellera (to wyłącznie decyzja operatora)', async () => {
      await request(app.getHttpServer())
        .post(`/resellers/${resellerAId}/organizations`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ organizationId: clientAOrganizationId })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/resellers/${resellerAId}/organizations/${clientAOrganizationId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/reseller/clients')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(403);
    });
  });

  // Cała konstrukcja opiera się na tym, że rolę partnera nadaje WYŁĄCZNIE operator. Gdyby admin
  // organizacji klienckiej mógł ją komuś nadać, zrobiłby sobie konto widzące listę klientów.
  describe('Eskalacja roli', () => {
    it('ORG_ADMIN nie zaprosi nikogo z rolą RESELLER_ADMIN ani nie podniesie jej istniejącemu użytkownikowi', async () => {
      const invite = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          email: `eskalacja-${suffix}@klient-a.reseller-e2e.test`,
          firstName: 'Ewa',
          lastName: 'Testowa',
          role: 'RESELLER_ADMIN',
        });
      expect(invite.status).toBe(400);

      const clientAUser = await tenantPrisma.runAuthLookup({ email: clientAEmail });
      const update = await request(app.getHttpServer())
        .patch(`/users/${clientAUser!.id}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ role: 'RESELLER_ADMIN' });
      expect(update.status).toBe(400);

      // SUPER_ADMIN też nie przechodzi tą drogą - role platformy nadaje wyłącznie panel operatora.
      const superAdminAttempt = await request(app.getHttpServer())
        .patch(`/users/${clientAUser!.id}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ role: 'SUPER_ADMIN' });
      expect(superAdminAttempt.status).toBe(400);
    });
  });

  describe('Odłączenie klienta', () => {
    it('operator odłącza klienta, partner przestaje go widzieć, a klient traci opiekuna', async () => {
      await request(app.getHttpServer())
        .delete(`/resellers/${resellerAId}/organizations/${clientAOrganizationId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(204);

      const resellerAToken = await resellerATokenPromise();
      const clients = await request(app.getHttpServer())
        .get('/reseller/clients')
        .set('Authorization', `Bearer ${resellerAToken}`)
        .expect(200);
      expect(clients.body).toEqual([]);

      const organization = await request(app.getHttpServer())
        .get('/organization/me')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      expect(organization.body.reseller).toBeNull();

      // Powtórne odłączenie nie udaje sukcesu.
      await request(app.getHttpServer())
        .delete(`/resellers/${resellerAId}/organizations/${clientAOrganizationId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(404);
    });
  });

  it('bez tokena żaden z paneli nie jest dostępny', async () => {
    await request(app.getHttpServer()).get('/resellers').expect(401);
    await request(app.getHttpServer()).get('/reseller/clients').expect(401);
  });
});
