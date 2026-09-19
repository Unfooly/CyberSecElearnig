import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RegistrationService } from '../../src/auth/registration.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

export const DEFAULT_TEST_PASSWORD = 'SuperSecret123!';

/**
 * Kompletny, poprawny ładunek rejestracji firmy (samoobsługowej). Testy, które
 * interesuje tylko e-mail i hasło, podają je; resztę pól uzupełniamy poprawnymi
 * danymi (NIP 5260250274 ma poprawną sumę kontrolną). `overrides` nadpisuje
 * dowolne pole - także po to, by wysłać celowo błędne dane.
 */
export function registrationPayload(
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
  overrides: Record<string, unknown> = {},
) {
  return {
    firstName: 'Anna',
    lastName: 'Testowa',
    email,
    password,
    organizationLegalName: 'Firma Testowa Sp. z o.o.',
    // Domyślnie domena e-maila: testy sprzątają organizacje po sufiksie nazwy
    // (deleteMany name endsWith ...). Produkcyjnie nazwa NIE pochodzi z domeny.
    organizationName: email.split('@')[1] ?? 'Firma Testowa',
    taxId: '5260250274',
    addressLine: 'ul. Testowa 1',
    postalCode: '00-001',
    city: 'Warszawa',
    acceptTerms: true,
    acceptPrivacyPolicy: true,
    ...overrides,
  };
}

/**
 * POST /auth/register i - po odpowiedzi - poczekanie na wysyłki maili, które
 * serwis robi w tle (czas odpowiedzi nie zależy od maila). Bez tego testy
 * przechwytujące mail (spy na EmailService) widziałyby go za późno.
 */
export async function postRegister(
  app: INestApplication,
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send(registrationPayload(email, password, overrides));
  await app.get(RegistrationService).flushBackgroundTasks();
  return response;
}

/**
 * /auth/register nie zwraca tokenów (logowanie jest zablokowane do
 * potwierdzenia adresu e-mail). Ten helper przechodzi całą ścieżkę
 * rejestracja -> potwierdzenie -> logowanie, ale potwierdzenie robi wprost w
 * bazie (przez runInOrgContext, jak reszta aplikacji), żeby testy izolacji/
 * kursów/dashboardu nie zależały od przechwytywania maila. Prawdziwy flow z
 * tokenem z maila jest testowany osobno w auth.e2e-spec.ts.
 */
export async function registerVerified(
  app: INestApplication,
  tenantPrisma: TenantPrismaService,
  credentials: { email: string; password: string },
): Promise<{ body: { accessToken: string; refreshToken: string } }> {
  const registered = await postRegister(app, credentials.email, credentials.password);
  if (registered.status !== 201) {
    throw new Error(`Rejestracja testowa nie powiodła się (${registered.status}): ${JSON.stringify(registered.body)}`);
  }

  const user = await tenantPrisma.runAuthLookup({ email: credentials.email });
  await tenantPrisma.runInOrgContext(user!.organizationId, (tx) =>
    tx.user.update({ where: { id: user!.id }, data: { emailVerifiedAt: new Date() } }),
  );

  const login = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(200);
  return { body: login.body };
}
