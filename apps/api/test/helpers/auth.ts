import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

/**
 * /auth/register nie zwraca już tokenów (logowanie jest zablokowane do
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
  await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);

  const user = await tenantPrisma.runAuthLookup({ email: credentials.email });
  await tenantPrisma.runInOrgContext(user!.organizationId, (tx) =>
    tx.user.update({ where: { id: user!.id }, data: { emailVerifiedAt: new Date() } }),
  );

  const login = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(200);
  return { body: login.body };
}
