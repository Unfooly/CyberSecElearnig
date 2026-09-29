import { AchievementRank, AchievementScope, PrismaClient } from '@prisma/client';
import { ACHIEVEMENT_CODES, MODULE_1_SLUG, MODULE_2_SLUG } from '../src/gamification/gamification.constants';

// Katalog osiągnięć (D-111). Źródłem na wdrożeniu jest MIGRACJA 20260928200000_achievements (seed nie jest częścią
// wdrożenia); ten skrypt tylko przywraca te same wpisy (np. po ręcznej zmianie w bazie deweloperskiej). Idempotentny (upsert
// po `code`). Zmiana treści tutaj bez nowej migracji NIE trafi na produkcję - zmień oba miejsca.
//
// Łączy się bezpośrednio przez PrismaClient (rola z DATABASE_URL, NIE DATABASE_URL_APP) - `badges` to globalny katalog bez
// RLS (jak `courses`), więc nie ma tu problemu z Zasadą nr 1 (brak organizationId w tej tabeli).

const ACHIEVEMENTS = [
  {
    code: ACHIEVEMENT_CODES.FIRST_CASE_CLOSED,
    title: 'First Case Closed',
    description: 'Twoja pierwsza zamknięta sprawa.',
    icon: 'osiagniecie-pierwsza-sprawa',
    lockedIcon: 'osiagniecie-pierwsza-sprawa-zablokowane',
    xpReward: 50,
    rank: AchievementRank.MILESTONE,
    hidden: false,
    scope: AchievementScope.GLOBAL,
    moduleSlug: null,
    conditionText: 'Ukończ dowolne szkolenie.',
    sortOrder: 1,
  },
  {
    code: ACHIEVEMENT_CODES.FLAWLESS_CASE,
    title: 'Flawless Case',
    description: 'Zamknąłeś sprawę bez jednego przeoczonego śladu.',
    icon: 'osiagniecie-perfekcyjne-sledztwo',
    lockedIcon: 'osiagniecie-perfekcyjne-sledztwo-zablokowane',
    xpReward: 50,
    rank: AchievementRank.LEGENDARY,
    hidden: false,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_1_SLUG,
    conditionText: 'Zbierz wszystkie dowody (23/23) i zdobądź 100% za zadania w jednym podejściu do sprawy „Wyłudzone hasło”.',
    sortOrder: 2,
  },
  {
    code: ACHIEVEMENT_CODES.CURIOUS_DETECTIVE,
    title: 'Curious Detective',
    description: 'Otworzyłeś podejrzaną grę na pulpicie Anny. Na szczęście tylko w ćwiczeniu.',
    icon: 'osiagniecie-ciekawski-detektyw',
    // Neutralna nazwa: grafika zablokowanego tajnego idzie do klienta przed zdobyciem i nie może zdradzać, co to jest.
    lockedIcon: 'osiagniecie-tajne-zablokowane',
    xpReward: 0,
    rank: AchievementRank.SECRET,
    hidden: true,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_1_SLUG,
    conditionText: 'Otwórz podejrzaną grę na pulpicie Anny w sprawie „Wyłudzone hasło”.',
    sortOrder: 3,
  },
  // Moduł 2 (D-124) - te same wpisy co migracja 20260929200100_module2_achievements.
  {
    code: ACHIEVEMENT_CODES.DEAD_AIR,
    title: 'Dead Air',
    description: 'Rozłączyłeś się, zanim oszust zdążył cokolwiek wyciągnąć.',
    icon: 'osiagniecie-cisza-na-linii',
    lockedIcon: 'osiagniecie-cisza-na-linii-zablokowane',
    xpReward: 25,
    rank: AchievementRank.RARE,
    hidden: false,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_2_SLUG,
    conditionText: 'W rozmowie na żywo w sprawie „Głos z helpdesku” zakończ rozmowę dobrze w najwyżej trzech odpowiedziach, nie podając niczego.',
    sortOrder: 4,
  },
  {
    code: ACHIEVEMENT_CODES.PERFECT_PITCH,
    title: 'Perfect Pitch',
    description: 'Wyłapałeś każdą manipulację. Bez jednego fałszywego alarmu.',
    icon: 'osiagniecie-czysty-odsluch',
    lockedIcon: 'osiagniecie-czysty-odsluch-zablokowane',
    xpReward: 25,
    rank: AchievementRank.RARE,
    hidden: false,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_2_SLUG,
    conditionText: 'W odsłuchu nagrania w sprawie „Głos z helpdesku” zaznacz wszystkie czerwone flagi bez żadnego fałszywego alarmu.',
    sortOrder: 5,
  },
  {
    code: ACHIEVEMENT_CODES.FULL_TRANSCRIPT,
    title: 'Full Transcript',
    description: 'Cała rozmowa rozpisana co do słowa. Sprawa bez luk.',
    icon: 'osiagniecie-pelny-zapis',
    lockedIcon: 'osiagniecie-pelny-zapis-zablokowane',
    xpReward: 50,
    rank: AchievementRank.LEGENDARY,
    hidden: false,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_2_SLUG,
    conditionText: 'Zbierz wszystkie dowody (także ukryte) i zdobądź 100% za zadania w jednym podejściu do sprawy „Głos z helpdesku”.',
    sortOrder: 6,
  },
  {
    code: ACHIEVEMENT_CODES.OFF_THE_RECORD,
    title: 'Off the Record',
    description: 'Wysłuchałeś webinaru do końca i usłyszałeś to, czego nie powinno tam być.',
    icon: 'osiagniecie-off-the-record',
    lockedIcon: 'osiagniecie-tajne-zablokowane',
    xpReward: 0,
    rank: AchievementRank.SECRET,
    hidden: true,
    scope: AchievementScope.MODULE,
    moduleSlug: MODULE_2_SLUG,
    conditionText: 'Wysłuchaj do końca webinaru na stronie firmy w sprawie „Głos z helpdesku”.',
    sortOrder: 7,
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const achievement of ACHIEVEMENTS) {
      const { code, ...fields } = achievement;
      await prisma.badge.upsert({ where: { code }, update: { ...fields, retiredAt: null }, create: achievement });
      console.log(`[seed-badges] OK: ${code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed-badges] Błąd:', error);
  process.exit(1);
});
