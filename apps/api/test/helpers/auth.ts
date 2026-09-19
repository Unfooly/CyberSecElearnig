import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { RegistrationService } from '../../src/auth/registration.service';
import { EmailService } from '../../src/email/email.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

export const DEFAULT_TEST_PASSWORD = 'SuperSecret123!';

/**
 * Kompletny, poprawny ładunek rejestracji firmy (samoobsługowej) - BEZ hasła
 * (hasło ustawia się dopiero linkiem z maila). Testy, które interesuje tylko
 * e-mail, podają go; resztę pól uzupełniamy poprawnymi danymi (NIP 5260250274
 * ma poprawną sumę kontrolną). `overrides` nadpisuje dowolne pole - także po
 * to, by wysłać celowo błędne dane.
 */
export function registrationPayload(email: string, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Anna',
    lastName: 'Testowa',
    email,
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
 * POST /auth/register i - po odpowiedzi - poczekanie na pracę, którą serwis
 * robi w tle (zapis i maile; czas odpowiedzi nie zależy od stanu konta). Bez
 * tego testy czytające bazę albo przechwytujące mail (spy na EmailService)
 * widziałyby wynik za wcześnie.
 */
export async function postRegister(
  app: INestApplication,
  email: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  const response = await request(app.getHttpServer()).post('/auth/register').send(registrationPayload(email, overrides));
  await app.get(RegistrationService).flushBackgroundTasks();
  return response;
}

/**
 * Rejestracja + "kliknięcie linku z maila" zrobione wprost w bazie: ustawia
 * hasło, aktywuje konto (INVITED -> ACTIVE) i potwierdza e-mail - tak jak
 * robi to POST /auth/reset-password. Testy izolacji/kursów/dashboardu nie
 * zależą dzięki temu od przechwytywania maila; prawdziwy flow z tokenem z
 * maila jest w registration.e2e-spec.ts.
 *
 * `activateOrganization` (domyślnie true) ustawia też organizację na ACTIVE
 * BEZ dotykania OrganizationDomain (verifiedAt ustawia wyłącznie serwis DNS):
 * bez tego globalny guard zablokowałby każdy endpoint biznesowy. Testy samego
 * stanu PENDING podają false.
 */
export async function createVerifiedUser(
  app: INestApplication,
  tenantPrisma: TenantPrismaService,
  credentials: { email: string; password: string },
  options: { activateOrganization?: boolean } = {},
): Promise<{ organizationId: string; userId: string }> {
  const registered = await postRegister(app, credentials.email);
  if (registered.status !== 201) {
    throw new Error(`Rejestracja testowa nie powiodła się (${registered.status}): ${JSON.stringify(registered.body)}`);
  }

  const user = await tenantPrisma.runAuthLookup({ email: credentials.email });
  if (!user) {
    throw new Error(`Rejestracja testowa nie utworzyła konta ${credentials.email}`);
  }
  const passwordHash = await bcrypt.hash(credentials.password, 4);
  await tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() } }),
  );
  if (options.activateOrganization !== false) {
    await app.get(PrismaService).organization.update({ where: { id: user.organizationId }, data: { status: 'ACTIVE' } });
  }
  return { organizationId: user.organizationId, userId: user.id };
}

/** createVerifiedUser + logowanie (zwraca tokeny). */
export async function registerVerified(
  app: INestApplication,
  tenantPrisma: TenantPrismaService,
  credentials: { email: string; password: string },
  options: { activateOrganization?: boolean } = {},
): Promise<{ body: { accessToken: string; refreshToken: string } }> {
  await createVerifiedUser(app, tenantPrisma, credentials, options);
  const login = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(200);
  return { body: login.body };
}

/**
 * Konto "starego typu": ACTIVE, z hasłem, ale NIEPOTWIERDZONE (tak powstawało
 * przed zmianą rejestracji). Endpoint /auth/verify-email nadal je obsługuje.
 * Organizacja ACTIVE, żeby guard nie przeszkadzał.
 */
export async function createLegacyUnverifiedUser(
  app: INestApplication,
  tenantPrisma: TenantPrismaService,
  credentials: { email: string; password: string },
): Promise<{ organizationId: string; userId: string }> {
  const prisma = app.get(PrismaService);
  const organization = await prisma.organization.create({
    data: { name: credentials.email.split('@')[1], status: 'ACTIVE' },
  });
  const passwordHash = await bcrypt.hash(credentials.password, 4);
  const user = await tenantPrisma.runInOrgContext(organization.id, (tx) =>
    tx.user.create({
      data: { organizationId: organization.id, email: credentials.email, passwordHash, role: 'ORG_ADMIN', status: 'ACTIVE' },
    }),
  );
  return { organizationId: organization.id, userId: user.id };
}

/** Wysyła link weryfikacyjny (stary flow) i zwraca surowy token z przechwyconego maila. */
export async function issueVerificationToken(
  app: INestApplication,
  user: { organizationId: string; userId: string; email: string },
): Promise<string> {
  const sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  try {
    await app.get(AuthService).sendVerificationEmail(user.organizationId, user.userId, user.email);
    const call = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0];
    return new URL((call.templateData as { verificationUrl: string }).verificationUrl).searchParams.get('token') as string;
  } finally {
    sendSpy.mockRestore();
  }
}
