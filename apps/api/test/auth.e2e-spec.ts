import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth + izolacja tenantów (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
  });

  afterAll(async () => {
    // Porządek po sobie — usuwamy tylko dane utworzone w tym pliku testowym.
    await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e-test.local' } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: 'E2E Org ' } } });
    await app.close();
  });

  const uniqueSuffix = Date.now();

  it('rejestruje nową organizację razem z pierwszym użytkownikiem jako ORG_ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org A ${uniqueSuffix}`,
        email: `admin-a-${uniqueSuffix}@e2e-test.local`,
        password: 'SuperSecret123!',
      })
      .expect(201);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('loguje zarejestrowanego użytkownika i zwraca parę tokenów', async () => {
    const email = `login-${uniqueSuffix}@e2e-test.local`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org Login ${uniqueSuffix}`,
        email,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'SuperSecret123!' })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('odrzuca logowanie z błędnym hasłem', async () => {
    const email = `wrongpass-${uniqueSuffix}@e2e-test.local`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org WrongPass ${uniqueSuffix}`,
        email,
        password: 'SuperSecret123!',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'ZlePodaneHaslo' })
      .expect(401);
  });

  it('nie pozwala użytkownikowi organizacji A pobrać listy użytkowników organizacji B', async () => {
    const orgAEmail = `org-a-${uniqueSuffix}@e2e-test.local`;
    const orgBEmail = `org-b-${uniqueSuffix}@e2e-test.local`;

    const orgAResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org A Isolation ${uniqueSuffix}`,
        email: orgAEmail,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const orgBResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org B Isolation ${uniqueSuffix}`,
        email: orgBEmail,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const orgAToken = orgAResponse.body.accessToken;
    const orgBToken = orgBResponse.body.accessToken;

    const orgAUsersResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);

    const orgBUsersResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${orgBToken}`)
      .expect(200);

    const orgAEmails = orgAUsersResponse.body.map((u: { email: string }) => u.email);
    const orgBEmails = orgBUsersResponse.body.map((u: { email: string }) => u.email);

    // Organizacja A widzi tylko swojego admina, nigdy admina organizacji B.
    expect(orgAEmails).toContain(orgAEmail);
    expect(orgAEmails).not.toContain(orgBEmail);

    // I symetrycznie w drugą stronę.
    expect(orgBEmails).toContain(orgBEmail);
    expect(orgBEmails).not.toContain(orgAEmail);
  });

  it('odrzuca dostęp do /users bez tokena', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('nie ujawnia w komunikacie błędu rejestracji, czy e-mail już istnieje w systemie', async () => {
    const email = `duplicate-${uniqueSuffix}@e2e-test.local`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org Duplicate ${uniqueSuffix}`,
        email,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        organizationName: `E2E Org Duplicate Retry ${uniqueSuffix}`,
        email,
        password: 'SuperSecret123!',
      })
      .expect(400);

    // Komunikat musi być identyczny jak dla każdego innego błędu rejestracji —
    // w szczególności nie może potwierdzać, że e-mail jest już zajęty.
    expect(response.body.message).not.toMatch(/istnieje/i);
  });

  it('ogranicza liczbę prób logowania w krótkim czasie (rate limiting)', async () => {
    // Osobna instancja aplikacji (świeży, izolowany magazyn throttlera), żeby
    // ten test nie zależał od tego, ile żądań do /auth/login wysłały testy
    // powyżej w tym samym pliku — inaczej dokładna liczba byłaby krucha.
    const throttleModuleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const throttleApp = throttleModuleRef.createNestApplication();
    throttleApp.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await throttleApp.init();

    try {
      const LOGIN_THROTTLE_LIMIT = 10;
      const totalRequests = LOGIN_THROTTLE_LIMIT + 2;
      const statuses: number[] = [];

      // Sekwencyjnie, nie równolegle — żeby liczba żądań, które zdążyły się
      // policzyć przed odrzuceniem, była deterministyczna.
      for (let i = 0; i < totalRequests; i += 1) {
        const response = await request(throttleApp.getHttpServer())
          .post('/auth/login')
          .send({ email: `throttle-isolated-${uniqueSuffix}@e2e-test.local`, password: 'cokolwiek' });
        statuses.push(response.status);
      }

      const unauthorizedCount = statuses.filter((status) => status === 401).length;
      const tooManyRequestsCount = statuses.filter((status) => status === 429).length;

      expect(unauthorizedCount).toBe(LOGIN_THROTTLE_LIMIT);
      expect(tooManyRequestsCount).toBe(totalRequests - LOGIN_THROTTLE_LIMIT);
    } finally {
      await throttleApp.close();
    }
  });
});
