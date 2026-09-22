import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// "Rozpocznij od nowa" (D-069): POST /courses/:id/restart archiwizuje własne, UKOŃCZONE przypisanie (archivedAt) i
// tworzy nowe, aktywne - historia (wynik/XP/odznaki) zostaje bez zmian, nic nie jest kasowane.
describe('Restart kursu: POST /courses/:id/restart (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const uniqueSuffix = Date.now();
  const orgAEmail = `admin-a-${uniqueSuffix}@org-a.course-restart-e2e-test.test`;
  const orgBEmail = `admin-b-${uniqueSuffix}@org-b.course-restart-e2e-test.test`;

  let orgAId: string;
  let orgBId: string;
  let employeeAId: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let employeeOrgBId: string;
  let employeeOrgBToken: string;

  let courseId: string;

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
    void orgAResponse;
    const orgAAdmin = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    orgAId = orgAAdmin!.organizationId;

    const orgBResponse = await registerVerified(app, tenantPrisma, { email: orgBEmail, password: 'SuperSecret123!' });
    void orgBResponse;
    const orgBAdmin = await tenantPrisma.runAuthLookup({ email: orgBEmail });
    orgBId = orgBAdmin!.organizationId;

    // Kurs obowiązkowy, jeden blok VIDEO (bez oceny - kończy się od razu po /progress, jak w gamification.e2e-spec.ts).
    const course = await prisma.course.create({
      data: {
        title: `Restart Test ${uniqueSuffix}`,
        category: 'GENERAL_AWARENESS',
        durationMinutes: 5,
        mandatory: true,
        contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/restart-1.mp4' }],
      },
    });
    courseId = course.id;
    // Żadnej wersji na start - CoursesService (resolveVersion/ensureLegacyVersion) tworzy "wersję 1" leniwie przy
    // pierwszym /start, kopiując wtedy course.contentBlocks (tak jak przy prawdziwym, bezpośrednio utworzonym kursie).

    // /start wymaga JUŻ ISTNIEJĄCEGO CourseAssignment (findOwnAssignment: 404 bez niego) - tak jak przy ręcznym
    // przypisaniu przez ORG_ADMIN (tu: wprost w bazie, mandatory:true, żeby restart miał co przepisać - self-assign
    // zawsze wymusza mandatory:false, więc świadomie go tu NIE używamy).
    employeeAToken = await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      const employee = await tx.user.create({
        data: { organizationId: orgAId, email: `pracownik-a-${uniqueSuffix}@course-restart-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      employeeAId = employee.id;
      await tx.courseAssignment.create({ data: { organizationId: orgAId, userId: employee.id, courseId, mandatory: true } });
      return signToken({ sub: employee.id, organizationId: orgAId, role: 'EMPLOYEE', email: employee.email });
    });
    employeeBToken = await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      const employee = await tx.user.create({
        data: { organizationId: orgAId, email: `pracownik-b-${uniqueSuffix}@course-restart-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      await tx.courseAssignment.create({ data: { organizationId: orgAId, userId: employee.id, courseId, mandatory: true } });
      return signToken({ sub: employee.id, organizationId: orgAId, role: 'EMPLOYEE', email: employee.email });
    });

    // Pracownik w DRUGIEJ organizacji (izolacja A/B - Course jest globalny, więc ten sam courseId, ale osobne
    // CourseAssignment pod RLS organizacji B).
    employeeOrgBToken = await tenantPrisma.runInOrgContext(orgBId, async (tx) => {
      const employee = await tx.user.create({
        data: { organizationId: orgBId, email: `pracownik-org-b-${uniqueSuffix}@course-restart-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      employeeOrgBId = employee.id;
      await tx.courseAssignment.create({ data: { organizationId: orgBId, userId: employee.id, courseId, mandatory: true } });
      return signToken({ sub: employee.id, organizationId: orgBId, role: 'EMPLOYEE', email: employee.email });
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'course-restart-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  async function completeCourse(token: string): Promise<void> {
    await request(app.getHttpServer()).post(`/courses/${courseId}/start`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ blockIndex: 0 })
      .expect(200);
  }

  it('restart na kursie NIEUKOŃCZONYM (IN_PROGRESS): 409, przypisanie zostaje bez zmian', async () => {
    await request(app.getHttpServer()).post(`/courses/${courseId}/start`).set('Authorization', `Bearer ${employeeBToken}`).expect(200);
    await request(app.getHttpServer()).post(`/courses/${courseId}/restart`).set('Authorization', `Bearer ${employeeBToken}`).expect(409);

    const myCourses = await request(app.getHttpServer()).get('/courses/my').set('Authorization', `Bearer ${employeeBToken}`).expect(200);
    expect(myCourses.body).toContainEqual(expect.objectContaining({ courseId, status: 'IN_PROGRESS' }));
  });

  it('restart na kursie, który nigdy nie był przypisany: 404', async () => {
    await request(app.getHttpServer()).post('/courses/nie-ma-takiego-kursu/restart').set('Authorization', `Bearer ${employeeAToken}`).expect(404);
  });

  it('happy path: archiwizuje stare (COMPLETED, archivedAt ustawiony), tworzy nowe aktywne (NOT_STARTED, najnowsza wersja), /start na nim działa od bloku 1, XP/ranking bez zmian, historia (score) zostaje', async () => {
    await completeCourse(employeeAToken);

    const beforeGamification = await request(app.getHttpServer())
      .get('/users/me/gamification')
      .set('Authorization', `Bearer ${employeeAToken}`)
      .expect(200);

    const oldAssignment = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgAId, userId: employeeAId, courseId } }),
    );
    expect(oldAssignment?.status).toBe('COMPLETED');
    expect(oldAssignment?.archivedAt).toBeNull();
    // Wersja 1 utworzona leniwie przy pierwszym /start (ensureLegacyVersion) - to jest ta, na której employeeA
    // faktycznie skończył.
    expect(oldAssignment?.courseVersionId).not.toBeNull();
    const versionAtCompletion = oldAssignment!.courseVersionId;

    // Symulacja importu NOWEJ treści PO ukończeniu (prawdziwy content-import.ts tworzy kolejną CourseVersion) -
    // restart musi przypiąć TĘ, nie wersję, na której employeeA faktycznie skończył kurs.
    const newerVersion = await prisma.courseVersion.create({
      data: {
        courseId,
        version: 2,
        schemaVersion: 1,
        contentHash: `hash-2-${uniqueSuffix}`,
        contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/restart-1.mp4' }],
        blockCount: 1,
      },
    });

    const restart = await request(app.getHttpServer())
      .post(`/courses/${courseId}/restart`)
      .set('Authorization', `Bearer ${employeeAToken}`)
      .expect(200);
    expect(restart.body).toHaveProperty('assignmentId');
    expect(restart.body.assignmentId).not.toBe(oldAssignment!.id);

    const [archivedOld, newAssignment] = await Promise.all([
      tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.findUnique({ where: { id: oldAssignment!.id } })),
      tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.findUnique({ where: { id: restart.body.assignmentId } })),
    ]);
    expect(archivedOld?.archivedAt).not.toBeNull();
    expect(archivedOld?.status).toBe('COMPLETED');
    expect(archivedOld?.score).not.toBeNull();
    expect(newAssignment?.archivedAt).toBeNull();
    expect(newAssignment?.status).toBe('NOT_STARTED');
    expect(newAssignment?.currentBlockIndex).toBe(0);
    expect(newAssignment?.mandatory).toBe(true);
    // Nowe przypisanie przypina NAJNOWSZĄ wersję (zaimportowaną PO ukończeniu), nie tę, na której pracownik
    // faktycznie skończył kurs poprzednio.
    expect(newAssignment?.courseVersionId).toBe(newerVersion.id);
    expect(newAssignment?.courseVersionId).not.toBe(versionAtCompletion);

    // /courses/my: tylko AKTYWNE (D-069) - jeden wiersz dla tego kursu, NOT_STARTED, nie dwa.
    const myCourses = await request(app.getHttpServer()).get('/courses/my').set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    const rowsForCourse = myCourses.body.filter((row: { courseId: string }) => row.courseId === courseId);
    expect(rowsForCourse).toHaveLength(1);
    expect(rowsForCourse[0]).toMatchObject({ status: 'NOT_STARTED', currentBlockIndex: 0 });

    // /start na nowym przypisaniu działa od bloku 1 (currentBlockIndex 0 -> IN_PROGRESS).
    const startAgain = await request(app.getHttpServer()).post(`/courses/${courseId}/start`).set('Authorization', `Bearer ${employeeAToken}`).expect(200);
    expect(startAgain.body).toMatchObject({ status: 'IN_PROGRESS', currentBlockIndex: 0 });

    // Sam restart (przed ponownym ukończeniem) nie dotyka gamifikacji - ranking/XP niezmienione.
    const afterGamification = await request(app.getHttpServer())
      .get('/users/me/gamification')
      .set('Authorization', `Bearer ${employeeAToken}`)
      .expect(200);
    expect(afterGamification.body.xp).toBe(beforeGamification.body.xp);
    expect(afterGamification.body.level).toBe(beforeGamification.body.level);
  });

  it('izolacja A/B: restart pracownika organizacji B tworzy WŁASNE, osobne przypisania (ten sam globalny courseId) i RLS blokuje odczyt cudzego wiersza po samym id, w obie strony', async () => {
    // Punkt odniesienia: dowolne przypisanie organizacji A (utworzone we wcześniejszych testach tego pliku) -
    // organizacja B nie może go zobaczyć nawet przez findUnique po id (nie tylko przez where po organizationId).
    const orgAAssignment = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgAId, userId: employeeAId, courseId } }),
    );
    expect(orgAAssignment).not.toBeNull();
    const blockedForOrgB = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.courseAssignment.findUnique({ where: { id: orgAAssignment!.id } }),
    );
    expect(blockedForOrgB).toBeNull();

    await completeCourse(employeeOrgBToken);
    const orgBOldAssignment = await tenantPrisma.runInOrgContext(orgBId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgBId, userId: employeeOrgBId, courseId } }),
    );
    expect(orgBOldAssignment?.status).toBe('COMPLETED');

    const restart = await request(app.getHttpServer())
      .post(`/courses/${courseId}/restart`)
      .set('Authorization', `Bearer ${employeeOrgBToken}`)
      .expect(200);

    // Organizacja A nie widzi (nawet po id) nowo utworzonego/zarchiwizowanego przypisania organizacji B.
    const blockedForOrgA = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findUnique({ where: { id: restart.body.assignmentId } }),
    );
    expect(blockedForOrgA).toBeNull();
    const oldBlockedForOrgA = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findUnique({ where: { id: orgBOldAssignment!.id } }),
    );
    expect(oldBlockedForOrgA).toBeNull();

    // Restart w organizacji B nie ruszył przypisania employeeA (nadal to samo id, sprzed tego testu).
    const orgAAssignmentAfter = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.courseAssignment.findFirst({ where: { organizationId: orgAId, userId: employeeAId, courseId } }),
    );
    expect(orgAAssignmentAfter?.id).toBe(orgAAssignment!.id);

    // Bez bypassu RLS (runCrossOrgQuery, jedyny udokumentowany wyjątek) obie organizacje razem mają dokładnie te
    // przypisania tego kursu, które faktycznie istnieją - żadnego "zlania się" wierszy między tenantami.
    const crossOrgTotal = await tenantPrisma.runCrossOrgQuery((tx) => tx.courseAssignment.count({ where: { courseId } }));
    const orgACount = await tenantPrisma.runInOrgContext(orgAId, (tx) => tx.courseAssignment.count({ where: { organizationId: orgAId, courseId } }));
    const orgBCount = await tenantPrisma.runInOrgContext(orgBId, (tx) => tx.courseAssignment.count({ where: { organizationId: orgBId, courseId } }));
    expect(crossOrgTotal).toBe(orgACount + orgBCount);
  });

  it('drugi restart zaraz po pierwszym (bez ponownego ukończenia): 409 - nowe aktywne przypisanie jest NOT_STARTED, nie COMPLETED', async () => {
    await completeCourse(employeeBToken);
    await request(app.getHttpServer()).post(`/courses/${courseId}/restart`).set('Authorization', `Bearer ${employeeBToken}`).expect(200);

    await request(app.getHttpServer()).post(`/courses/${courseId}/restart`).set('Authorization', `Bearer ${employeeBToken}`).expect(409);
  });

  it('SUPER_ADMIN nie ma dostępu do restartu (poza rolami pracowniczymi - D-065/D-069)', async () => {
    const superAdminToken = await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      const superAdmin = await tx.user.create({
        data: { organizationId: orgAId, email: `super-admin-${uniqueSuffix}@course-restart-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'SUPER_ADMIN' },
      });
      return signToken({ sub: superAdmin.id, organizationId: orgAId, role: 'SUPER_ADMIN', email: superAdmin.email });
    });

    await request(app.getHttpServer()).post(`/courses/${courseId}/restart`).set('Authorization', `Bearer ${superAdminToken}`).expect(403);
  });
});
