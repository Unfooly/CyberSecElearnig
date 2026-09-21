import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { registerVerified } from './helpers/auth';

// Preferencje WŁASNEGO konta (lektor w odtwarzaczu szkoleń): GET/PATCH /users/me/preferences. Zasada nr 1: użytkownik zmienia wyłącznie
// własny rekord (endpoint nie przyjmuje identyfikatora), organizacja B nie widzi ani nie zmienia danych organizacji A.
describe('Preferencje użytkownika: lektor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domain = 'prefs-e2e-test.test';
  const emailA = `admin-a-${suffix}@org-a.${domain}`;
  const emailB = `admin-b-${suffix}@org-b.${domain}`;
  const emailPending = `admin-p-${suffix}@org-p.${domain}`;

  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let secondUserAId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenPending: string;

  const get = (token: string) => request(app.getHttpServer()).get('/users/me/preferences').set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: unknown) =>
    request(app.getHttpServer()).patch('/users/me/preferences').set('Authorization', `Bearer ${token}`).send(body as object);

  const narrationOf = (orgId: string, userId: string) =>
    tenantPrisma.runInOrgContext(orgId, (tx) =>
      tx.user.findFirstOrThrow({ where: { id: userId, organizationId: orgId }, select: { narrationEnabled: true } }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
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
    orgBId = adminB.organizationId;
    userAId = adminA.id;
    userBId = adminB.id;

    // Drugi użytkownik w TEJ SAMEJ organizacji A: jego preferencja nie może się zmienić przy zmianie przez admina A.
    const second = await tenantPrisma.runInOrgContext(orgAId, (tx) =>
      tx.user.create({
        data: { organizationId: orgAId, email: `second-${suffix}@org-a.${domain}`, passwordHash: 'x', role: 'EMPLOYEE', status: 'ACTIVE' },
      }),
    );
    secondUserAId = second.id;
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: domain } } });
    await app.close();
  });

  it('domyślnie lektor jest włączony (nowe konto i istniejący użytkownik bez wcześniejszej zmiany)', async () => {
    expect((await get(tokenA).expect(200)).body).toEqual({ narrationEnabled: true });
    expect((await get(tokenB).expect(200)).body).toEqual({ narrationEnabled: true });
  });

  it('PATCH zapisuje od razu, GET zwraca nową wartość, a zmiana jest odwracalna', async () => {
    expect((await patch(tokenA, { narrationEnabled: false }).expect(200)).body).toEqual({ narrationEnabled: false });
    expect((await get(tokenA).expect(200)).body).toEqual({ narrationEnabled: false });
    expect((await narrationOf(orgAId, userAId)).narrationEnabled).toBe(false);

    expect((await patch(tokenA, { narrationEnabled: true }).expect(200)).body).toEqual({ narrationEnabled: true });
    expect((await get(tokenA).expect(200)).body).toEqual({ narrationEnabled: true });
  });

  it('izolacja: zmiana przez użytkownika A nie rusza innego użytkownika tej samej organizacji ani organizacji B', async () => {
    await patch(tokenA, { narrationEnabled: false }).expect(200);

    expect((await get(tokenB).expect(200)).body).toEqual({ narrationEnabled: true });
    expect((await narrationOf(orgBId, userBId)).narrationEnabled).toBe(true);
    expect((await narrationOf(orgAId, secondUserAId)).narrationEnabled).toBe(true);

    // I odwrotnie: zmiana przez B nie rusza A.
    await patch(tokenB, { narrationEnabled: false }).expect(200);
    expect((await narrationOf(orgAId, userAId)).narrationEnabled).toBe(false);
    expect((await narrationOf(orgBId, userBId)).narrationEnabled).toBe(false);
    await patch(tokenA, { narrationEnabled: true }).expect(200);
    expect((await narrationOf(orgBId, userBId)).narrationEnabled).toBe(false);
    await patch(tokenB, { narrationEnabled: true }).expect(200);
  });

  it('nie da się wskazać innego użytkownika ani zmienić innych pól (whitelist + forbidNonWhitelisted): 400', async () => {
    for (const body of [
      { narrationEnabled: false, userId: userBId },
      { narrationEnabled: false, id: userBId },
      { narrationEnabled: false, organizationId: orgBId },
      { narrationEnabled: false, role: 'SUPER_ADMIN' },
      { narrationEnabled: false, avatarUrl: 'fox' },
    ]) {
      await patch(tokenA, body).expect(400);
    }
    // Żadna z odrzuconych prób nie zmieniła danych.
    expect((await narrationOf(orgAId, userAId)).narrationEnabled).toBe(true);
    expect((await narrationOf(orgBId, userBId)).narrationEnabled).toBe(true);
  });

  it.each([{}, { narrationEnabled: 'false' }, { narrationEnabled: 0 }, { narrationEnabled: null }, { narrationEnabled: [] }, { narrationEnabled: { a: 1 } }])(
    'odrzuca niepoprawne ciało %j: 400',
    async (body) => {
      await patch(tokenA, body).expect(400);
    },
  );

  it('wymaga zalogowania: 401 bez tokena i z nieprawidłowym tokenem', async () => {
    await request(app.getHttpServer()).get('/users/me/preferences').expect(401);
    await request(app.getHttpServer()).patch('/users/me/preferences').send({ narrationEnabled: false }).expect(401);
    await get('nieprawidlowy.token.jwt').expect(401);
  });

  it('organizacja czekająca na weryfikację domeny (PENDING) jest zablokowana (guard fail-closed)', async () => {
    for (const response of [await get(tokenPending), await patch(tokenPending, { narrationEnabled: false })]) {
      expect([response.status, response.body.code]).toEqual([403, 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION']);
    }
    // Odrzucone żądanie nie zmieniło danych.
    const pendingUser = (await tenantPrisma.runAuthLookup({ email: emailPending }))!;
    expect((await narrationOf(pendingUser.organizationId, pendingUser.id)).narrationEnabled).toBe(true);
  });
});
