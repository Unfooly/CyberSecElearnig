import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

describe('Dashboard i raporty (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const uniqueSuffix = Date.now();
  // Osobne domeny dla A/B - organizations.name jest teraz unikalne (nazwa =
  // domena), więc dwie organizacje w jednym pliku testowym potrzebują dwóch
  // różnych domen. Pracownicy/super-admin poniżej są tworzeni bezpośrednio
  // w bazie (nie przez /auth/register), więc mogą zostać na wspólnej domenie
  // dashboard-e2e-test.test bez kolizji z tym constraintem.
  const orgAEmail = `admin-a-${uniqueSuffix}@org-a.dashboard-e2e-test.test`;
  const orgBEmail = `admin-b-${uniqueSuffix}@org-b.dashboard-e2e-test.test`;

  let orgAId: string;
  let orgBId: string;
  let orgAAdminToken: string;
  let orgBAdminToken: string;
  let employeeToken: string;
  let superAdminToken: string;

  let courseMandatory1Id: string;
  let courseMandatory2Id: string;
  let courseOptionalId: string;
  let laterOptionalCompletionIso: string;

  async function signToken(payload: {
    sub: string;
    organizationId: string;
    role: string;
    email: string;
  }): Promise<string> {
    return jwtService.signAsync(payload, {
      secret: configService.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    });
  }

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
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    const orgAResponse = await registerVerified(app, tenantPrisma, {
        email: orgAEmail,
        password: 'SuperSecret123!',
      });
    const orgBResponse = await registerVerified(app, tenantPrisma, {
        email: orgBEmail,
        password: 'SuperSecret123!',
      });

    orgAAdminToken = orgAResponse.body.accessToken;
    orgBAdminToken = orgBResponse.body.accessToken;

    const orgAAdmin = await tenantPrisma.runAuthLookup({ email: orgAEmail });
    const orgBAdmin = await tenantPrisma.runAuthLookup({ email: orgBEmail });
    orgAId = orgAAdmin!.organizationId;
    orgBId = orgBAdmin!.organizationId;

    // Katalog kursów jest globalny (Course nie ma organizationId).
    const [courseMandatory1, courseMandatory2, courseOptional] = await Promise.all([
      prisma.course.create({
        data: {
          title: `Dashboard Test Mandatory 1 ${uniqueSuffix}`,
          category: 'EMAIL_SECURITY',
          durationMinutes: 5,
          mandatory: true,
          contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/v1.mp4' }],
        },
      }),
      prisma.course.create({
        data: {
          title: `Dashboard Test Mandatory 2 ${uniqueSuffix}`,
          category: 'IT_HYGIENE',
          durationMinutes: 5,
          mandatory: true,
          contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/v2.mp4' }],
        },
      }),
      prisma.course.create({
        data: {
          title: `Dashboard Test Optional ${uniqueSuffix}`,
          category: 'GENERAL_AWARENESS',
          durationMinutes: 5,
          mandatory: false,
          contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/v3.mp4' }],
        },
      }),
    ]);
    courseMandatory1Id = courseMandatory1.id;
    courseMandatory2Id = courseMandatory2.id;
    courseOptionalId = courseOptional.id;

    // Fixture dla organizacji A:
    //   - adminA (ORG_ADMIN, bez działu): mandatory1 COMPLETED, optional COMPLETED
    //   - employee1 (dział "IT"): mandatory1 COMPLETED, mandatory2 COMPLETED
    //   - employee2 (dział "IT"): mandatory1 IN_PROGRESS, mandatory2 NOT_STARTED
    //   - employee3 (bez działu): mandatory1 NOT_STARTED, mandatory2 OVERDUE
    // Oczekiwane /overview: completionRate = round(3/7*100) = 43,
    //   activeUsers = {count: 3, total: 4} (adminA/employee1/employee2 aktywni),
    //   overdueCount = 1.
    // Oczekiwane /departments: "IT" = 2/4 = 50%, "Brak działu" = 1/3 = 33%,
    //   posortowane rosnąco: "Brak działu" (33) przed "IT" (50).
    await tenantPrisma.runInOrgContext(orgAId, async (tx) => {
      const department = await tx.department.create({
        data: { organizationId: orgAId, name: `IT ${uniqueSuffix}` },
      });

      const employee1 = await tx.user.create({
        data: {
          organizationId: orgAId,
          email: `employee1-${uniqueSuffix}@dashboard-e2e-test.test`,
          passwordHash: 'unused-in-tests',
          role: 'EMPLOYEE',
          departmentId: department.id,
        },
      });
      const employee2 = await tx.user.create({
        data: {
          organizationId: orgAId,
          email: `employee2-${uniqueSuffix}@dashboard-e2e-test.test`,
          passwordHash: 'unused-in-tests',
          role: 'EMPLOYEE',
          departmentId: department.id,
        },
      });
      const employee3 = await tx.user.create({
        data: {
          organizationId: orgAId,
          email: `employee3-${uniqueSuffix}@dashboard-e2e-test.test`,
          passwordHash: 'unused-in-tests',
          role: 'EMPLOYEE',
        },
      });

      const now = new Date();
      // Ukończenie kursu OPCJONALNEGO jest później niż obowiązkowego -
      // celowo, żeby testy niżej wykryłyby regresję, w której
      // lastCourseCompletionAt liczyłby się tylko z kursów obowiązkowych
      // (dokładnie taki błąd znalazło code review tego modułu).
      const laterOptionalCompletion = new Date(now.getTime() + 60_000);
      laterOptionalCompletionIso = laterOptionalCompletion.toISOString();

      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: orgAAdmin!.id,
          courseId: courseMandatory1Id,
          status: 'COMPLETED',
          completedAt: now,
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: orgAAdmin!.id,
          courseId: courseOptionalId,
          status: 'COMPLETED',
          completedAt: laterOptionalCompletion,
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee1.id,
          courseId: courseMandatory1Id,
          status: 'COMPLETED',
          completedAt: now,
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee1.id,
          courseId: courseMandatory2Id,
          status: 'COMPLETED',
          completedAt: now,
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee2.id,
          courseId: courseMandatory1Id,
          status: 'IN_PROGRESS',
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee2.id,
          courseId: courseMandatory2Id,
          status: 'NOT_STARTED',
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee3.id,
          courseId: courseMandatory1Id,
          status: 'NOT_STARTED',
        },
      });
      await tx.courseAssignment.create({
        data: {
          organizationId: orgAId,
          userId: employee3.id,
          courseId: courseMandatory2Id,
          status: 'OVERDUE',
        },
      });

      employeeToken = await signToken({
        sub: employee1.id,
        organizationId: orgAId,
        role: 'EMPLOYEE',
        email: employee1.email,
      });
    });

    // SUPER_ADMIN "na boku" w organizacji B - rola daje dostęp cross-org
    // niezależnie od tego, do której organizacji formalnie należy konto.
    await tenantPrisma.runInOrgContext(orgBId, async (tx) => {
      const superAdmin = await tx.user.create({
        data: {
          organizationId: orgBId,
          email: `super-admin-${uniqueSuffix}@dashboard-e2e-test.test`,
          passwordHash: 'unused-in-tests',
          role: 'SUPER_ADMIN',
        },
      });
      superAdminToken = await signToken({
        sub: superAdmin.id,
        organizationId: orgBId,
        role: 'SUPER_ADMIN',
        email: superAdmin.email,
      });
    });
    // Organizacja B poza tym pozostaje pusta (brak przypisań) - używana do
    // testów izolacji tenantów.
  });

  afterAll(async () => {
    // Najpierw organizacje (kasują przypisania kaskadowo), potem kursy: kurs z przypisaniami jest chroniony (RESTRICT, B-032).
    await prisma.organization.deleteMany({
      where: { name: { endsWith: 'dashboard-e2e-test.test' } },
    });
    await prisma.course.deleteMany({
      where: { id: { in: [courseMandatory1Id, courseMandatory2Id, courseOptionalId] } },
    });
    await app.close();
  });

  describe('GET /dashboard/overview', () => {
    it('liczy completionRate tylko z obowiązkowych kursów, activeUsers i overdueCount', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/overview')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      expect(response.body).toEqual({
        completionRate: 43,
        activeUsers: { count: 3, total: 4 },
        overdueCount: 1,
        phishingClickRate: null,
        phishingSubmitRate: null,
        phishingReportRate: null,
      });
    });

    it('izolacja tenantów: organizacja B (bez przypisań) ma zupełnie inne liczby niż A', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/overview')
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .expect(200);

      // total: 2 = adminB + testowe konto SUPER_ADMIN (umieszczone w
      // organizacji B w beforeAll) - żadne z nich nie ma przypisań, więc
      // activeUsers.count zostaje 0.
      expect(response.body).toEqual({
        completionRate: null,
        activeUsers: { count: 0, total: 2 },
        overdueCount: 0,
        phishingClickRate: null,
        phishingSubmitRate: null,
        phishingReportRate: null,
      });
    });

    it('ignoruje próbę podania organizationId w query string - endpoint go w ogóle nie przyjmuje', async () => {
      const response = await request(app.getHttpServer())
        .get(`/dashboard/overview?organizationId=${orgBId}`)
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      // Nadal liczby organizacji A, mimo próby podmiany przez query string.
      expect(response.body.completionRate).toBe(43);
    });

    it('EMPLOYEE nie ma dostępu do dashboardu', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/overview')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('odrzuca dostęp bez tokena', async () => {
      await request(app.getHttpServer()).get('/dashboard/overview').expect(401);
    });
  });

  describe('GET /dashboard/departments', () => {
    it('liczy completionRate per dział, z "Brak działu" jako osobnym wpisem, posortowane rosnąco', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/departments')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      expect(response.body).toEqual([
        expect.objectContaining({
          departmentId: null,
          departmentName: 'Brak działu',
          completionRate: 33,
          mandatoryTotal: 3,
          mandatoryCompleted: 1,
        }),
        expect.objectContaining({
          departmentName: `IT ${uniqueSuffix}`,
          completionRate: 50,
          mandatoryTotal: 4,
          mandatoryCompleted: 2,
        }),
      ]);
    });

    it('izolacja tenantów: organizacja B nie widzi działów/danych organizacji A', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/departments')
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .expect(200);

      const names = response.body.map((entry: { departmentName: string }) => entry.departmentName);
      expect(names).not.toContain(`IT ${uniqueSuffix}`);
    });

    it('EMPLOYEE nie ma dostępu', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/departments')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });
  });

  describe('GET /dashboard/export', () => {
    it('zwraca CSV z jedną linią per user, tylko dla własnej organizacji', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/export?format=csv')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');

      const lines = (response.text as string).trim().split('\r\n');
      expect(lines[0]).toBe('Email,Dział,Ukończone/Wszystkie obowiązkowe,Ostatnie ukończenie kursu');
      // adminA + employee1 + employee2 + employee3 = 4 wiersze danych.
      expect(lines).toHaveLength(5);
      expect(lines.some((line) => line.startsWith(`${orgAEmail},`))).toBe(true);
      const adminARow = lines.find((line) => line.startsWith(`${orgAEmail},`));
      expect(adminARow).toContain('1/1');
      // "Ostatnie ukończenie kursu" liczy się ze WSZYSTKICH przypisań (też
      // opcjonalnych) - adminA ukończył kurs opcjonalny później niż
      // obowiązkowy, więc to ta późniejsza data musi się tu pojawić, nie
      // data ukończenia kursu obowiązkowego.
      expect(adminARow).toContain(laterOptionalCompletionIso);
      expect(
        lines.find((line) => line.startsWith(`employee1-${uniqueSuffix}@dashboard-e2e-test.test,`)),
      ).toContain('2/2');
      const employee2Row = lines.find((line) =>
        line.startsWith(`employee2-${uniqueSuffix}@dashboard-e2e-test.test,`),
      );
      expect(employee2Row).toContain('0/2');
      // employee2 nic nie ukończył - ostatnia kolumna musi zostać pusta,
      // nie zmyślona.
      expect(employee2Row).toBe(
        `employee2-${uniqueSuffix}@dashboard-e2e-test.test,IT ${uniqueSuffix},0/2,`,
      );
      // Organizacja B (adminB) nie może wyciekać do eksportu organizacji A.
      expect(response.text).not.toContain(orgBEmail);
    });

    it('odrzuca nieobsługiwany format (PDF poza zakresem)', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/export?format=pdf')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(400);
    });
  });

  describe('GET /dashboard/admin/organizations', () => {
    it('SUPER_ADMIN widzi WSZYSTKIE organizacje naraz', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/admin/organizations')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const orgAEntry = response.body.find((org: { id: string }) => org.id === orgAId);
      const orgBEntry = response.body.find((org: { id: string }) => org.id === orgBId);

      expect(orgAEntry).toEqual(
        expect.objectContaining({ userCount: 4, completionRate: 43 }),
      );
      // Musi widzieć ukończenie kursu OPCJONALNEGO (późniejsze niż
      // obowiązkowego) - inaczej regresja z code review (liczenie tylko z
      // mandatory) przeszłaby niezauważona.
      expect(new Date(orgAEntry.lastCourseCompletionAt).toISOString()).toBe(
        laterOptionalCompletionIso,
      );
      // adminB + super-admin testowy, oboje bez przypisań.
      expect(orgBEntry).toEqual(
        expect.objectContaining({ userCount: 2, completionRate: null, lastCourseCompletionAt: null }),
      );
    });

    it('zwykły ORG_ADMIN dostaje 403, nie może zobaczyć cudzych organizacji', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/admin/organizations')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(403);
    });

    it('EMPLOYEE dostaje 403', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/admin/organizations')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });
  });
  describe('GET /dashboard/stats/trends', () => {
    it('zwraca 6 punktów miesięcznych; bieżący miesiąc odzwierciedla dane organizacji A (3/7 = 43%)', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/stats/trends')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(6);
      const current = response.body[5];
      expect(current).toEqual({
        month: expect.stringMatching(/^\d{4}-\d{2}$/),
        completionRate: 43,
        mandatoryTotal: 7,
        mandatoryCompleted: 3,
      });
      // Przypisania powstały dopiero teraz - wcześniejsze miesiące bez danych.
      expect(response.body[0].completionRate).toBeNull();
    });

    it('izolacja tenantów: admin organizacji B (bez przypisań) nie widzi żadnych danych organizacji A', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/stats/trends')
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(6);
      expect(response.body.every((p: { mandatoryTotal: number }) => p.mandatoryTotal === 0)).toBe(true);
      expect(response.body.every((p: { completionRate: number | null }) => p.completionRate === null)).toBe(true);
    });

    it('odrzuca EMPLOYEE (403) i brak tokena (401)', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/stats/trends')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
      await request(app.getHttpServer()).get('/dashboard/stats/trends').expect(401);
    });
  });

  describe('GET /dashboard/users-status', () => {
    const emailOf = (n: number) => `employee${n}-${uniqueSuffix}@dashboard-e2e-test.test`;

    it('zwraca pracowników organizacji A z podsumowaniem obowiązkowych kursów i statusem zgodności', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      expect(response.body.total).toBe(4);
      const byEmail = Object.fromEntries(
        response.body.items.map((row: { email: string }) => [row.email, row]),
      );

      expect(byEmail[emailOf(1)]).toMatchObject({
        completedMandatoryCoursesCount: 2,
        totalMandatoryCoursesCount: 2,
        completionPercentage: 100,
        complianceStatus: 'COMPLIANT',
      });
      expect(byEmail[emailOf(1)].lastActivityAt).toEqual(expect.any(String));
      expect(byEmail[emailOf(2)]).toMatchObject({ completionPercentage: 0, complianceStatus: 'IN_PROGRESS' });
      expect(byEmail[emailOf(3)]).toMatchObject({ complianceStatus: 'OVERDUE' });
      expect(byEmail[emailOf(1)].departmentName).toMatch(/^IT /);
      expect(byEmail[orgAEmail].departmentName).toBeNull();
    });

    it('izolacja tenantów: admin B widzi wyłącznie użytkowników własnej organizacji', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .expect(200);

      const emails = response.body.items.map((row: { email: string }) => row.email);
      expect(emails).toContain(orgBEmail);
      expect(emails).not.toContain(orgAEmail);
      expect(emails).not.toContain(emailOf(1));
      expect(response.body.total).toBe(emails.length);
    });

    it('nie pozwala obejść izolacji przez departmentId z innej organizacji (pusty wynik, nie dane A)', async () => {
      const departments = await request(app.getHttpServer())
        .get('/dashboard/departments')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);
      const itDepartment = departments.body.find((d: { departmentName: string }) => d.departmentName.startsWith('IT '));

      const response = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ departmentId: itDepartment.departmentId })
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('filtruje po dziale i wyszukuje po e-mailu', async () => {
      const departments = await request(app.getHttpServer())
        .get('/dashboard/departments')
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);
      const itDepartment = departments.body.find((d: { departmentName: string }) => d.departmentName.startsWith('IT '));

      const byDepartment = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ departmentId: itDepartment.departmentId })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);
      expect(byDepartment.body.total).toBe(2);

      const bySearch = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ search: 'EMPLOYEE3' })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);
      expect(bySearch.body.items.map((row: { email: string }) => row.email)).toEqual([emailOf(3)]);
    });

    it('sortuje po % ukończenia i stronicuje bez powtórzeń', async () => {
      const first = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ sortBy: 'completion', sortDir: 'desc', pageSize: 2, page: 1 })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);
      const second = await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ sortBy: 'completion', sortDir: 'desc', pageSize: 2, page: 2 })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(200);

      const percentages = first.body.items.map((row: { completionPercentage: number }) => row.completionPercentage);
      expect(percentages[0]).toBeGreaterThanOrEqual(percentages[1]);
      const ids = [...first.body.items, ...second.body.items].map((row: { id: string }) => row.id);
      expect(new Set(ids).size).toBe(4);
    });

    it('waliduje parametry: zły sortBy i za duży pageSize => 400', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ sortBy: 'passwordHash' })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .query({ pageSize: 1000 })
        .set('Authorization', `Bearer ${orgAAdminToken}`)
        .expect(400);
    });

    it('odrzuca EMPLOYEE (403) i brak tokena (401)', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/users-status')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
      await request(app.getHttpServer()).get('/dashboard/users-status').expect(401);
    });
  });
});
