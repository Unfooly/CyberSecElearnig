import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PhishingMailTransport } from '../src/phishing/transport/phishing-mail-transport';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

describe('Konfiguracja i transport symulacji (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-config-e2e.test';

  async function boot(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  }

  const ENV_KEYS = ['PHISHING_EMAIL_DOMAIN', 'PHISHING_MAIL_TRANSPORT', 'PHISHING_MAILERSEND_API_TOKEN', 'PHISHING_SMTP_URL', 'PHISHING_LANDING_BASE_URL'];
  afterEach(async () => {
    await prisma?.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app?.close();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  beforeEach(() => {
    const storage = app?.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> } | undefined;
    storage?.storage?.clear();
  });

  async function adminToken(label: string) {
    const credentials = { email: `${label}-${suffix}@${label}.${domainSuffix}`, password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    return body.accessToken as string;
  }

  const getConfig = (token: string) => request(app.getHttpServer()).get('/phishing/config').set('Authorization', `Bearer ${token}`);

  it('dev (bez PHISHING_MAIL_TRANSPORT): transport "log" - skonfigurowany, ale NIC nie wysyła; domena i host strony lądowania widoczne', async () => {
    await boot({ PHISHING_EMAIL_DOMAIN: 'symulacje.example.test', PHISHING_LANDING_BASE_URL: 'https://landing.example.test/', PHISHING_MAIL_TRANSPORT: undefined });
    const token = await adminToken('dev');

    const response = await getConfig(token).expect(200);

    expect(response.body).toEqual({
      transport: 'log',
      configured: true,
      reason: null,
      senderDomain: 'symulacje.example.test',
      landingHost: 'landing.example.test',
      sendsRealMail: false,
    });
    expect(app.get(PhishingMailTransport).name).toBe('log');
  });

  it('mailersend bez własnego tokenu: konfiguracja NIEKOMPLETNA (reason), transport "none" odrzuca wysyłkę', async () => {
    await boot({ PHISHING_MAIL_TRANSPORT: 'mailersend', PHISHING_EMAIL_DOMAIN: 'symulacje.example.test', PHISHING_MAILERSEND_API_TOKEN: undefined });
    const token = await adminToken('nokey');

    const response = await getConfig(token).expect(200);

    expect(response.body).toMatchObject({ transport: 'none', configured: false, reason: 'MAILERSEND_TOKEN_MISSING', sendsRealMail: false });
    await expect(
      app.get(PhishingMailTransport).send({ toEmail: 'a@b.example.pl', fromEmail: 'x@symulacje.example.test', fromName: 'X', subject: 'T', html: '<p>x</p>', text: 'x' }),
    ).rejects.toMatchObject({ retryable: false, code: 'NOT_CONFIGURED_MAILERSEND_TOKEN_MISSING' });
  });

  it('mailersend / smtp skonfigurowane: wybór przez env, SEKRETY nigdy nie trafiają do odpowiedzi', async () => {
    await boot({
      PHISHING_MAIL_TRANSPORT: 'mailersend',
      PHISHING_EMAIL_DOMAIN: 'symulacje.example.test',
      PHISHING_MAILERSEND_API_TOKEN: 'sekretny-token-symulacji',
      PHISHING_SMTP_URL: 'smtps://uzytkownik:sekretne-haslo@smtp.example.test:465',
    });
    const token = await adminToken('mailersend');

    const response = await getConfig(token).expect(200);

    expect(response.body).toMatchObject({ transport: 'mailersend', configured: true, sendsRealMail: true });
    expect(JSON.stringify(response.body)).not.toMatch(/sekret|smtp\.example|uzytkownik/);
    expect(app.get(PhishingMailTransport).name).toBe('mailersend');
  });

  it('smtp: wybrany przez env', async () => {
    await boot({
      PHISHING_MAIL_TRANSPORT: 'smtp',
      PHISHING_EMAIL_DOMAIN: 'symulacje.example.test',
      PHISHING_SMTP_URL: 'smtp://smtp.example.test:587',
    });
    const token = await adminToken('smtp');

    const response = await getConfig(token).expect(200);

    expect(response.body).toMatchObject({ transport: 'smtp', configured: true, sendsRealMail: true });
    expect(app.get(PhishingMailTransport).name).toBe('smtp');
  });

  it('organizacja PENDING (niezweryfikowana domena): 403 ORGANIZATION_PENDING_DOMAIN_VERIFICATION (endpoint bez @AllowPendingOrganization)', async () => {
    await boot({ PHISHING_EMAIL_DOMAIN: 'symulacje.example.test' });
    const { body } = await registerVerified(
      app,
      tenantPrisma,
      { email: `pending-${suffix}@pending.${domainSuffix}`, password: DEFAULT_TEST_PASSWORD },
      { activateOrganization: false },
    );

    const response = await getConfig(body.accessToken);

    expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
  });

  it('tylko ORG_ADMIN: bez tokenu 401, EMPLOYEE i DEPARTMENT_MANAGER 403', async () => {
    await boot({ PHISHING_EMAIL_DOMAIN: 'symulacje.example.test' });
    const admin = await registerVerified(app, tenantPrisma, { email: `roles-${suffix}@roles.${domainSuffix}`, password: DEFAULT_TEST_PASSWORD });
    const user = await tenantPrisma.runAuthLookup({ email: `roles-${suffix}@roles.${domainSuffix}` });
    const login = async (role: 'EMPLOYEE' | 'DEPARTMENT_MANAGER') => {
      const email = `${role.toLowerCase()}-${suffix}@roles.${domainSuffix}`;
      await tenantPrisma.runInOrgContext(user!.organizationId, async (tx) =>
        tx.user.create({ data: { organizationId: user!.organizationId, email, passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role, status: 'ACTIVE', emailVerifiedAt: new Date() } }),
      );
      return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: DEFAULT_TEST_PASSWORD }).expect(200)).body.accessToken as string;
    };

    await request(app.getHttpServer()).get('/phishing/config').expect(401);
    await getConfig(await login('EMPLOYEE')).expect(403);
    await getConfig(await login('DEPARTMENT_MANAGER')).expect(403);
    await getConfig(admin.body.accessToken).expect(200);
  });
});
