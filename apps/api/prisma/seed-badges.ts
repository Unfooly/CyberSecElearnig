import { PrismaClient } from '@prisma/client';
import { BADGE_CODES } from '../src/gamification/gamification.constants';

// Seed danych administracyjnych (definicje odznak), NIE migracja schematu -
// stąd osobny skrypt, nie plik w prisma/migrations. Idempotentny (upsert po
// `code`) - bezpieczny do wielokrotnego uruchomienia, np. po dodaniu nowej
// odznaki do tej listy na już działającym środowisku.
//
// Łączy się bezpośrednio przez PrismaClient (rola z DATABASE_URL, NIE
// DATABASE_URL_APP) - `badges` to globalny katalog bez RLS (jak `courses`),
// więc nie ma tu problemu z Zasadą nr 1 (brak organizationId w tej tabeli).

const STARTER_BADGES = [
  {
    code: BADGE_CODES.FIRST_STEP,
    title: 'Pierwszy Krok',
    description: 'Ukończono pierwszy kurs.',
    icon: 'first-step',
    xpReward: 50,
  },
  {
    code: BADGE_CODES.PERFECT_SCORE,
    title: 'Sokole Oko',
    description: 'Ukończono kurs z wynikiem 100%.',
    icon: 'perfect-score',
    xpReward: 50,
  },
  {
    code: BADGE_CODES.KNOWLEDGE_HUNTER,
    title: 'Łowca Wiedzy',
    description: 'Ukończono 5 kursów.',
    icon: 'knowledge-hunter',
    xpReward: 100,
  },
  {
    code: BADGE_CODES.PHISHING_SPOTTER,
    title: 'Tropiciel Phishingu',
    description: 'Ukończono wszystkie przypisane kursy z kategorii Phishing i Inżynieria Społeczna.',
    icon: 'phishing-spotter',
    xpReward: 75,
  },
  {
    // Seedowana celowo bez logiki auto-odblokowania - patrz komentarz przy
    // BADGE_CODES.SPEED_DEMON w gamification.constants.ts.
    code: BADGE_CODES.SPEED_DEMON,
    title: 'Błyskawica',
    description: 'Ukończono kurs błyskawicznie po rozpoczęciu (wkrótce).',
    icon: 'speed-demon',
    xpReward: 50,
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const badge of STARTER_BADGES) {
      await prisma.badge.upsert({
        where: { code: badge.code },
        update: { title: badge.title, description: badge.description, icon: badge.icon, xpReward: badge.xpReward },
        create: badge,
      });
      console.log(`[seed-badges] OK: ${badge.code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed-badges] Błąd:', error);
  process.exit(1);
});
