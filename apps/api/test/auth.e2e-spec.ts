import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

describe('Auth + izolacja tenantów (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

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
  });

  afterAll(async () => {
    // Porządek po sobie — usuwamy tylko dane utworzone w tym pliku testowym.
    await prisma.passwordResetToken.deleteMany({ where: { user: { email: { endsWith: '@e2e-test.local' } } } });
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

  describe('Reset hasła', () => {
    // Własna instancja aplikacji (świeży throttler), niezależna od `app`
    // powyżej — testy w tym bloku rejestrują kilkanaście kont, co samo w
    // sobie przekroczyłoby wspólny z resztą pliku limit AUTH_THROTTLE na
    // /auth/register (10/60s), gdyby dzieliły magazyn throttlera z `app`.
    let resetApp: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      resetApp = moduleRef.createNestApplication();
      resetApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await resetApp.init();
    });

    afterAll(async () => {
      await resetApp.close();
    });

    async function registerUser(orgLabel: string, email: string, password = 'StareHaslo123'): Promise<void> {
      await request(resetApp.getHttpServer())
        .post('/auth/register')
        .send({ organizationName: `E2E Org ${orgLabel} ${uniqueSuffix}`, email, password })
        .expect(201);
    }

    // EmailService realnie nie wysyła (brak POSTMARK_API_TOKEN w .env.test) —
    // podglądamy jego wywołanie, żeby wyłuskać surowy token z resetUrl,
    // dokładnie tak jak zrobiłby to link w prawdziwym mailu.
    async function requestResetAndExtractToken(email: string): Promise<string> {
      const { EmailService } = await import('../src/email/email.service');
      const emailService = resetApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);

      await request(resetApp.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(200);

      const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
      const resetUrl = (call.templateData as { resetUrl: string }).resetUrl;
      sendSpy.mockRestore();

      const token = new URL(resetUrl).searchParams.get('token');
      expect(token).toEqual(expect.any(String));
      return token as string;
    }

    it('happy path: forgot-password -> reset-password -> logowanie działa nowym hasłem, nie starym', async () => {
      const email = `reset-happy-${uniqueSuffix}@e2e-test.local`;
      await registerUser('ResetHappy', email);

      const token = await requestResetAndExtractToken(email);

      await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'NoweHaslo456' })
        .expect(200);

      await request(resetApp.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'NoweHaslo456' })
        .expect(200);

      await request(resetApp.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'StareHaslo123' })
        .expect(401);
    });

    it('drugie użycie tego samego tokenu nie powodzi się z odrębnym komunikatem "już użyty"', async () => {
      const email = `reset-reuse-${uniqueSuffix}@e2e-test.local`;
      await registerUser('ResetReuse', email);
      const token = await requestResetAndExtractToken(email);

      await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'NoweHaslo456' })
        .expect(200);

      const secondAttempt = await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'JeszczeInne789' })
        .expect(400);

      expect(secondAttempt.body.code).toBe('TOKEN_ALREADY_USED');
      expect(secondAttempt.body.message).toMatch(/już został wykorzystany|już został użyty|już wykorzystany/i);
    });

    it('wygasły token jest odrzucany z tym samym kodem co token nieistniejący (bez rozróżnienia)', async () => {
      const email = `reset-expired-${uniqueSuffix}@e2e-test.local`;
      await registerUser('ResetExpired', email);
      const token = await requestResetAndExtractToken(email);

      // Cofamy expiresAt bezpośrednio w bazie - jedyny sposób na
      // deterministyczny test wygaśnięcia bez czekania godzinę. Surowy
      // PrismaService łączy się rolą cyberszkolo_app (fail-closed RLS bez
      // kontekstu - patrz prisma.service.ts), więc zapis MUSI iść przez
      // tenantPrisma.runInOrgContext, tak jak w reszcie aplikacji, inaczej
      // zaktualizowałby zero wierszy.
      const user = await tenantPrisma.runAuthLookup({ email });
      await tenantPrisma.runInOrgContext(user!.organizationId, (tx) =>
        tx.passwordResetToken.updateMany({
          where: { userId: user!.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const expiredAttempt = await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'NoweHaslo456' })
        .expect(400);
      expect(expiredAttempt.body.code).toBe('TOKEN_INVALID_OR_EXPIRED');

      const nonexistentAttempt = await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'zupelnie-nieistniejacy-token', newPassword: 'NoweHaslo456' })
        .expect(400);
      expect(nonexistentAttempt.body.code).toBe('TOKEN_INVALID_OR_EXPIRED');
      expect(nonexistentAttempt.body.message).toBe(expiredAttempt.body.message);
    });

    it('odpowiedź /auth/forgot-password jest identyczna dla istniejącego i nieistniejącego e-maila', async () => {
      const existingEmail = `reset-exists-${uniqueSuffix}@e2e-test.local`;
      await registerUser('ResetExists', existingEmail);

      const forExisting = await request(resetApp.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: existingEmail })
        .expect(200);

      const forMissing = await request(resetApp.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `nie-istnieje-${uniqueSuffix}@e2e-test.local` })
        .expect(200);

      expect(forExisting.body).toEqual(forMissing.body);
    });

    it('izolacja tenantów: reset hasła w organizacji A nie zużywa tokenu ani nie zmienia hasła w organizacji B', async () => {
      const emailA = `reset-isolation-a-${uniqueSuffix}@e2e-test.local`;
      const emailB = `reset-isolation-b-${uniqueSuffix}@e2e-test.local`;
      await registerUser('ResetIsolationA', emailA);
      await registerUser('ResetIsolationB', emailB, 'HasloOrgB123');

      // Obie organizacje proszą o reset niezależnie - każda ma własny,
      // aktywny (nieużyty) token w tym samym momencie.
      const tokenA = await requestResetAndExtractToken(emailA);
      const tokenB = await requestResetAndExtractToken(emailB);

      await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: tokenA, newPassword: 'NoweHasloOrgA456' })
        .expect(200);

      // Reset org A nie mógł zużyć/unieważnić tokenu org B - token B nadal
      // działa i loguje na nowe hasło org B, nie na hasło org A.
      await request(resetApp.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: tokenB, newPassword: 'NoweHasloOrgB456' })
        .expect(200);

      await request(resetApp.getHttpServer())
        .post('/auth/login')
        .send({ email: emailB, password: 'NoweHasloOrgB456' })
        .expect(200);

      // I hasło org A nie przecieka do org B.
      await request(resetApp.getHttpServer())
        .post('/auth/login')
        .send({ email: emailB, password: 'NoweHasloOrgA456' })
        .expect(401);
    });

    it('ogranicza liczbę prób /auth/forgot-password w krótkim czasie (rate limiting)', async () => {
      const throttleModuleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const throttleApp = throttleModuleRef.createNestApplication();
      throttleApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await throttleApp.init();

      try {
        const THROTTLE_LIMIT = 10;
        const totalRequests = THROTTLE_LIMIT + 2;
        const statuses: number[] = [];

        for (let i = 0; i < totalRequests; i += 1) {
          const response = await request(throttleApp.getHttpServer())
            .post('/auth/forgot-password')
            .send({ email: `throttle-forgot-${uniqueSuffix}@e2e-test.local` });
          statuses.push(response.status);
        }

        const okCount = statuses.filter((status) => status === 200).length;
        const tooManyRequestsCount = statuses.filter((status) => status === 429).length;

        expect(okCount).toBe(THROTTLE_LIMIT);
        expect(tooManyRequestsCount).toBe(totalRequests - THROTTLE_LIMIT);
      } finally {
        await throttleApp.close();
      }
    });
  });
});
