import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// Fundament modelu samoobsługowego: RLS nowych tabel (organization_domains,
// organization_billing_details, legal_acceptances), partial unique index
// zweryfikowanej domeny, CHECK-i i kaskada. Testy działają na rolze runtime
// (RLS faktycznie ją ogranicza), tak jak reszta e2e.
describe('Organizacja: fundament modelu samoobsługowego (e2e, RLS + constraints)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'foundation-e2e.local';
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;

  // Komunikat Postgresa przy odrzuceniu przez RLS (WITH CHECK) - asercja na
  // PRZYCZYNĘ, żeby test nie przechodził z powodu innego błędu (FK, literówka).
  const RLS_VIOLATION = /row-level security/i;

  const billing = (organizationId: string) => ({
    organizationId,
    legalName: 'Firma Testowa Sp. z o.o.',
    taxId: '5260250274',
    addressLine: 'ul. Testowa 1',
    postalCode: '00-001',
    city: 'Warszawa',
  });

  async function createOrgWithUser(label: string) {
    const org = await prisma.organization.create({ data: { name: `${label}-${suffix}.${domainSuffix}` } });
    const user = await tenantPrisma.runInOrgContext(org.id, (tx) =>
      tx.user.create({
        data: { organizationId: org.id, email: `admin@${label}-${suffix}.${domainSuffix}`, passwordHash: 'x', role: 'ORG_ADMIN' },
      }),
    );
    return { org, user };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    const a = await createOrgWithUser('found-a');
    const b = await createOrgWithUser('found-b');
    orgAId = a.org.id;
    orgBId = b.org.id;
    userAId = a.user.id;
    userBId = b.user.id;
  });

  afterAll(async () => {
    // Kaskada FK usuwa domeny, dane do faktury, zgody i userów.
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  describe('Organization', () => {
    it('rola runtime NIE jest superuserem ani BYPASSRLS - inaczej testy RLS poniżej byłyby puste', async () => {
      const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    });

    it('domyślnie bez samodzielnego dołączania i bez znacznika ostrzeżenia; status ACTIVE do czasu nowej rejestracji', async () => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgAId } });

      // Domyślny status zmienia się na PENDING_DOMAIN_VERIFICATION razem z nową
      // rejestracją (migracja + kod), żeby stary kod nie tworzył organizacji
      // bez możliwości weryfikacji domeny.
      expect(org.status).toBe('ACTIVE');
      expect(org.selfJoinEnabled).toBe(false);
      expect(org.unverifiedWarningSentAt).toBeNull();
    });

    it('status PENDING_DOMAIN_VERIFICATION można ustawić jawnie', async () => {
      const org = await prisma.organization.create({
        data: { name: `found-pending-${suffix}.${domainSuffix}`, status: 'PENDING_DOMAIN_VERIFICATION' },
      });

      expect(org.status).toBe('PENDING_DOMAIN_VERIFICATION');
    });
  });

  describe('organization_domains', () => {
    it('RLS: bez kontekstu nic nie widać, w kontekście A widać tylko domenę A', async () => {
      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationDomain.create({
          data: { organizationId: orgAId, domain: `rls-a-${suffix}.${domainSuffix}`, verificationToken: 'tok-a' },
        }),
      );
      await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.create({
          data: { organizationId: orgBId, domain: `rls-b-${suffix}.${domainSuffix}`, verificationToken: 'tok-b' },
        }),
      );

      const withoutContext = await prisma.organizationDomain.findMany({
        where: { domain: { endsWith: domainSuffix } },
      });
      const asA = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.organizationDomain.findMany());
      const asB = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.organizationDomain.findMany());

      expect(withoutContext).toHaveLength(0);
      expect(asA.map((d) => d.verificationToken)).toEqual(['tok-a']);
      expect(asB.map((d) => d.verificationToken)).toEqual(['tok-b']);
    });

    it('RLS WITH CHECK: w kontekście A nie da się zapisać domeny organizacji B', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) =>
          tx.organizationDomain.create({
            data: { organizationId: orgBId, domain: `foreign-${suffix}.${domainSuffix}`, verificationToken: 't' },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    });

    it('RLS: w kontekście B UPDATE i DELETE cudzych wierszy (A) nie dotykają niczego', async () => {
      const updated = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.updateMany({
          where: { organizationId: orgAId },
          data: { verificationToken: 'przejete' },
        }),
      );
      const deleted = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.deleteMany({ where: { organizationId: orgAId } }),
      );
      const stillThere = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.organizationDomain.findMany());

      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
      expect(stillThere.length).toBeGreaterThan(0);
      expect(stillThere.every((row) => row.verificationToken !== 'przejete')).toBe(true);
    });

    it('kilka organizacji może czekać na TĘ SAMĄ niezweryfikowaną domenę', async () => {
      const shared = `shared-${suffix}.${domainSuffix}`;

      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationDomain.create({ data: { organizationId: orgAId, domain: shared, verificationToken: 'x1' } }),
      );
      await expect(
        tenantPrisma.runInOrgContext(orgBId, (tx) =>
          tx.organizationDomain.create({ data: { organizationId: orgBId, domain: shared, verificationToken: 'x2' } }),
        ),
      ).resolves.toBeDefined();
    });

    it('unikalność tylko wśród zweryfikowanych: pierwsza weryfikacja wygrywa, druga dostaje naruszenie unikalności', async () => {
      const contested = `contested-${suffix}.${domainSuffix}`;
      const a = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationDomain.create({ data: { organizationId: orgAId, domain: contested, verificationToken: 'c1' } }),
      );
      const b = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.create({ data: { organizationId: orgBId, domain: contested, verificationToken: 'c2' } }),
      );

      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationDomain.update({ where: { id: a.id }, data: { verifiedAt: new Date() } }),
      );

      const attempt = tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.update({ where: { id: b.id }, data: { verifiedAt: new Date() } }),
      );
      await expect(attempt).rejects.toMatchObject({ code: 'P2002' });
      // Przegrana organizacja zostaje z niezweryfikowanym wierszem.
      const loser = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationDomain.findUniqueOrThrow({ where: { id: b.id } }),
      );
      expect(loser.verifiedAt).toBeNull();
    });

    it('jedna organizacja nie może dwa razy dodać tej samej domeny', async () => {
      const once = `once-${suffix}.${domainSuffix}`;
      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationDomain.create({ data: { organizationId: orgAId, domain: once, verificationToken: 'o1' } }),
      );

      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) =>
          tx.organizationDomain.create({ data: { organizationId: orgAId, domain: once, verificationToken: 'o2' } }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('organization_billing_details', () => {
    it('RLS: bez kontekstu nic nie widać, B nie widzi danych faktury A', async () => {
      await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.organizationBillingDetails.create({ data: billing(orgAId) }));

      const withoutContext = await prisma.organizationBillingDetails.findMany();
      const asB = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationBillingDetails.findUnique({ where: { organizationId: orgAId } }),
      );
      const asA = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationBillingDetails.findUnique({ where: { organizationId: orgAId } }),
      );

      expect(withoutContext.filter((row) => row.organizationId === orgAId)).toHaveLength(0);
      expect(asB).toBeNull();
      expect(asA?.taxId).toBe('5260250274');
      expect(asA?.country).toBe('PL');
    });

    it('RLS WITH CHECK: w kontekście A nie da się zapisać danych faktury organizacji B', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) => tx.organizationBillingDetails.create({ data: billing(orgBId) })),
      ).rejects.toThrow(RLS_VIOLATION);
    });

    it('RLS: w kontekście B UPDATE i DELETE danych faktury A nie dotykają niczego', async () => {
      const updated = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationBillingDetails.updateMany({ where: { organizationId: orgAId }, data: { city: 'Przejęte' } }),
      );
      const deleted = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.organizationBillingDetails.deleteMany({ where: { organizationId: orgAId } }),
      );
      const stillThere = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.organizationBillingDetails.findUniqueOrThrow({ where: { organizationId: orgAId } }),
      );

      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
      expect(stillThere.city).toBe('Warszawa');
    });

    it('jedna organizacja ma co najwyżej jeden komplet danych do faktury', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) => tx.organizationBillingDetails.create({ data: billing(orgAId) })),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it.each([
      ['kraj inny niż PL', { country: 'DE' }],
      ['NIP nie z 10 cyfr', { taxId: '52-60-250' }],
      ['kod pocztowy w złym formacie', { postalCode: '00001' }],
      ['pusta nazwa formalna (same spacje)', { legalName: '   ' }],
      ['pusty adres', { addressLine: ' ' }],
      ['puste miasto', { city: '' }],
    ])('CHECK w bazie odrzuca: %s', async (_label, override) => {
      await expect(
        tenantPrisma.runInOrgContext(orgBId, (tx) =>
          tx.organizationBillingDetails.create({ data: { ...billing(orgBId), ...override } }),
        ),
      ).rejects.toThrow(/check constraint/i);
    });

    it('NIP jest nieunikalny: dwie organizacje mogą mieć ten sam NIP (anty-enumeracja)', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgBId, (tx) => tx.organizationBillingDetails.create({ data: billing(orgBId) })),
      ).resolves.toBeDefined();
    });
  });

  describe('legal_acceptances', () => {
    it('RLS: bez kontekstu nic nie widać, B nie widzi zgód A', async () => {
      await tenantPrisma.runInOrgContext(orgAId, (tx) =>
        tx.legalAcceptance.create({
          data: { organizationId: orgAId, userId: userAId, documentType: 'TERMS', version: 'draft-1' },
        }),
      );

      const withoutContext = await prisma.legalAcceptance.findMany();
      const asB = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.legalAcceptance.findMany());
      const asA = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.legalAcceptance.findMany());

      expect(withoutContext.filter((row) => row.organizationId === orgAId)).toHaveLength(0);
      expect(asB).toHaveLength(0);
      expect(asA).toHaveLength(1);
    });

    it('RLS WITH CHECK: w kontekście B nie da się zapisać zgody w organizacji A', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgBId, (tx) =>
          tx.legalAcceptance.create({
            data: { organizationId: orgAId, userId: userAId, documentType: 'PRIVACY_POLICY', version: 'draft-1' },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    });

    it('złożony FK: zgoda organizacji A nie może wskazywać użytkownika organizacji B (błąd klucza obcego)', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) =>
          tx.legalAcceptance.create({
            data: { organizationId: orgAId, userId: userBId, documentType: 'PRIVACY_POLICY', version: 'draft-1' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('RLS: w kontekście B UPDATE i DELETE zgód A nie dotykają niczego', async () => {
      const updated = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.legalAcceptance.updateMany({ where: { organizationId: orgAId }, data: { version: 'przejete' } }),
      );
      const deleted = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.legalAcceptance.deleteMany({ where: { organizationId: orgAId } }),
      );
      const stillThere = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.legalAcceptance.count());

      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
      expect(stillThere).toBeGreaterThan(0);
    });

    it('ta sama zgoda (użytkownik, dokument, wersja) nie zapisuje się dwa razy, a nowa wersja tak', async () => {
      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) =>
          tx.legalAcceptance.create({
            data: { organizationId: orgAId, userId: userAId, documentType: 'TERMS', version: 'draft-1' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });

      await expect(
        tenantPrisma.runInOrgContext(orgAId, (tx) =>
          tx.legalAcceptance.create({
            data: { organizationId: orgAId, userId: userAId, documentType: 'TERMS', version: 'v1' },
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('kaskada', () => {
    it('usunięcie organizacji usuwa jej domeny, dane do faktury i zgody (podstawa jobu sprzątania)', async () => {
      const { org, user } = await createOrgWithUser('found-cascade');
      await tenantPrisma.runInOrgContext(org.id, async (tx) => {
        await tx.organizationDomain.create({ data: { organizationId: org.id, domain: `c-${suffix}.${domainSuffix}`, verificationToken: 't' } });
        await tx.organizationBillingDetails.create({ data: billing(org.id) });
        await tx.legalAcceptance.create({
          data: { organizationId: org.id, userId: user.id, documentType: 'TERMS', version: 'draft-1' },
        });
      });

      // Sanity: przed usunięciem wiersze istnieją (inaczej test kaskady byłby pusty).
      const before = await tenantPrisma.runInOrgContext(org.id, async (tx) => ({
        domains: await tx.organizationDomain.count(),
        billing: await tx.organizationBillingDetails.count(),
        acceptances: await tx.legalAcceptance.count(),
      }));
      expect(before).toEqual({ domains: 1, billing: 1, acceptances: 1 });

      await prisma.organization.delete({ where: { id: org.id } });

      // Kontekst = id usuniętej organizacji: gdyby wiersze przetrwały, RLS
      // by je tu pokazał (a runCrossOrgQuery bez wyjątku w tych politykach
      // pokazałby zawsze 0 i test byłby pusty).
      const remaining = await tenantPrisma.runInOrgContext(org.id, async (tx) => ({
        domains: await tx.organizationDomain.count(),
        billing: await tx.organizationBillingDetails.count(),
        acceptances: await tx.legalAcceptance.count(),
      }));
      expect(remaining).toEqual({ domains: 0, billing: 0, acceptances: 0 });
    });
  });
});
