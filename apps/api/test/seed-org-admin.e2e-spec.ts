import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedOrgAdmin, namesFromEmail, CONFIRM_VALUE } = require('../prisma/seed-org-admin.js');

describe('seed-org-admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  const suffix = Date.now();
  // Domena zweryfikowana jest unikalna, więc każdy test ma własną (poza testem "domena zajęta").
  const domainOf = (label: string) => `${label}-${suffix}.example.test`;
  const domain = domainOf('glowna');
  const orgName = `Seed ${suffix} seed-org-admin-e2e.test`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'seed-org-admin-e2e.test' } } });
    await app.close();
  });

  it('tworzy organizację ACTIVE ze ZWERYFIKOWANĄ domeną i konto ORG_ADMIN (ACTIVE, e-mail potwierdzony); imię z adresu', async () => {
    const email = `jakub.pieterwas@${domain}`;

    const result = await seedOrgAdmin(prisma, { email, organizationName: orgName }, {});

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: result.organizationId } });
    expect(organization).toMatchObject({ status: 'ACTIVE', name: orgName });
    const [domainRow, user] = await tenantPrisma.runInOrgContext(result.organizationId, (tx) =>
      Promise.all([tx.organizationDomain.findFirstOrThrow(), tx.user.findFirstOrThrow({ where: { email } })]),
    );
    expect(domainRow).toMatchObject({ domain, organizationId: result.organizationId });
    expect(domainRow.verifiedAt).not.toBeNull();
    expect(user).toMatchObject({ role: 'ORG_ADMIN', status: 'ACTIVE', firstName: 'Jakub', lastName: 'Pieterwas' });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, koszt 12
  });

  it('hasło jest LOSOWE i nieznane (żadne zgadnięte nie działa), a wynik seeda go nie zawiera', async () => {
    const email = `losowe@${domainOf('losowe')}`;
    const result = await seedOrgAdmin(prisma, { email, organizationName: `${orgName} losowe` }, {});

    for (const guess of ['SuperSecret123!', 'Demo12345!x', 'password', email]) {
      await request(app.getHttpServer()).post('/auth/login').send({ email, password: guess }).expect(401);
    }
    expect(JSON.stringify(result)).not.toMatch(/\$2[aby]\$|passwordHash|password/i);
  });

  it('wejście: "Zapomniałem hasła" -> link -> nowe hasło -> logowanie; API działa (guard PENDING nie blokuje, bo organizacja ACTIVE)', async () => {
    const email = `wejscie@${domainOf('wejscie')}`;
    await seedOrgAdmin(prisma, { email, organizationName: `${orgName} wejscie` }, {});
    const sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);

    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(200);
    const resetUrl = (sendSpy.mock.calls.at(-1)?.[0].templateData as { resetUrl: string }).resetUrl;
    sendSpy.mockRestore();
    await request(app.getHttpServer()).post('/auth/reset-password').send({ token: new URL(resetUrl).searchParams.get('token'), newPassword: 'NoweHaslo456' }).expect(200);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'NoweHaslo456' }).expect(200);

    // Endpointy biznesowe (globalny guard: organizacja musi być ACTIVE) działają od razu.
    await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    await request(app.getHttpServer()).get('/phishing/templates').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
  });

  it('nie nadpisuje: istniejące konto => błąd i brak nowej organizacji', async () => {
    const email = `dubel@${domainOf('dubel')}`;
    await seedOrgAdmin(prisma, { email, organizationName: `${orgName} dubel` }, {});
    const before = await prisma.organization.count({ where: { name: { endsWith: 'seed-org-admin-e2e.test' } } });

    await expect(seedOrgAdmin(prisma, { email: email.toUpperCase(), organizationName: `${orgName} dubel 2` }, {})).rejects.toThrow(/już istnieje/);

    expect(await prisma.organization.count({ where: { name: { endsWith: 'seed-org-admin-e2e.test' } } })).toBe(before);
  });

  it('domena już zweryfikowana w INNEJ organizacji: czytelny błąd, transakcja cofnięta (brak organizacji i użytkownika)', async () => {
    const taken = domainOf('zajeta');
    await seedOrgAdmin(prisma, { email: `pierwszy@${taken}`, organizationName: `${orgName} pierwszy` }, {});
    const before = await prisma.organization.count({ where: { name: { endsWith: 'seed-org-admin-e2e.test' } } });

    await expect(seedOrgAdmin(prisma, { email: `drugi@${taken}`, organizationName: `${orgName} drugi` }, {})).rejects.toThrow(/już zweryfikowana w innej organizacji/);

    expect(await prisma.organization.count({ where: { name: { endsWith: 'seed-org-admin-e2e.test' } } })).toBe(before);
    expect(await tenantPrisma.runAuthLookup({ email: `drugi@${taken}` })).toBeNull();
  });

  it('produkcja: odmowa bez jawnego potwierdzenia środowiska testowego; z potwierdzeniem działa', async () => {
    const email = `prod@${domainOf('prod')}`;

    await expect(seedOrgAdmin(prisma, { email, organizationName: `${orgName} prod` }, { NODE_ENV: 'production' })).rejects.toThrow(/odmawia na NODE_ENV=production/);
    await expect(seedOrgAdmin(prisma, { email, organizationName: `${orgName} prod` }, { NODE_ENV: 'production', SEED_CONFIRM_TEST_ENVIRONMENT: 'tak' })).rejects.toThrow(/odmawia/);
    expect(await tenantPrisma.runAuthLookup({ email })).toBeNull();
    await expect(
      seedOrgAdmin(prisma, { email, organizationName: `${orgName} prod` }, { NODE_ENV: 'production', SEED_CONFIRM_TEST_ENVIRONMENT: CONFIRM_VALUE }),
    ).resolves.toMatchObject({ email });
  });

  it.each(['', 'bez-malpy', 'a@b', '@x.pl', 'a b@x.pl'])('niepoprawny e-mail "%s" => błąd, nic nie powstaje', async (email) => {
    await expect(seedOrgAdmin(prisma, { email, organizationName: `${orgName} zly` }, {})).rejects.toThrow(/poprawny SEED_ADMIN_EMAIL/);
  });

  it('namesFromEmail: imię i nazwisko z części lokalnej (best effort, pola opcjonalne)', () => {
    expect(namesFromEmail('jakub.pieterwas@x.pl')).toEqual({ firstName: 'Jakub', lastName: 'Pieterwas' });
    expect(namesFromEmail('admin@x.pl')).toEqual({ firstName: 'Admin', lastName: null });
    expect(namesFromEmail('jan-maria.kowalski.nowak@x.pl')).toEqual({ firstName: 'Jan', lastName: 'Maria Kowalski Nowak' });
  });
});
