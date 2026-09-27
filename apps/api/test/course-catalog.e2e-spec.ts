import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Katalog kursów i samoobsługowe przypisanie (D-065, hotfix widoczności zaimportowanego kursu - fix/imported-course-visibility).
// Course jest globalny (bez organizationId/RLS) - katalog pokazuje kursy bez przypisania TEGO pracownika; "Rozpocznij"
// tworzy CourseAssignment TYLKO jemu, w JEGO organizacji, ZAWSZE mandatory:false, niezależnie od treści kursu.
describe('Katalog kursów: GET /courses/catalog, POST /courses/:id/self-assign (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const uniqueSuffix = Date.now();
  const orgAEmail = `admin-a-${uniqueSuffix}@org-a.course-catalog-e2e-test.test`;
  const orgBEmail = `admin-b-${uniqueSuffix}@org-b.course-catalog-e2e-test.test`;

  let orgAId: string;
  let orgBId: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let superAdminToken: string;

  // Kurs "mandatory:true" w treści - świadomie, żeby sprawdzić, że self-assign i tak zapisuje mandatory:false (D-065 pkt 3).
  let mandatoryCourseId: string;

  async function signToken(payload: { sub: string; organizationId: string; role: string; email: string }): Promise<string> {
    return jwtService.signAsync(payload, { secret: configService.get<string>('JWT_SECRET'), expiresIn: '15m' });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    const orgAResponse = await registerVerified(app, tenantPrisma, { email: orgAEmail, password: 'SuperSecret123!' });
    const orgBResponse = await registerVerified(app, tenantPrisma, { email: orgBEmail, password: 'SuperSecret123!' });
    const orgAAdmin = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    const orgBAdmin = await tenantPrisma.runAuthLookup({ email: orgBEmail });
    orgAId = orgAAdmin!.organizationId;
    orgBId = orgBAdmin!.organizationId;
    void orgAResponse;
    void orgBResponse;

    const mandatoryCourse = await prisma.course.create({
      data: {
        title: `Katalog Test - kurs ${uniqueSuffix}`,
        subtitle: 'Podtytuł testowy',
        thumbnail: 'assets/katalog-test/miniatura.1a2b3c4d.svg',
        level: 'basic',
        category: 'GENERAL_AWARENESS',
        durationMinutes: 7,
        mandatory: true,
        objectives: ['Cel 1', 'Cel 2'],
        contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/v1.mp4' }],
      },
    });
    mandatoryCourseId = mandatoryCourse.id;

    employeeAToken = await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      const employee = await tx.user.create({
        data: { organizationId: orgAId, email: `pracownik-a-${uniqueSuffix}@course-catalog-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      return signToken({ sub: employee.id, organizationId: orgAId, role: 'EMPLOYEE', email: employee.email });
    });

    employeeBToken = await tenantPrisma.runInOrgContext(orgBId, async (tx) => {
      const employee = await tx.user.create({
        data: { organizationId: orgBId, email: `pracownik-b-${uniqueSuffix}@course-catalog-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      return signToken({ sub: employee.id, organizationId: orgBId, role: 'EMPLOYEE', email: employee.email });
    });

    // SUPER_ADMIN "na boku" w organizacji B (jak dashboard.e2e-spec.ts) - rola blokuje katalog/self-assign niezależnie od organizacji.
    superAdminToken = await tenantPrisma.runInOrgContext(orgBId, async (tx) => {
      const superAdmin = await tx.user.create({
        data: { organizationId: orgBId, email: `super-admin-${uniqueSuffix}@course-catalog-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'SUPER_ADMIN' },
      });
      return signToken({ sub: superAdmin.id, organizationId: orgBId, role: 'SUPER_ADMIN', email: superAdmin.email });
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'course-catalog-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: mandatoryCourseId } });
    await app.close();
  });

  it('katalog pokazuje kurs z metadanymi (subtitle/thumbnail/level/objectives) przed przypisaniem, dla obu organizacji niezależnie', async () => {
    for (const token of [employeeAToken, employeeBToken]) {
      const response = await request(app.getHttpServer()).get('/courses/catalog').set('Authorization', `Bearer ${token}`).expect(200);
      expect(response.body).toContainEqual({
        courseId: mandatoryCourseId,
        title: `Katalog Test - kurs ${uniqueSuffix}`,
        subtitle: 'Podtytuł testowy',
        thumbnail: 'assets/katalog-test/miniatura.1a2b3c4d.svg',
        level: 'basic',
        objectives: ['Cel 1', 'Cel 2'],
        category: 'GENERAL_AWARENESS',
        durationMinutes: 7,
        totalBlocks: 1,
      });
    }
  });

  it('SUPER_ADMIN nie ma dostępu do katalogu ani self-assign (nie jest pracownikiem organizacji - D-065)', async () => {
    await request(app.getHttpServer()).get('/courses/catalog').set('Authorization', `Bearer ${superAdminToken}`).expect(403);
    await request(app.getHttpServer()).post(`/courses/${mandatoryCourseId}/self-assign`).set('Authorization', `Bearer ${superAdminToken}`).expect(403);
  });

  it('self-assign: pracownik A dostaje WŁASNE, NIEOBOWIĄZKOWE przypisanie (mandatory:false mimo course.mandatory=true); kurs znika z jego katalogu i pojawia się w /courses/my; /start działa', async () => {
    const assign = await request(app.getHttpServer())
      .post(`/courses/${mandatoryCourseId}/self-assign`)
      .set('Authorization', `Bearer ${employeeAToken}`)
      .expect(200);
    expect(assign.body).toHaveProperty('assignmentId');

    const catalogAfter = await request(app.getHttpServer()).get('/courses/catalog').set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    expect(catalogAfter.body).not.toContainEqual(expect.objectContaining({ courseId: mandatoryCourseId }));

    const myCourses = await request(app.getHttpServer()).get('/courses/my').set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    expect(myCourses.body).toContainEqual(
      expect.objectContaining({ courseId: mandatoryCourseId, mandatory: false, status: 'NOT_STARTED' }),
    );

    await request(app.getHttpServer()).post(`/courses/${mandatoryCourseId}/start`).set('Authorization', `Bearer ${employeeAToken}`).expect(200);
  });

  it('idempotentne: drugie self-assign tego samego pracownika zwraca 200 z TYM SAMYM assignmentId, bez duplikatu', async () => {
    const first = await request(app.getHttpServer()).post(`/courses/${mandatoryCourseId}/self-assign`).set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    const second = await request(app.getHttpServer()).post(`/courses/${mandatoryCourseId}/self-assign`).set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    expect(second.body.assignmentId).toBe(first.body.assignmentId);

    const count = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.count({ where: { organizationId: orgAId, courseId: mandatoryCourseId } }));
    expect(count).toBe(1);
  });

  it('izolacja A/B: przypisanie pracownika A jest niewidoczne dla organizacji B - katalog B nadal pokazuje kurs, self-assign B tworzy WŁASNE, osobne przypisanie', async () => {
    const catalogB = await request(app.getHttpServer()).get('/courses/catalog').set('Authorization', `Bearer ${employeeBToken}`).expect(200);
    expect(catalogB.body).toContainEqual(expect.objectContaining({ courseId: mandatoryCourseId }));

    const assignB = await request(app.getHttpServer()).post(`/courses/${mandatoryCourseId}/self-assign`).set('Authorization', `Bearer ${employeeBToken}`).expect(200);

    const countA = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.count({ where: { organizationId: orgAId, courseId: mandatoryCourseId } }));
    const countB = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.count({ where: { organizationId: orgBId, courseId: mandatoryCourseId } }));
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    const crossOrgTotal = await tenantPrisma.runCrossOrgQuery((tx) => tx.courseAssignment.count({ where: { courseId: mandatoryCourseId } }));
    expect(crossOrgTotal).toBe(2);
    expect(assignB.body.assignmentId).not.toBe(undefined);
  });

  it('self-assign na nieistniejącym kursie: 404, bez tworzenia przypisania', async () => {
    await request(app.getHttpServer()).post('/courses/nie-ma-takiego-kursu/self-assign').set('Authorization', `Bearer ${employeeAToken}`).expect(404);
  });
});
