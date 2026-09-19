import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { EmailService } from '../src/email/email.service';
import { DnsTxtResolver } from '../src/organizations/dns-txt-resolver';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

// Tymczasowy kontroler: nowy endpoint BEZ @AllowPendingOrganization musi być
// domyślnie zablokowany dla organizacji PENDING (guard fail-closed).
@Controller('__probe')
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get('unmarked')
  unmarked() {
    return { ok: true };
  }
}

describe('Weryfikacja domeny i guard PENDING (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  const resolveTxt = jest.fn<Promise<string[][]>, [string]>();

  const suffix = Date.now();
  const domainSuffix = 'domain-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(DnsTxtResolver)
      .useValue({ resolveTxt })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });

  beforeEach(() => {
    resolveTxt.mockReset();
    resolveTxt.mockRejectedValue(new Error('ENODATA'));
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  async function pendingAdmin(label: string) {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials, { activateOrganization: false });
    const user = await tenantPrisma.runAuthLookup({ email: credentials.email });
    const domain = await tenantPrisma.runInOrgContext(user!.organizationId, (tx) => tx.organizationDomain.findFirstOrThrow());
    return { token: body.accessToken, organizationId: user!.organizationId, domain };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const expire = (organizationId: string) =>
    tenantPrisma.runInOrgContext(organizationId, (tx) => tx.organizationDomain.updateMany({ data: { lastCheckedAt: null } }));

  describe('guard PENDING', () => {
    it('PENDING: endpointy biznesowe dają 403 z kodem, a nowy niezaznaczony endpoint jest zablokowany domyślnie', async () => {
      const { token } = await pendingAdmin('guard');

      for (const path of ['/users', '/courses/my', '/dashboard/overview', '/gamification/badges', '/users/me/gamification', '/__probe/unmarked']) {
        const response = await request(app.getHttpServer()).get(path).set(auth(token));
        expect([path, response.status, response.body.code]).toEqual([path, 403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
      }
    });

    it.each(['bearer', 'BEARER'])('PENDING: schemat Authorization "%s" (akceptowany przez passport) też jest blokowany', async (scheme) => {
      const { token } = await pendingAdmin(`scheme-${scheme.toLowerCase()}`);

      const response = await request(app.getHttpServer()).get('/users').set('Authorization', `${scheme} ${token}`);

      expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
    });

    it('PENDING: dostępne są tylko /organization/me, avatar i ustawienia/weryfikacja', async () => {
      const { token } = await pendingAdmin('allowed');

      await request(app.getHttpServer()).get('/users/me/avatar').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/organization/me').set(auth(token)).expect(200);
    });

    it('po ACTIVE ten sam token przechodzi (status czytany z bazy przy każdym żądaniu)', async () => {
      const { token, organizationId } = await pendingAdmin('unlock');
      await request(app.getHttpServer()).get('/__probe/unmarked').set(auth(token)).expect(403);

      await prisma.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });

      await request(app.getHttpServer()).get('/__probe/unmarked').set(auth(token)).expect(200);
    });
  });

  describe('GET /organization/me', () => {
    it('zwraca dokładny rekord TXT do wpisania i status; nie ujawnia tokenów innej organizacji', async () => {
      const { token, domain } = await pendingAdmin('overview');

      const response = await request(app.getHttpServer()).get('/organization/me').set(auth(token)).expect(200);

      expect(response.body).toMatchObject({
        status: 'PENDING_DOMAIN_VERIFICATION',
        selfJoinEnabled: false,
        domain: {
          name: `overview.${domainSuffix}`,
          verified: false,
          txtRecord: {
            type: 'TXT',
            host: `_unfooly-verify.overview.${domainSuffix}`,
            value: `unfooly-verify=${domain.verificationToken}`,
          },
        },
      });
    });

    it('EMPLOYEE dostaje 403 (rola sprawdzana w guardzie)', async () => {
      const { organizationId } = await pendingAdmin('employee');
      await prisma.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
      const employeeEmail = email('employee');
      const employee = { email: `pracownik-${suffix}@employee.${domainSuffix}`, password: DEFAULT_TEST_PASSWORD };
      const bcrypt = await import('bcrypt');
      await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
        tx.user.create({
          data: {
            organizationId,
            email: employee.email,
            passwordHash: await bcrypt.hash(employee.password, 4),
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          },
        }),
      );
      void employeeEmail;
      const login = await request(app.getHttpServer()).post('/auth/login').send(employee).expect(200);

      await request(app.getHttpServer()).get('/organization/me').set(auth(login.body.accessToken)).expect(403);
    });
  });

  describe('POST /organization/domain/check', () => {
    it('poprawny rekord: domena zweryfikowana, organizacja ACTIVE, endpointy biznesowe odblokowane tym samym tokenem', async () => {
      const { token, organizationId, domain } = await pendingAdmin('ok');
      resolveTxt.mockResolvedValue([[`unfooly-verify=${domain.verificationToken}`]]);

      const response = await request(app.getHttpServer()).post('/organization/domain/check').set(auth(token)).expect(200);

      expect(response.body).toEqual({ verified: true });
      expect(resolveTxt).toHaveBeenCalledWith(`_unfooly-verify.ok.${domainSuffix}`);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      expect(org.status).toBe('ACTIVE');
      await request(app.getHttpServer()).get('/users').set(auth(token)).expect(200);
      const overview = await request(app.getHttpServer()).get('/organization/me').set(auth(token)).expect(200);
      expect(overview.body.domain.verified).toBe(true);
    });

    it('wszystkie przyczyny porażki dają IDENTYCZNĄ odpowiedź (zły token, brak rekordu, timeout DNS, domena w innej organizacji)', async () => {
      const bodies: unknown[] = [];
      const record = async (label: string, arrange: (ctx: Awaited<ReturnType<typeof pendingAdmin>>) => unknown) => {
        const ctx = await pendingAdmin(label);
        await arrange(ctx);
        const response = await request(app.getHttpServer()).post('/organization/domain/check').set(auth(ctx.token));
        bodies.push([response.status, response.body]);
        const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
        expect(org.status).toBe('PENDING_DOMAIN_VERIFICATION');
      };

      await record('wrongtoken', () => resolveTxt.mockResolvedValue([['unfooly-verify=zly-token']]));
      await record('norecord', () => resolveTxt.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENODATA' })));
      await record('timeout', () => resolveTxt.mockRejectedValue(new Error('DNS timeout')));
      await record('taken', async (ctx) => {
        // Ta sama domena została już zweryfikowana w INNEJ organizacji.
        const other = await prisma.organization.create({ data: { name: `Inna.${domainSuffix}`, status: 'ACTIVE' } });
        await tenantPrisma.runInOrgContext(other.id, (tx) =>
          tx.organizationDomain.create({
            data: { organizationId: other.id, domain: ctx.domain.domain, verificationToken: 'b'.repeat(64), verifiedAt: new Date() },
          }),
        );
        resolveTxt.mockResolvedValue([[`unfooly-verify=${ctx.domain.verificationToken}`]]);
      });

      expect(bodies).toHaveLength(4);
      expect((bodies[0] as [number])[0]).toBe(400);
      for (const body of bodies) {
        expect(body).toEqual(bodies[0]);
      }
      expect(JSON.stringify(bodies[3])).not.toMatch(/inna|innej|unique|organization_domains/i);
    });

    it('cooldown: drugie sprawdzenie w ciągu 10 s => 429 i bez zapytania DNS; po upływie cooldownu znów działa', async () => {
      const { token, organizationId } = await pendingAdmin('cooldown');

      await request(app.getHttpServer()).post('/organization/domain/check').set(auth(token)).expect(400);
      const second = await request(app.getHttpServer()).post('/organization/domain/check').set(auth(token));
      expect(second.status).toBe(429);
      expect(resolveTxt).toHaveBeenCalledTimes(1);

      await expire(organizationId);
      await request(app.getHttpServer()).post('/organization/domain/check').set(auth(token)).expect(400);
      expect(resolveTxt).toHaveBeenCalledTimes(2);
    });

    it('bez tokenu 401', async () => {
      await request(app.getHttpServer()).post('/organization/domain/check').expect(401);
    });
  });

  describe('PATCH /organization/settings (selfJoinEnabled)', () => {
    it('przed weryfikacją domeny włączenie => 400 DOMAIN_NOT_VERIFIED; po weryfikacji działa i można wyłączyć', async () => {
      const { token, domain } = await pendingAdmin('selfjoin');

      const before = await request(app.getHttpServer())
        .patch('/organization/settings')
        .set(auth(token))
        .send({ selfJoinEnabled: true });
      expect(before.status).toBe(400);
      expect(before.body.code).toBe('DOMAIN_NOT_VERIFIED');

      resolveTxt.mockResolvedValue([[`unfooly-verify=${domain.verificationToken}`]]);
      await request(app.getHttpServer()).post('/organization/domain/check').set(auth(token)).expect(200);

      const on = await request(app.getHttpServer()).patch('/organization/settings').set(auth(token)).send({ selfJoinEnabled: true });
      expect(on.status).toBe(200);
      expect(on.body.selfJoinEnabled).toBe(true);
      const off = await request(app.getHttpServer()).patch('/organization/settings').set(auth(token)).send({ selfJoinEnabled: false });
      expect(off.body.selfJoinEnabled).toBe(false);
    });

    it('nie da się zmienić status ani innych pól przez ustawienia (whitelist => 400)', async () => {
      const { token } = await pendingAdmin('mass');

      await request(app.getHttpServer())
        .patch('/organization/settings')
        .set(auth(token))
        .send({ status: 'ACTIVE' })
        .expect(400);
    });
  });

  describe('izolacja tenantów', () => {
    it('admin A sprawdza tylko własną domenę: token organizacji B w DNS nie weryfikuje A i nie zmienia B', async () => {
      const a = await pendingAdmin('iso-a');
      const b = await pendingAdmin('iso-b');
      resolveTxt.mockResolvedValue([[`unfooly-verify=${b.domain.verificationToken}`]]);

      await request(app.getHttpServer()).post('/organization/domain/check').set(auth(a.token)).expect(400);

      const orgA = await prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } });
      const orgB = await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } });
      expect([orgA.status, orgB.status]).toEqual(['PENDING_DOMAIN_VERIFICATION', 'PENDING_DOMAIN_VERIFICATION']);
      const overviewA = await request(app.getHttpServer()).get('/organization/me').set(auth(a.token)).expect(200);
      expect(overviewA.body.id).toBe(a.organizationId);
      expect(JSON.stringify(overviewA.body)).not.toContain(b.domain.verificationToken);
    });
  });
});
