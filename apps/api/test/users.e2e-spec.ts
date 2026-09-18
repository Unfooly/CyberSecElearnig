import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';
import { EmailService } from '../src/email/email.service';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

describe('Zarządzanie i zapraszanie pracowników (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const uniqueSuffix = Date.now();
  // Osobne domeny dla A/B - organizations.name jest unikalne (nazwa = domena).
  const orgAEmail = `admin-a-${uniqueSuffix}@org-a.users-e2e-test.local`;
  const orgBEmail = `admin-b-${uniqueSuffix}@org-b.users-e2e-test.local`;

  let orgAId: string;
  let orgBId: string;
  let orgAToken: string;
  let orgBUserId: string;
  let orgBDepartmentId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    const orgAResponse = await registerVerified(app, tenantPrisma, { email: orgAEmail, password: 'SuperSecret123!' });
    await registerVerified(app, tenantPrisma, { email: orgBEmail, password: 'SuperSecret123!' });

    orgAToken = orgAResponse.body.accessToken;

    const orgAAdmin = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    const orgBAdmin = await tenantPrisma.runAuthLookup({ email: orgBEmail });
    orgAId = orgAAdmin!.organizationId;
    orgBId = orgBAdmin!.organizationId;
    orgBUserId = orgBAdmin!.id;

    const department = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.department.create({ data: { organizationId: orgBId, name: `Dział B ${uniqueSuffix}` } }),
    );
    orgBDepartmentId = department.id;
  });

  // Limity żądań (@Throttle) mają własne testy w auth.e2e-spec.ts - ten plik
  // wysyła łącznie >10 zaproszeń na minutę, więc przed każdym testem czyścimy
  // licznik throttlera (globalny APP_GUARD, więc overrideGuard go nie wyłącza).
  beforeEach(() => {
    (app.get<ThrottlerStorageService>(ThrottlerStorage)).storage.clear();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: 'users-e2e-test.local' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'users-e2e-test.local' } } });
    await app.close();
  });

  async function captureInviteActivationUrl<T>(action: () => Promise<T>): Promise<{
    response: T;
    activationUrl: string | null;
  }> {
    const emailService = app.get(EmailService);
    const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);

    const response = await action();

    const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1]?.[0];
    const activationUrl = call ? ((call.templateData as { activationUrl: string }).activationUrl ?? null) : null;
    sendSpy.mockRestore();

    return { response, activationUrl };
  }

  describe('Izolacja tenantów', () => {
    it('ORG_ADMIN organizacji A nie może zaprosić użytkownika do organizacji B (obcy departmentId odrzucony)', async () => {
      const response = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          email: `cross-org-invite-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'Jan',
          lastName: 'Kowalski',
          departmentId: orgBDepartmentId,
          role: 'EMPLOYEE',
        })
        .expect(400);

      expect(response.body.message).toMatch(/dział/i);
    });

    it('ORG_ADMIN organizacji A nie może edytować użytkownika organizacji B', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${orgBUserId}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ firstName: 'Zmienione' })
        .expect(404);

      // Dane organizacji B nie zostały naruszone przez odrzuconą próbę.
      const orgBAdminAfter = await tenantPrisma.runAuthLookup({ email: orgBEmail });
      expect(orgBAdminAfter!.firstName).not.toBe('Zmienione');
    });

    it('ORG_ADMIN organizacji A nie może usunąć użytkownika organizacji B', async () => {
      await request(app.getHttpServer())
        .delete(`/users/${orgBUserId}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(404);

      const stillExists = await tenantPrisma.runAuthLookup({ id: orgBUserId });
      expect(stillExists).not.toBeNull();
    });

    it('odrzuca dostęp bez roli ORG_ADMIN (EMPLOYEE nie może zapraszać)', async () => {
      const employeeEmail = `employee-${uniqueSuffix}@org-a.users-e2e-test.local`;
      const { activationUrl } = await captureInviteActivationUrl(() =>
        request(app.getHttpServer())
          .post('/users/invite')
          .set('Authorization', `Bearer ${orgAToken}`)
          .send({
            email: employeeEmail,
            firstName: 'Ewa',
            lastName: 'Nowak',
            role: 'EMPLOYEE',
          })
          .expect(201),
      );
      expect(activationUrl).toEqual(expect.any(String));

      const employeeUser = await tenantPrisma.runAuthLookup({ email: employeeEmail });

      // Hasło jest losowe i nieznane requestowi - jedyny sposób na realny
      // token EMPLOYEE (bez ręcznego podpisywania JWT) to przejście przez
      // reset flow, tak jak zrobiłby to prawdziwy zaproszony pracownik.
      const resetToken = new URL(activationUrl!).searchParams.get('token');
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, newPassword: 'NoweHasloEmp123' })
        .expect(200);

      const employeeTokenResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: employeeEmail, password: 'NoweHasloEmp123' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${employeeTokenResponse.body.accessToken}`)
        .send({
          email: `should-fail-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'X',
          lastName: 'Y',
          role: 'EMPLOYEE',
        })
        .expect(403);

      expect(employeeUser!.role).toBe('EMPLOYEE');
    });
  });

  describe('Własny avatar (Topbar)', () => {
    it('GET /users/me/avatar zwraca avatar zalogowanego użytkownika (null, potem ustawiony)', async () => {
      const before = await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);
      expect(before.body).toEqual({ avatarUrl: null });

      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ avatarUrl: 'fox' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);
      expect(after.body).toEqual({ avatarUrl: 'fox' });
    });

    it('odrzuca dostęp bez tokena', async () => {
      await request(app.getHttpServer()).get('/users/me/avatar').expect(401);
    });

    it('odrzuca avatar z niezabezpieczonym adresem http (tylko https lub preset)', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/avatar')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ avatarUrl: 'http://example.test/a.png' })
        .expect(400);
    });
  });

  describe('Walidacja imienia i nazwiska (ochrona przed phishingiem w mailu zaproszenia)', () => {
    it('odrzuca "imię" będące frazą phishingową/z cyframi i znakami specjalnymi', async () => {
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          email: `phish-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'Konto zablokowane: kliknij http://zly.pl',
          lastName: 'Kowalski',
          role: 'EMPLOYEE',
        })
        .expect(400);
    });

    it('akceptuje polskie znaki, apostrof i myślnik w nazwisku', async () => {
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          email: `nazwisko-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'Zażółć',
          lastName: "Gęślą-O'Brien",
          role: 'EMPLOYEE',
        })
        .expect(201);
    });
  });

  describe('Poprawność adresu i ponowne zaproszenie', () => {
    it('odrzuca adres ze znakami spoza ASCII w części lokalnej (dostawca e-mail ich nie przyjmuje)', async () => {
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          email: `adrian.poźniak-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'A',
          lastName: 'B',
          role: 'EMPLOYEE',
        })
        .expect(400);
    });

    it('resend-invite: działa dla zaproszonego, odrzuca aktywnego i konto innej organizacji', async () => {
      const email = `resend-${uniqueSuffix}@org-a.users-e2e-test.local`;
      const invited = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ email, firstName: 'R', lastName: 'S', role: 'EMPLOYEE' })
        .expect(201);
      expect(typeof invited.body.inviteEmailSent).toBe('boolean');

      // Zaraz po zaproszeniu obowiązuje cooldown na ponowną wysyłkę (429).
      await request(app.getHttpServer())
        .post(`/users/${invited.body.id}/resend-invite`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(429);

      // Po cooldownie (cofamy createdAt tokenu) ponowna wysyłka działa.
      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.passwordResetToken.updateMany({
          where: { userId: invited.body.id },
          data: { createdAt: new Date(Date.now() - 10 * 60_000) },
        }),
      );
      const resent = await request(app.getHttpServer())
        .post(`/users/${invited.body.id}/resend-invite`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);
      expect(typeof resent.body.inviteEmailSent).toBe('boolean');

      const admin = await tenantPrisma.runAuthLookup({ email: orgAEmail });
      await request(app.getHttpServer())
        .post(`/users/${admin!.id}/resend-invite`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .post(`/users/${orgBUserId}/resend-invite`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(404);
    });
  });

  describe('Ochrona administratorów', () => {
    it('ORG_ADMIN nie może zmienić własnej roli ani usunąć własnego konta', async () => {
      const admin = await tenantPrisma.runAuthLookup({ email: orgAEmail });

      await request(app.getHttpServer())
        .patch(`/users/${admin!.id}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ role: 'EMPLOYEE' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/users/${admin!.id}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(400);
    });

    it('odrzuca pusty departmentId w PATCH (walidacja DTO, nie 500)', async () => {
      const admin = await tenantPrisma.runAuthLookup({ email: orgAEmail });

      await request(app.getHttpServer())
        .patch(`/users/${admin!.id}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ departmentId: '' })
        .expect(400);
    });

    it('normalizuje e-mail zaproszenia do małych liter (brak duplikatów wielkością liter)', async () => {
      const email = `Case-${uniqueSuffix}@org-a.users-e2e-test.local`;
      const first = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ email, firstName: 'A', lastName: 'B', role: 'EMPLOYEE' })
        .expect(201);
      expect(first.body.email).toBe(email.toLowerCase());

      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ email: email.toUpperCase().replace('LOCAL', 'local'), firstName: 'A', lastName: 'B', role: 'EMPLOYEE' })
        .expect(400);
    });
  });

  describe('Zapraszanie pojedynczego użytkownika', () => {
    it('happy path: invite tworzy usera ze statusem INVITED, aktywacja przez /auth/reset-password przełącza na ACTIVE i pozwala się zalogować', async () => {
      const inviteEmail = `invite-happy-${uniqueSuffix}@org-a.users-e2e-test.local`;

      const { response, activationUrl } = await captureInviteActivationUrl(() =>
        request(app.getHttpServer())
          .post('/users/invite')
          .set('Authorization', `Bearer ${orgAToken}`)
          .send({
            email: inviteEmail,
            firstName: 'Nowy',
            lastName: 'Pracownik',
            role: 'EMPLOYEE',
          })
          .expect(201),
      );

      expect(response.body.status).toBe('INVITED');
      expect(activationUrl).toEqual(expect.any(String));

      const invitedUser = await tenantPrisma.runAuthLookup({ email: inviteEmail });
      expect(invitedUser!.status).toBe('INVITED');

      const resetToken = new URL(activationUrl!).searchParams.get('token');
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, newPassword: 'PierwszeHaslo123' })
        .expect(200);

      const activatedUser = await tenantPrisma.runAuthLookup({ email: inviteEmail });
      expect(activatedUser!.status).toBe('ACTIVE');

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: inviteEmail, password: 'PierwszeHaslo123' })
        .expect(200);
    });

    it('odrzuca zaproszenie z rolą SUPER_ADMIN', async () => {
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          email: `super-admin-attempt-${uniqueSuffix}@org-a.users-e2e-test.local`,
          firstName: 'X',
          lastName: 'Y',
          role: 'SUPER_ADMIN',
        })
        .expect(400);
    });
  });

  describe('Lista pracowników: paginacja i wyszukiwanie', () => {
    beforeAll(async () => {
      await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
        for (const [firstName, lastName] of [
          ['Alicja', 'Zenon'],
          ['Bartosz', 'Yeti'],
          ['Celina', 'Xander'],
        ] as const) {
          await tx.user.create({
            data: {
              organizationId: orgAId,
              email: `${firstName.toLowerCase()}-${uniqueSuffix}@org-a.users-e2e-test.local`,
              passwordHash: 'unused-in-tests',
              firstName,
              lastName,
              role: 'EMPLOYEE',
            },
          });
        }
      });
    });

    it('wyszukiwanie po imieniu zwraca tylko pasujący podzbiór', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .query({ search: 'Alicja' })
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].firstName).toBe('Alicja');
    });

    it('paginacja (pageSize=1) zwraca poprawny total i po jednym elemencie na stronę', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/users')
        .query({ page: 1, pageSize: 1, search: uniqueSuffix.toString() })
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.total).toBeGreaterThanOrEqual(3);

      const page2 = await request(app.getHttpServer())
        .get('/users')
        .query({ page: 2, pageSize: 1, search: uniqueSuffix.toString() })
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(200);

      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    });
  });
});
