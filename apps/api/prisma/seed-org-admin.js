/* eslint-disable */
// Seed: JEDNO konto ORG_ADMIN w organizacji ze ZWERYFIKOWANĄ domeną (status ACTIVE) - na środowisko testowe/dev.
//
// UWAGA - WYJĄTEK OD ZASADY (CLAUDE.md, "Model rejestracji firm"): `verifiedAt` i status ACTIVE ustawia normalnie
// wyłącznie DomainVerificationService po sprawdzeniu rekordu DNS TXT. Ten skrypt robi to świadomie, poza tą ścieżką,
// więc:
//  - na NODE_ENV=production odmawia, chyba że jawnie potwierdzono, że to środowisko TESTOWE bez danych prawdziwych klientów
//    (SEED_CONFIRM_TEST_ENVIRONMENT=yes-this-is-not-real-customer-data),
//  - nie nadpisuje niczego: istniejące konto o tym e-mailu albo domena już zweryfikowana w innej organizacji => błąd,
//  - hasło jest LOSOWE i nigdzie nie jest wypisywane ani zapisywane jawnie: wejście przez "Zapomniałem hasła" (link w mailu).
//
// Plik jest zwykłym JS (nie TS), bo obraz produkcyjny nie zawiera ts-node; działa w obrazie API i lokalnie:
//   lokalnie: cd apps/api && SEED_ADMIN_EMAIL=... npx dotenv -e ../../.env -- node prisma/seed-org-admin.js
//   VPS:      patrz docs/deploy-test.md (sekcja "Seed konta administratora")
// Łączy się rolą z DATABASE_URL (właściciel schematu); RLS z FORCE dotyczy i jej, dlatego dane organizacji są zapisywane
// w transakcji z ustawionym app.current_org_id.
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const CONFIRM_VALUE = 'yes-this-is-not-real-customer-data';

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** "jakub.pieterwas" -> { firstName: "Jakub", lastName: "Pieterwas" } (best effort; pola opcjonalne). */
function namesFromEmail(email) {
  const [first, ...rest] = email.split('@')[0].split(/[._-]+/).filter(Boolean);
  return { firstName: capitalize(first) || null, lastName: rest.length ? rest.map(capitalize).join(' ') : null };
}

async function seedOrgAdmin(prisma, options, env = process.env) {
  if (env.NODE_ENV === 'production' && env.SEED_CONFIRM_TEST_ENVIRONMENT !== CONFIRM_VALUE) {
    throw new Error(
      `seed-org-admin odmawia na NODE_ENV=production. To środowisko TESTOWE bez prawdziwych klientów? Ustaw SEED_CONFIRM_TEST_ENVIRONMENT=${CONFIRM_VALUE}.`,
    );
  }
  const email = String(options.email || '').trim().toLowerCase();
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email);
  if (!match) {
    throw new Error('Podaj poprawny SEED_ADMIN_EMAIL (adres służbowy).');
  }
  const domain = match[1];
  const organizationName = (options.organizationName || '').trim() || domain;

  // Istniejące konto o tym e-mailu (wyszukanie po globalnie unikalnym e-mailu wymaga sentinela bypass w USING, jak w runAuthLookup).
  const existing = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
    return tx.user.findUnique({ where: { email }, select: { id: true } });
  });
  if (existing) {
    throw new Error(`Konto ${email} już istnieje - seed niczego nie zmienia. Użyj "Zapomniałem hasła".`);
  }

  // Hasło losowe: znane tylko w tej funkcji i od razu zahaszowane (nigdy nie jest zwracane ani logowane).
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const now = options.now || new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: organizationName, status: 'ACTIVE' } });
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organization.id}, true)`;
      await tx.organizationDomain.create({
        data: { organizationId: organization.id, domain, verificationToken: crypto.randomBytes(24).toString('hex'), verifiedAt: now, lastCheckedAt: now },
      });
      const user = await tx.user.create({
        data: { organizationId: organization.id, email, passwordHash, role: 'ORG_ADMIN', status: 'ACTIVE', emailVerifiedAt: now, ...namesFromEmail(email) },
      });
      return { organizationId: organization.id, userId: user.id, email, domain, organizationName };
    });
  } catch (error) {
    // Unikat częściowy "domena zweryfikowana tylko w jednej organizacji" (organization_domains_domain_verified_key).
    if (error && error.code === 'P2002') {
      throw new Error(`Domena ${domain} jest już zweryfikowana w innej organizacji - seed niczego nie utworzył (transakcja cofnięta).`);
    }
    throw error;
  }
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = await seedOrgAdmin(prisma, { email: process.env.SEED_ADMIN_EMAIL, organizationName: process.env.SEED_ORGANIZATION_NAME });
    console.log(`Utworzono organizację "${result.organizationName}" (ACTIVE, domena ${result.domain} zweryfikowana) i konto ORG_ADMIN ${result.email}.`);
    console.log('Hasło jest losowe i nieznane: wejdź przez "Zapomniałem hasła" na stronie logowania (link w mailu).');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`BŁĄD: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { seedOrgAdmin, namesFromEmail, CONFIRM_VALUE };
