import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// D-177: przypisanie przypięte do starszej wersji treści, ale PRZED ukończeniem pierwszego bloku, przy /start przechodzi na najnowszą
// wersję (np. moduł otwarty tuż przed importem nowej treści). Kurs dalej niż blok 0 albo ukończony zostaje na swojej wersji.
describe('Nowa wersja treści przed pierwszym blokiem: POST /courses/:id/start (e2e, D-177)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const uniqueSuffix = Date.now();
  const orgAEmail = `admin-a-${uniqueSuffix}@org-a.course-upgrade-e2e-test.test`;
  const orgBEmail = `admin-b-${uniqueSuffix}@org-b.course-upgrade-e2e-test.test`;
  let orgAId: string;
  let orgBId: string;
  let courseId: string;
  let openedToken: string;
  let openedId: string;
  let advancedToken: string;
  let advancedId: string;
  let orgBToken: string;
  let orgBUserId: string;

  const quiz = (prompt: string) => ({
    type: 'QUIZ',
    prompt,
    options: [
      { text: 'Zła odpowiedź', correct: false },
      { text: 'Dobra odpowiedź', correct: true },
    ],
  });

  async function signToken(payload: { sub: string; organizationId: string; role: string; email: string }): Promise<string> {
    return jwtService.signAsync(payload, { secret: configService.get<string>('JWT_SECRET'), expiresIn: '15m' });
  }

  async function employee(organizationId: string, name: string): Promise<{ id: string; token: string }> {
    return tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const user = await tx.user.create({
        data: { organizationId, email: `${name}-${uniqueSuffix}@course-upgrade-e2e-test.test`, passwordHash: 'unused-in-tests', role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      await tx.courseAssignment.create({ data: { organizationId, userId: user.id, courseId, mandatory: true } });
      return { id: user.id, token: await signToken({ sub: user.id, organizationId, role: 'EMPLOYEE', email: user.email }) };
    });
  }

  const start = (token: string) => request(app.getHttpServer()).post(`/courses/${courseId}/start`).set('Authorization', `Bearer ${token}`).expect(200);
  const pinnedVersion = (organizationId: string, userId: string) =>
    tenantPrisma.runInOrgContext(organizationId, async (tx) => (await tx.courseAssignment.findFirst({ where: { organizationId, userId, courseId } }))?.courseVersionId);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    await registerVerified(app, tenantPrisma, { email: orgAEmail, password: 'SuperSecret123!' });
    orgAId = (await tenantPrisma.runAuthLookup({ email: orgAEmail }))!.organizationId;
    await registerVerified(app, tenantPrisma, { email: orgBEmail, password: 'SuperSecret123!' });
    orgBId = (await tenantPrisma.runAuthLookup({ email: orgBEmail }))!.organizationId;

    // Kurs z dwoma blokami; wersja 1 powstaje leniwie przy pierwszym /start (ensureLegacyVersion).
    courseId = (
      await prisma.course.create({
        data: { title: `Upgrade Test ${uniqueSuffix}`, category: 'GENERAL_AWARENESS', durationMinutes: 5, mandatory: true, contentBlocks: [quiz('Stara treść 1'), quiz('Stara treść 2')] },
      })
    ).id;
    ({ id: openedId, token: openedToken } = await employee(orgAId, 'otworzyl'));
    ({ id: advancedId, token: advancedToken } = await employee(orgAId, 'w-polowie'));
    ({ id: orgBUserId, token: orgBToken } = await employee(orgBId, 'org-b'));
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'course-upgrade-e2e-test.test' } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await app.close();
  });

  it('otwarty przed importem (blok 0) przechodzi na nową wersję; w połowie (po bloku 0) zostaje na swojej; inna organizacja niezależnie', async () => {
    // Stan przed importem: jeden tylko otworzył kurs, drugi ukończył pierwszy blok, trzeci (organizacja B) też tylko otworzył.
    await start(openedToken);
    await start(advancedToken);
    await request(app.getHttpServer()).post(`/courses/${courseId}/progress`).set('Authorization', `Bearer ${advancedToken}`).send({ blockIndex: 0, answer: 1 }).expect(200);
    await start(orgBToken);
    const v1 = await pinnedVersion(orgAId, openedId);
    expect(v1).toBeTruthy();
    expect(await pinnedVersion(orgAId, advancedId)).toBe(v1);

    // Import nowej treści (jak content-import.ts: kolejna CourseVersion).
    const v2 = await prisma.courseVersion.create({
      data: { courseId, version: 2, schemaVersion: 1, contentHash: `upgrade-2-${uniqueSuffix}`, contentBlocks: [quiz('Nowa treść 1'), quiz('Nowa treść 2')], blockCount: 2 },
    });

    const opened = await start(openedToken);
    expect(opened.body.contentBlocks[0].prompt).toBe('Nowa treść 1');
    expect(opened.body.currentBlockIndex).toBe(0);
    expect(await pinnedVersion(orgAId, openedId)).toBe(v2.id);

    const advanced = await start(advancedToken);
    expect(advanced.body.contentBlocks[0].prompt).toBe('Stara treść 1');
    expect(advanced.body.currentBlockIndex).toBe(1);
    expect(await pinnedVersion(orgAId, advancedId)).toBe(v1);

    // Organizacja B: własne przypisanie, przechodzi samo przy własnym /start (RLS - A go nie widzi i nie zmienia).
    expect(await pinnedVersion(orgBId, orgBUserId)).toBe(v1);
    const orgB = await start(orgBToken);
    expect(orgB.body.contentBlocks[0].prompt).toBe('Nowa treść 1');
    expect(await pinnedVersion(orgBId, orgBUserId)).toBe(v2.id);

    // Po przejściu wynik bloku 0 nowej wersji zapisuje się normalnie.
    const saved = await request(app.getHttpServer()).post(`/courses/${courseId}/progress`).set('Authorization', `Bearer ${openedToken}`).send({ blockIndex: 0, answer: 1 }).expect(200);
    expect(saved.body.currentBlockIndex).toBe(1);
  });
});
