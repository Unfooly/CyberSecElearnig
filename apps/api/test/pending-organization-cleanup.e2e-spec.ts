import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { renderTemplate } from '../src/email/templates';
import {
  DELETE_AFTER_DAYS,
  PendingOrganizationCleanupService,
  WARNING_AFTER_DAYS,
} from '../src/organizations/pending-organization-cleanup.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Job sprzątania organizacji PENDING z ZAMROŻONYM zegarem: `now` jest stałe,
// a wiek organizacji ustawiany względem niego (createdAt), więc testy nie
// zależą od czasu ściennego.
describe('Sprzątanie organizacji PENDING (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let cleanup: PendingOrganizationCleanupService;
  let sendSpy: jest.SpyInstance;

  const now = new Date('2027-03-15T03:00:00.000Z');
  const suffix = `cleanup-e2e-${Date.now()}.test`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    cleanup = app.get(PendingOrganizationCleanupService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });

  beforeEach(() => {
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: suffix } } });
    await app.close();
  });

  /** Organizacja w danym wieku (względem zamrożonego `now`) z adminem, pracownikiem, danymi do faktury i domeną. */
  async function createOrganization(label: string, ageMs: number, status: 'PENDING_DOMAIN_VERIFICATION' | 'ACTIVE' = 'PENDING_DOMAIN_VERIFICATION') {
    const organization = await prisma.organization.create({
      data: { name: `${label} ${suffix}`, status, createdAt: new Date(now.getTime() - ageMs) },
    });
    const adminEmail = `admin@${label}.${suffix}`;
    await tenantPrisma.runInOrgContext(organization.id, async (tx) => {
      await tx.user.createMany({
        data: [
          { organizationId: organization.id, email: adminEmail, passwordHash: 'x', role: 'ORG_ADMIN', status: 'INVITED' },
          { organizationId: organization.id, email: `pracownik@${label}.${suffix}`, passwordHash: 'x', role: 'EMPLOYEE', status: 'ACTIVE' },
        ],
      });
      await tx.organizationDomain.create({
        data: { organizationId: organization.id, domain: `${label}.${suffix}`, verificationToken: 'c'.repeat(64) },
      });
      await tx.organizationBillingDetails.create({
        data: {
          organizationId: organization.id,
          legalName: 'Firma',
          taxId: '5260250274',
          addressLine: 'ul. Testowa 1',
          postalCode: '00-001',
          city: 'Warszawa',
          country: 'PL',
        },
      });
    });
    return { id: organization.id, adminEmail };
  }

  const exists = async (id: string) => (await prisma.organization.count({ where: { id } })) === 1;
  const countRows = (id: string) =>
    tenantPrisma.runInOrgContext(id, async (tx) => ({
      users: await tx.user.count(),
      domains: await tx.organizationDomain.count(),
      billing: await tx.organizationBillingDetails.count(),
    }));
  const warningsTo = (email: string) =>
    sendSpy.mock.calls.filter(([o]) => o.templateName === 'pending-organization-warning' && o.to === email).length;

  it('stałe: ostrzeżenie po 7, usunięcie po 14 dniach', () => {
    expect([WARNING_AFTER_DAYS, DELETE_AFTER_DAYS]).toEqual([7, 14]);
  });

  it('szablon ostrzeżenia escapuje nazwę organizacji i zawiera datę usunięcia oraz link', () => {
    const rendered = renderTemplate('pending-organization-warning', {
      organizationName: 'A <script>x</script> & B',
      deleteOn: '29.03.2027',
      loginUrl: 'https://app.example/login',
    })!;

    expect(rendered.html).toContain('A &lt;script&gt;');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('29.03.2027');
    expect(rendered.text).toContain('https://app.example/login');
  });

  describe('ostrzeżenie (7 dni)', () => {
    it('6 dni 23 h: bez maila; dokładnie 7 dni: jeden mail do admina (nie do pracownika), z datą usunięcia', async () => {
      const young = await createOrganization('w-young', 7 * DAY_MS - HOUR_MS);
      const due = await createOrganization('w-due', 7 * DAY_MS);

      const result = await cleanup.run(now);

      expect(warningsTo(young.adminEmail)).toBe(0);
      expect(warningsTo(due.adminEmail)).toBe(1);
      expect(sendSpy.mock.calls.some(([o]) => String(o.to).startsWith('pracownik@w-due'))).toBe(false);
      const [call] = sendSpy.mock.calls.find(([o]) => o.to === due.adminEmail)!;
      expect(call.templateData).toMatchObject({ organizationName: `w-due ${suffix}` });
      expect(call.templateData.deleteOn).toEqual(expect.any(String));
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: due.id } });
      expect(org.unverifiedWarningSentAt).toEqual(now);
      expect(result.warned).toBeGreaterThanOrEqual(1);
    });

    it('dokładnie raz: kolejne biegi (także następnego dnia) nie wysyłają drugiego maila', async () => {
      const org = await createOrganization('w-once', 8 * DAY_MS);

      await cleanup.run(now);
      await cleanup.run(now);
      await cleanup.run(new Date(now.getTime() + DAY_MS));

      expect(warningsTo(org.adminEmail)).toBe(1);
    });

    it('dwa równoległe biegi: jeden mail (atomowe zajęcie slotu)', async () => {
      const org = await createOrganization('w-race', 9 * DAY_MS);

      await Promise.all([cleanup.run(now), cleanup.run(now)]);

      expect(warningsTo(org.adminEmail)).toBe(1);
    });

    it('nieudana wysyłka (false albo wyjątek) zwalnia slot - następny bieg ponawia, a po sukcesie już nie', async () => {
      const failing = await createOrganization('w-fail', 10 * DAY_MS);
      sendSpy.mockImplementation(async (o) => (o.to === failing.adminEmail ? false : true));
      await cleanup.run(now);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: failing.id } })).unverifiedWarningSentAt).toBeNull();

      sendSpy.mockImplementation(async (o) => {
        if (o.to === failing.adminEmail) throw new Error('smtp down');
        return true;
      });
      await cleanup.run(now);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: failing.id } })).unverifiedWarningSentAt).toBeNull();

      sendSpy.mockResolvedValue(true);
      await cleanup.run(now);
      await cleanup.run(now);
      expect(warningsTo(failing.adminEmail)).toBe(3); // 2 nieudane próby + 1 udana
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: failing.id } })).unverifiedWarningSentAt).toEqual(now);
    });

    it('kilku adminów, wysyłka do drugiego pada: slot zostaje (bez duplikatu do pierwszego), a pierwszy dostał dokładnie jeden mail', async () => {
      const org = await createOrganization('w-partial', 10 * DAY_MS);
      const second = `admin2@w-partial.${suffix}`;
      await tenantPrisma.runInOrgContext(org.id, (tx) =>
        tx.user.create({ data: { organizationId: org.id, email: second, passwordHash: 'x', role: 'ORG_ADMIN', status: 'ACTIVE' } }),
      );
      sendSpy.mockImplementation(async (o) => {
        if (o.to === second) throw new Error('smtp down');
        return true;
      });

      await cleanup.run(now);
      sendSpy.mockResolvedValue(true);
      await cleanup.run(now);

      expect(warningsTo(org.adminEmail)).toBe(1);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).unverifiedWarningSentAt).toEqual(now);
    });

    it('domyślny zegar: handler zadania (bez podanego `now`) też działa', async () => {
      const org = await createOrganization('w-default-clock', 0);

      await expect(cleanup.run()).resolves.toEqual({ deleted: expect.any(Number), warned: expect.any(Number) });

      expect(await exists(org.id)).toBe(true); // świeża organizacja - bez ostrzeżenia i usunięcia
      expect(warningsTo(org.adminEmail)).toBe(0);
    });

    it('organizacja ACTIVE (domena zweryfikowana) nie dostaje ostrzeżenia', async () => {
      const active = await createOrganization('w-active', 10 * DAY_MS, 'ACTIVE');

      await cleanup.run(now);

      expect(warningsTo(active.adminEmail)).toBe(0);
    });
  });

  describe('usuwanie (14 dni)', () => {
    it('13 dni 23 h nie jest usuwana; dokładnie 14 dni jest, razem z użytkownikami, domeną i danymi do faktury', async () => {
      const day13 = await createOrganization('d-13', 14 * DAY_MS - HOUR_MS);
      const day14 = await createOrganization('d-14', 14 * DAY_MS);

      const result = await cleanup.run(now);

      expect(await exists(day13.id)).toBe(true);
      expect(await countRows(day13.id)).toEqual({ users: 2, domains: 1, billing: 1 });
      expect(await exists(day14.id)).toBe(false);
      expect(await countRows(day14.id)).toEqual({ users: 0, domains: 0, billing: 0 });
      expect(result.deleted).toBeGreaterThanOrEqual(1);
    });

    it('13 dni: nie usunięta, ale ostrzeżona; 14. dzień: usunięta', async () => {
      const org = await createOrganization('d-flow', 13 * DAY_MS);

      await cleanup.run(now);
      expect(await exists(org.id)).toBe(true);
      expect(warningsTo(org.adminEmail)).toBe(1);

      await cleanup.run(new Date(now.getTime() + DAY_MS));
      expect(await exists(org.id)).toBe(false);
    });

    it('organizacja po terminie, która nie dostała ostrzeżenia (job nie działał), jest usuwana bez maila', async () => {
      const org = await createOrganization('d-nowarn', 20 * DAY_MS);

      await cleanup.run(now);

      expect(await exists(org.id)).toBe(false);
      expect(warningsTo(org.adminEmail)).toBe(0);
    });

    it('organizacja ACTIVE nigdy nie jest usuwana, nawet po 100 dniach', async () => {
      const active = await createOrganization('d-active', 100 * DAY_MS, 'ACTIVE');

      await cleanup.run(now);

      expect(await exists(active.id)).toBe(true);
      expect(await countRows(active.id)).toEqual({ users: 2, domains: 1, billing: 1 });
    });

    it('organizacja z przypisaniami kursów też jest usuwana kaskadowo, a globalny kurs zostaje', async () => {
      const org = await createOrganization('d-data', 15 * DAY_MS);
      const course = await prisma.course.create({
        data: { title: `Kurs ${suffix}`, category: 'EMAIL_SECURITY', durationMinutes: 5, contentBlocks: [] },
      });
      const admin = await tenantPrisma.runAuthLookup({ email: org.adminEmail });
      await tenantPrisma.runInOrgContext(org.id, (tx) =>
        tx.courseAssignment.create({ data: { organizationId: org.id, courseId: course.id, userId: admin!.id } }),
      );

      try {
        await cleanup.run(now);

        expect(await exists(org.id)).toBe(false);
        expect(await prisma.courseAssignment.count({ where: { organizationId: org.id } })).toBe(0);
        expect(await prisma.course.count({ where: { id: course.id } })).toBe(1);
      } finally {
        await prisma.course.deleteMany({ where: { id: course.id } });
      }
    });

    it('izolacja: usunięcie organizacji A nie rusza danych organizacji B', async () => {
      const a = await createOrganization('iso-a', 15 * DAY_MS);
      const b = await createOrganization('iso-b', 2 * DAY_MS);

      await cleanup.run(now);

      expect(await exists(a.id)).toBe(false);
      expect(await exists(b.id)).toBe(true);
      expect(await countRows(b.id)).toEqual({ users: 2, domains: 1, billing: 1 });
      expect(warningsTo(b.adminEmail)).toBe(0);
    });
  });
});
