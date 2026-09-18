import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Seed WYŁĄCZNIE do lokalnego dev/testów ręcznych: po jednym użytkowniku na
// każdą rolę, w organizacji istniejącego konta admin@demo.test. Idempotentny
// (upsert po e-mailu). Hasło wspólne dla kont demo - patrz README.
//
// Łączy się rolą z DATABASE_URL (superuser, jak seed-badges.ts), więc RLS go
// nie ogranicza - dlatego organizationId jest ustawiane jawnie i skrypt
// odmawia działania na produkcji.
const DEMO_PASSWORD = 'Demo12345!x';
const DEMO_ORG_ADMIN_EMAIL = 'admin@demo.test';

const ROLE_USERS: { email: string; role: Role; firstName: string; lastName: string }[] = [
  { email: 'super-admin@demo.test', role: Role.SUPER_ADMIN, firstName: 'Sara', lastName: 'Super' },
  { email: 'manager@demo.test', role: Role.DEPARTMENT_MANAGER, firstName: 'Marek', lastName: 'Menedżer' },
  { email: 'employee@demo.test', role: Role.EMPLOYEE, firstName: 'Ewa', lastName: 'Pracownik' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev-roles nie może być uruchamiany na produkcji.');
  }
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findUnique({ where: { email: DEMO_ORG_ADMIN_EMAIL } });
    if (!admin) {
      throw new Error(`Brak konta ${DEMO_ORG_ADMIN_EMAIL} - najpierw utwórz organizację demo.`);
    }
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    for (const user of ROLE_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: { role: user.role, passwordHash, emailVerifiedAt: new Date(), status: 'ACTIVE' },
        create: {
          ...user,
          organizationId: admin.organizationId,
          passwordHash,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });
      console.log(`OK ${user.role}: ${user.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
