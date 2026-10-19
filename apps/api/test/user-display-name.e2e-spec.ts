import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// GET /users/me/display-name (legitymacja w odprawie odtwarzacza, D-081): WYŁĄCZNIE własne imię i inicjał nazwiska, bez
// parametru userId. Zasada nr 1: dane z tokena wywołującego, organizacja B nigdy nie dostaje danych organizacji A.
describe('Własne imię do legitymacji: GET /users/me/display-name (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domain = 'display-name-e2e-test.test';
  const emailA = `admin-a-${suffix}@org-a.${domain}`;
  const emailB = `admin-b-${suffix}@org-b.${domain}`;
  const emailPending = `admin-p-${suffix}@org-p.${domain}`;

  let orgAId: string;
  let userAId: string;
  let orgBId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenPending: string;

  const get = (token: string, path = '/users/me/display-name') =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const setNames = (orgId: string, userId: string, firstName: string | null, lastName: string | null) =>
    tenantPrisma.runInOrgContext(orgId, (tx) => tx.user.updateMany({ where: { id: userId, organizationId: orgId }, data: { firstName, lastName } }));

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    tokenA = (await registerVerified(app, tenantPrisma, { email: emailA, password: 'SuperSecret123!' })).body.accessToken;
    tokenB = (await registerVerified(app, tenantPrisma, { email: emailB, password: 'SuperSecret123!' })).body.accessToken;
    tokenPending = (
      await registerVerified(app, tenantPrisma, { email: emailPending, password: 'SuperSecret123!' }, { activateOrganization: false })
    ).body.accessToken;

    const adminA = (await tenantPrisma.runAuthLookup({ email: emailA }))!;
    const adminB = (await tenantPrisma.runAuthLookup({ email: emailB }))!;
    orgAId = adminA.organizationId;
    userAId = adminA.id;
    orgBId = adminB.organizationId;
    userBId = adminB.id;
    await setNames(orgAId, userAId, 'Anna', 'Kowalska');
    await setNames(orgBId, userBId, 'Bartosz', 'Nowak');
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: domain } } });
    await app.close();
  });

  it('zwraca imię i SAM inicjał nazwiska (pełne nazwisko nie wychodzi)', async () => {
    const body = (await get(tokenA).expect(200)).body;
    expect(body).toEqual({ firstName: 'Anna', lastInitial: 'K' });
    expect(JSON.stringify(body)).not.toContain('Kowalska');
  });

  it('izolacja A/B: każdy dostaje wyłącznie własne dane, także przy równoległych żądaniach', async () => {
    const [a, b] = await Promise.allSettled([get(tokenA), get(tokenB)]);
    expect(a.status === 'fulfilled' && a.value.body).toEqual({ firstName: 'Anna', lastInitial: 'K' });
    expect(b.status === 'fulfilled' && b.value.body).toEqual({ firstName: 'Bartosz', lastInitial: 'N' });
  });

  it('nie da się wskazać innego użytkownika: parametr w zapytaniu jest ignorowany, trasa z id nie istnieje', async () => {
    expect((await get(tokenA, `/users/me/display-name?userId=${userBId}`).expect(200)).body).toEqual({ firstName: 'Anna', lastInitial: 'K' });
    await get(tokenA, `/users/${userBId}/display-name`).expect(404);
  });

  it('brak imienia i nazwiska w profilu: null (klient bierze imię z e-maila)', async () => {
    await setNames(orgAId, userAId, null, null);
    try {
      expect((await get(tokenA).expect(200)).body).toEqual({ firstName: null, lastInitial: null });
    } finally {
      await setNames(orgAId, userAId, 'Anna', 'Kowalska');
    }
  });

  it('wymaga zalogowania: 401 bez tokena i z nieprawidłowym tokenem', async () => {
    await request(app.getHttpServer()).get('/users/me/display-name').expect(401);
    await get('nieprawidlowy.token.jwt').expect(401);
  });

  it('organizacja czekająca na weryfikację domeny (PENDING) jest zablokowana (guard fail-closed)', async () => {
    const response = await get(tokenPending);
    expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
  });
});
