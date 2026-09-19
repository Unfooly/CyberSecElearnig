import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

// Klucze obce nie podlegają RLS, więc same nie pilnują, że powiązany wiersz
// należy do tej samej organizacji - do tego służą złożone FK (organizationId, id).
// Tu: users.departmentId -> departments (migracja user_department_same_organization).
describe('Integralność między organizacjami: users.departmentId (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'fk-integrity-e2e.local';
  let orgBId: string;
  let userBId: string;
  let deptAId: string;
  let deptBId: string;

  async function createOrg(label: string) {
    const org = await prisma.organization.create({ data: { name: `${label}-${suffix}.${domainSuffix}` } });
    const dept = await tenantPrisma.runInOrgContext(org.id, (tx) =>
      tx.department.create({ data: { organizationId: org.id, name: `Dział ${label}` } }),
    );
    const user = await tenantPrisma.runInOrgContext(org.id, (tx) =>
      tx.user.create({
        data: { organizationId: org.id, email: `u@${label}-${suffix}.${domainSuffix}`, passwordHash: 'x', role: 'EMPLOYEE' },
      }),
    );
    return { org, dept, user };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    const a = await createOrg('fk-a');
    const b = await createOrg('fk-b');
    orgBId = b.org.id;
    userBId = b.user.id;
    deptAId = a.dept.id;
    deptBId = b.dept.id;
  });

  afterAll(async () => {
    // Opcjonalnie: gdy beforeAll się nie powiedzie, nie maskujemy prawdziwego błędu.
    await prisma?.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app?.close();
  });

  // UWAGA: testy są zależne od kolejności (ostatnie usuwają dział organizacji B).

  it('użytkownik może dostać dział SWOJEJ organizacji', async () => {
    const updated = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.user.update({ where: { id: userBId }, data: { departmentId: deptBId } }),
    );

    expect(updated.departmentId).toBe(deptBId);
  });

  it('UPDATE: użytkownik organizacji B nie może dostać działu organizacji A (błąd klucza obcego)', async () => {
    await expect(
      tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.user.update({ where: { id: userBId }, data: { departmentId: deptAId } }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('INSERT: nowy użytkownik organizacji B nie może od razu dostać działu organizacji A', async () => {
    await expect(
      tenantPrisma.runInOrgContext(orgBId, (tx) =>
        tx.user.create({
          data: {
            organizationId: orgBId,
            email: `insert@fk-b-${suffix}.${domainSuffix}`,
            passwordHash: 'x',
            departmentId: deptAId,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('brak działu (NULL) nadal jest dozwolony', async () => {
    const updated = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.user.update({ where: { id: userBId }, data: { departmentId: null } }),
    );

    expect(updated.departmentId).toBeNull();
  });

  it('usunięcie działu nadal zeruje departmentId użytkowników (SET NULL zostaje)', async () => {
    await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.user.update({ where: { id: userBId }, data: { departmentId: deptBId } }),
    );

    await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.department.delete({ where: { id: deptBId } }));

    const user = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.user.findUniqueOrThrow({ where: { id: userBId } }));
    expect(user.departmentId).toBeNull();
    expect(user.organizationId).toBe(orgBId);
  });

  it('usunięcie organizacji z działami i przypisanymi użytkownikami działa (kaskada nie blokuje się na złożonym FK)', async () => {
    const { org, dept, user } = await createOrg('fk-cascade');
    await tenantPrisma.runInOrgContext(org.id, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { departmentId: dept.id } }),
    );

    // Kontekst = id tej organizacji: przed usunięciem widać 1 użytkownika z działem,
    // po usunięciu RLS pokazałby ewentualne pozostałości (nie ukryłby ich).
    const before = await tenantPrisma.runInOrgContext(org.id, async (tx) => ({
      users: await tx.user.count({ where: { departmentId: dept.id } }),
      departments: await tx.department.count(),
    }));
    expect(before).toEqual({ users: 1, departments: 1 });

    await expect(prisma.organization.delete({ where: { id: org.id } })).resolves.toBeDefined();

    const after = await tenantPrisma.runInOrgContext(org.id, async (tx) => ({
      users: await tx.user.count(),
      departments: await tx.department.count(),
    }));
    expect(after).toEqual({ users: 0, departments: 0 });
  });
});
