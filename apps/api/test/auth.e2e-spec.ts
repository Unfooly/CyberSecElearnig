import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { EmailService } from '../src/email/email.service';
import { registerVerified } from './helpers/auth';

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
    // Wszystkie domeny e-maili w tym pliku kończą się na auth-e2e-test.local
    // (każdy scenariusz rejestracji ma WŁASNĄ subdomenę, np.
    // admin-a.auth-e2e-test.local, bo organizations.name jest teraz unikalne
    // - nazwa organizacji = domena), więc `endsWith` obejmuje je wszystkie i
    // nie koliduje z organizacjami tworzonymi równolegle przez inne pliki
    // *.e2e-spec.ts (Jest domyślnie uruchamia je równolegle).
    await prisma.passwordResetToken.deleteMany({ where: { user: { email: { endsWith: 'auth-e2e-test.local' } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: 'auth-e2e-test.local' } } });
    await prisma.organization.deleteMany({ where: { name: { endsWith: 'auth-e2e-test.local' } } });
    await app.close();
  });

  const uniqueSuffix = Date.now();

  it('rejestruje nową organizację razem z pierwszym użytkownikiem jako ORG_ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `admin-a-${uniqueSuffix}@admin-a.auth-e2e-test.local`,
        password: 'SuperSecret123!',
      })
      .expect(201);

    // Bez tokenów - logowanie zablokowane do potwierdzenia adresu e-mail.
    expect(response.body.accessToken).toBeUndefined();
    expect(response.body.message).toMatch(/link weryfikacyjny/i);
  });

  it('odrzuca logowanie z błędnym hasłem', async () => {
    const email = `wrongpass-${uniqueSuffix}@wrongpass.auth-e2e-test.local`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
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
    const orgAEmail = `org-a-${uniqueSuffix}@org-a.auth-e2e-test.local`;
    const orgBEmail = `org-b-${uniqueSuffix}@org-b.auth-e2e-test.local`;

    const orgAResponse = await registerVerified(app, tenantPrisma, {
        email: orgAEmail,
        password: 'SuperSecret123!',
      });

    const orgBResponse = await registerVerified(app, tenantPrisma, {
        email: orgBEmail,
        password: 'SuperSecret123!',
      });

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

    // GET /users zwraca { items, total, page, pageSize } (paginacja), nie
    // gołą tablicę - patrz UsersController.findAll / users.e2e-spec.ts.
    const orgAEmails = orgAUsersResponse.body.items.map((u: { email: string }) => u.email);
    const orgBEmails = orgBUsersResponse.body.items.map((u: { email: string }) => u.email);

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

  it('odrzuca powtórną rejestrację tego samego e-maila (ta sama domena = kolizja organizacji, nie tylko e-maila)', async () => {
    const email = `duplicate-${uniqueSuffix}@duplicate.auth-e2e-test.local`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'SuperSecret123!',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'SuperSecret123!',
      })
      .expect(400);

    // Ta sama domena co za pierwszym razem -> organization.create (uruchamiany
    // PRZED user.create w tej samej transakcji) odrzuca insert na unikalności
    // nazwy organizacji, zanim w ogóle dojdzie do sprawdzenia unikalności
    // e-maila - patrz test niżej ("odrzuca rejestrację drugiej organizacji...")
    // dla tego samego zachowania z DWOMA różnymi e-mailami tej samej domeny.
    expect(response.body.message).toMatch(/organizacja/i);
  });

  it('odrzuca rejestrację drugiej organizacji dla domeny, która już ma organizację', async () => {
    const firstEmail = `domain-owner-${uniqueSuffix}@dup-domain.auth-e2e-test.local`;
    const secondEmail = `domain-newcomer-${uniqueSuffix}@dup-domain.auth-e2e-test.local`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: firstEmail, password: 'SuperSecret123!' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: secondEmail, password: 'SuperSecret123!' })
      .expect(400);

    // Tu, w odróżnieniu od duplikatu e-maila powyżej, komunikat CELOWO
    // ujawnia że organizacja dla tej domeny istnieje - to informacja na
    // poziomie firmy, nie konkretnego konta (patrz komentarz przy
    // ORGANIZATION_ALREADY_EXISTS_MESSAGE w auth.service.ts).
    expect(response.body.message).toMatch(/organizacja/i);

    // Drugi e-mail nie mógł się zalogować - insert usera i organizacji jest
    // w jednej transakcji (runInOrgContext), więc odrzucenie organizacji
    // musiało cofnąć też usera.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: secondEmail, password: 'SuperSecret123!' })
      .expect(401);

    // Pierwsze konto/organizacja nie zostały naruszone przez odrzuconą
    // drugą próbę.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: firstEmail, password: 'SuperSecret123!' })
      .expect(403); // konto istnieje i hasło poprawne, ale adres niepotwierdzony
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
          .send({ email: `throttle-isolated-${uniqueSuffix}@auth-e2e-test.local`, password: 'cokolwiek' });
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

  describe('Weryfikacja adresu e-mail', () => {
    // Własna instancja aplikacji (świeży throttler) - te testy rejestrują
    // kilka kont, co razem z resztą pliku przekroczyłoby limit
    // AUTH_THROTTLE na /auth/register (10/60s) współdzielony z `app`.
    let verifyApp: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      verifyApp = moduleRef.createNestApplication();
      verifyApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await verifyApp.init();
    });

    afterAll(async () => {
      await verifyApp.close();
    });

    it('pełny flow weryfikacji: rejestracja -> logowanie zablokowane -> link z maila -> logowanie działa', async () => {
      const email = `login-${uniqueSuffix}@login.auth-e2e-test.local`;
      const emailService = verifyApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);

      await request(verifyApp.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'SuperSecret123!' })
        .expect(201);

      const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
      sendSpy.mockRestore();
      expect(call.templateName).toBe('email-verification');
      const token = new URL((call.templateData as { verificationUrl: string }).verificationUrl).searchParams.get('token');

      // Przed potwierdzeniem: poprawne hasło, ale 403 EMAIL_NOT_VERIFIED.
      const blocked = await request(verifyApp.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'SuperSecret123!' })
        .expect(403);
      expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

      await request(verifyApp.getHttpServer()).post('/auth/verify-email').send({ token }).expect(200);

      // Ten sam link nie zadziała drugi raz.
      const reuse = await request(verifyApp.getHttpServer()).post('/auth/verify-email').send({ token }).expect(400);
      expect(reuse.body.code).toBe('TOKEN_ALREADY_USED');

      const response = await request(verifyApp.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'SuperSecret123!' })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
    });

    it('izolacja tenantów: token weryfikacyjny org A potwierdza wyłącznie konto org A, nie org B', async () => {
      const emailA = `verify-a-${uniqueSuffix}@verify-a.auth-e2e-test.local`;
      const emailB = `verify-b-${uniqueSuffix}@verify-b.auth-e2e-test.local`;
      const emailService = verifyApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);

      await request(verifyApp.getHttpServer()).post('/auth/register').send({ email: emailA, password: 'SuperSecret123!' }).expect(201);
      const tokenA = new URL(
        (sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0].templateData as { verificationUrl: string }).verificationUrl,
      ).searchParams.get('token');
      await request(verifyApp.getHttpServer()).post('/auth/register').send({ email: emailB, password: 'SuperSecret123!' }).expect(201);
      sendSpy.mockRestore();

      await request(verifyApp.getHttpServer()).post('/auth/verify-email').send({ token: tokenA }).expect(200);

      const userA = await tenantPrisma.runAuthLookup({ email: emailA });
      const userB = await tenantPrisma.runAuthLookup({ email: emailB });
      expect(userA!.emailVerifiedAt).not.toBeNull();
      expect(userB!.emailVerifiedAt).toBeNull();
    });

    async function registerAndCaptureToken(email: string): Promise<string> {
      const emailService = verifyApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);
      await request(verifyApp.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'SuperSecret123!' })
        .expect(201);
      const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
      sendSpy.mockRestore();
      return new URL((call.templateData as { verificationUrl: string }).verificationUrl).searchParams.get(
        'token',
      ) as string;
    }

    it('wygasły token weryfikacyjny jest odrzucany (TOKEN_INVALID_OR_EXPIRED), konto zostaje niepotwierdzone', async () => {
      const email = `expired-${uniqueSuffix}@expired.auth-e2e-test.local`;
      const token = await registerAndCaptureToken(email);

      const user = await tenantPrisma.runAuthLookup({ email });
      await tenantPrisma.runInOrgContext(user!.organizationId, (tx) =>
        tx.emailVerificationToken.updateMany({
          where: { userId: user!.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const response = await request(verifyApp.getHttpServer())
        .post('/auth/verify-email')
        .send({ token })
        .expect(400);
      expect(response.body.code).toBe('TOKEN_INVALID_OR_EXPIRED');
      expect((await tenantPrisma.runAuthLookup({ email }))!.emailVerifiedAt).toBeNull();
    });

    it('niepotwierdzone konto ze ZŁYM hasłem dostaje zwykłe 401 (nie ujawnia, że konto czeka na weryfikację)', async () => {
      const email = `wrongpw-${uniqueSuffix}@wrongpw.auth-e2e-test.local`;
      await registerAndCaptureToken(email);

      await request(verifyApp.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'ZleHaslo12345' })
        .expect(401);
    });

    it('resend-verification dla ZAPROSZONEGO odnawia link aktywacyjny (nie zostawia go w pętli EMAIL_NOT_VERIFIED)', async () => {
      const email = `invited-${uniqueSuffix}@invited.auth-e2e-test.local`;
      const registered = await registerVerified(verifyApp, tenantPrisma, {
        email: `admin-${uniqueSuffix}@invited.auth-e2e-test.local`,
        password: 'SuperSecret123!',
      });
      await request(verifyApp.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${registered.body.accessToken}`)
        .send({ email, firstName: 'Ola', lastName: 'Nowak', role: 'EMPLOYEE' })
        .expect(201);

      const emailService = verifyApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);
      await request(verifyApp.getHttpServer()).post('/auth/resend-verification').send({ email }).expect(200);
      const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
      sendSpy.mockRestore();

      expect(call.templateName).toBe('user-invite');
      expect((call.templateData as { activationUrl: string }).activationUrl).toContain('/reset-password?token=');
    });

    it('resend-verification: ta sama odpowiedź dla istniejącego i nieistniejącego adresu', async () => {
      const existing = await request(verifyApp.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: `login-${uniqueSuffix}@login.auth-e2e-test.local` })
        .expect(200);
      const missing = await request(verifyApp.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: `nie-ma-${uniqueSuffix}@nie-ma.auth-e2e-test.local` })
        .expect(200);

      expect(existing.body).toEqual(missing.body);
    });

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

    async function registerUser(email: string, password = 'StareHaslo123'): Promise<void> {
      await request(resetApp.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
    }

    // EmailService realnie nie wysyła (brak MAILERSEND_API_TOKEN w .env.test) —
    // podglądamy jego wywołanie, żeby wyłuskać surowy token z resetUrl,
    // dokładnie tak jak zrobiłby to link w prawdziwym mailu.
    async function requestResetAndExtractToken(email: string): Promise<string> {
      const { EmailService } = await import('../src/email/email.service');
      const emailService = resetApp.get(EmailService);
      const sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(true);

      await request(resetApp.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(200);

      const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
      const resetUrl = (call.templateData as { resetUrl: string }).resetUrl;
      sendSpy.mockRestore();

      const token = new URL(resetUrl).searchParams.get('token');
      expect(token).toEqual(expect.any(String));
      return token as string;
    }

    it('happy path: forgot-password -> reset-password -> logowanie działa nowym hasłem, nie starym', async () => {
      const email = `reset-happy-${uniqueSuffix}@reset-happy.auth-e2e-test.local`;
      await registerUser(email);

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
      const email = `reset-reuse-${uniqueSuffix}@reset-reuse.auth-e2e-test.local`;
      await registerUser(email);
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
      const email = `reset-expired-${uniqueSuffix}@reset-expired.auth-e2e-test.local`;
      await registerUser(email);
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
      const existingEmail = `reset-exists-${uniqueSuffix}@reset-exists.auth-e2e-test.local`;
      await registerUser(existingEmail);

      const forExisting = await request(resetApp.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: existingEmail })
        .expect(200);

      const forMissing = await request(resetApp.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `nie-istnieje-${uniqueSuffix}@auth-e2e-test.local` })
        .expect(200);

      expect(forExisting.body).toEqual(forMissing.body);
    });

    it('izolacja tenantów: reset hasła w organizacji A nie zużywa tokenu ani nie zmienia hasła w organizacji B', async () => {
      const emailA = `reset-isolation-a-${uniqueSuffix}@reset-isolation-a.auth-e2e-test.local`;
      const emailB = `reset-isolation-b-${uniqueSuffix}@reset-isolation-b.auth-e2e-test.local`;
      await registerUser(emailA);
      await registerUser(emailB, 'HasloOrgB123');

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
            .send({ email: `throttle-forgot-${uniqueSuffix}@auth-e2e-test.local` });
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
