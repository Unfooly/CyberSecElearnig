import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

describe('Row-Level Security jest fail-closed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const uniqueSuffix = Date.now();
  const orgAEmail = `rls-a-${uniqueSuffix}@e2e-test.local`;
  const orgBEmail = `rls-b-${uniqueSuffix}@e2e-test.local`;
  let orgAId: string;
  let courseId: string;

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

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `RLS Org A ${uniqueSuffix}`,
        email: orgAEmail,
        password: 'SuperSecret123!',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `RLS Org B ${uniqueSuffix}`,
        email: orgBEmail,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const orgAUser = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    orgAId = orgAUser!.organizationId;

    const course = await prisma.course.create({
      data: {
        title: `RLS Test Course ${uniqueSuffix}`,
        category: 'GENERAL_AWARENESS',
        durationMinutes: 5,
        contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/video.mp4' }],
      },
    });
    courseId = course.id;

    await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.create({
        data: { organizationId: orgAId, userId: orgAUser!.id, courseId },
      }),
    );
  });

  afterAll(async () => {
    await prisma.courseAssignment.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e-test.local' } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: 'RLS Org ' } } });
    await app.close();
  });

  it('nie zwraca żadnych wierszy przez surowy PrismaService bez ustawionego kontekstu organizacji', async () => {
    // To jest dokładnie scenariusz, przed którym RLS ma chronić: kod, który
    // przez pomyłkę wstrzykuje PrismaService zamiast TenantPrismaService i nie
    // ustawia kontekstu organizacji. Fail-closed = zero wierszy, nie wszystkie.
    const users = await prisma.user.findMany({
      where: { email: { in: [orgAEmail, orgBEmail] } },
    });

    expect(users).toEqual([]);
  });

  it('zwraca tylko wiersze właściwej organizacji, gdy kontekst jest ustawiony przez TenantPrismaService', async () => {
    const usersInOrgAContext = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.user.findMany({ where: { email: { in: [orgAEmail, orgBEmail] } } }),
    );

    const emails = usersInOrgAContext.map((user) => user.email);
    expect(emails).toContain(orgAEmail);
    expect(emails).not.toContain(orgBEmail);
  });

  it('course_assignments: nie zwraca żadnych wierszy bez ustawionego kontekstu organizacji', async () => {
    const assignments = await prisma.courseAssignment.findMany({ where: { courseId } });
    expect(assignments).toEqual([]);
  });

  it('course_assignments: zwraca wiersz tylko w kontekście właściwej organizacji', async () => {
    const inOrgAContext = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findMany({ where: { courseId } }),
    );
    expect(inOrgAContext).toHaveLength(1);
    expect(inOrgAContext[0].organizationId).toBe(orgAId);
  });
});
