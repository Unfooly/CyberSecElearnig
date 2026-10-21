import { notFound } from 'next/navigation';
import Card from '@/components/ui/Card';
import type { Badge, Leaderboard, LeaderboardEntry } from '@/lib/gamification-types';
import AchievementsProfile from '../../courses/achievements/_components/AchievementsProfile';
import LeaderboardTable from '../../courses/_components/LeaderboardTable';

// Podgląd profilu osiągnięć (D-111, D-112) i rankingu organizacji bez backendu i logowania - WYŁĄCZNIE do scripts/layout-check.mjs
// (sekcja `achievements`) i ręcznego podglądu. Jak courses-harness: plik `.dev.tsx` istnieje w routingu tylko z
// NEXT_PUBLIC_DEV_HARNESS=1 (next.config.mjs), notFound() to druga linia obrony. Dane jak z GET /gamification/badges i
// /gamification/leaderboard: dwa zdobyte (jedno przypięte), jedno tajne niezdobyte; ranking - dziesiątka + „Ty” na 14. miejscu.
// Zapis przypięć (PUT /api/gamification/pinned) layout-check przechwytuje w przeglądarce (page.route). Nazwy i grafiki jak dla gracza
// z językiem szkoleń PL (poprawki m3, pkt c: API podaje grafiki z katalogiem języka, „pl/…”).
const BADGES: Badge[] = [
  {
    code: 'first-case-closed',
    title: 'Pierwsza sprawa zamknięta',
    description: 'Twoja pierwsza zamknięta sprawa.',
    conditionText: 'Ukończ dowolne szkolenie.',
    icon: 'pl/osiagniecie-pierwsza-sprawa',
    lockedIcon: 'pl/osiagniecie-pierwsza-sprawa-zablokowane',
    rank: 'MILESTONE',
    hidden: false,
    scope: 'GLOBAL',
    xpReward: 50,
    isUnlocked: true,
    unlockedAt: '2026-09-28T10:00:00.000Z',
    pinned: 1,
  },
  {
    code: 'flawless-case',
    title: 'Sprawa bez skazy',
    description: 'Zamknąłeś sprawę bez jednego przeoczonego śladu.',
    conditionText: 'Zbierz wszystkie dowody (23/23) i zdobądź 100% za zadania w jednym podejściu do sprawy „Wyłudzone hasło”.',
    icon: 'pl/osiagniecie-perfekcyjne-sledztwo',
    lockedIcon: 'pl/osiagniecie-perfekcyjne-sledztwo-zablokowane',
    rank: 'LEGENDARY',
    hidden: false,
    scope: 'MODULE',
    xpReward: 50,
    isUnlocked: true,
    unlockedAt: '2026-09-28T10:05:00.000Z',
    pinned: null,
  },
  {
    code: 'secret-3',
    title: null,
    description: null,
    conditionText: null,
    icon: 'pl/osiagniecie-tajne-zablokowane',
    lockedIcon: 'pl/osiagniecie-tajne-zablokowane',
    rank: 'SECRET',
    hidden: true,
    scope: null,
    xpReward: 0,
    isUnlocked: false,
    unlockedAt: null,
    pinned: null,
  },
  // Moduł 2 (D-124): ranga Rare zdobyta i niezdobyta, Legendary niezdobyte, tajne zdobyte.
  {
    code: 'dead-air',
    title: 'Cisza na linii',
    description: 'Rozłączyłeś się, zanim oszust zdążył cokolwiek wyciągnąć.',
    conditionText: 'W rozmowie na żywo w sprawie „Głos z helpdesku” zakończ rozmowę dobrze w najwyżej trzech odpowiedziach, nie podając niczego.',
    icon: 'pl/osiagniecie-cisza-na-linii',
    lockedIcon: 'pl/osiagniecie-cisza-na-linii-zablokowane',
    rank: 'RARE',
    hidden: false,
    scope: 'MODULE',
    xpReward: 25,
    isUnlocked: true,
    unlockedAt: '2026-09-29T11:00:00.000Z',
    pinned: null,
  },
  {
    code: 'perfect-pitch',
    title: 'Słuch absolutny',
    description: 'Wyłapałeś każdą manipulację. Bez jednego fałszywego alarmu.',
    conditionText: 'W odsłuchu nagrania w sprawie „Głos z helpdesku” zaznacz wszystkie czerwone flagi bez żadnego fałszywego alarmu.',
    icon: 'pl/osiagniecie-czysty-odsluch',
    lockedIcon: 'pl/osiagniecie-czysty-odsluch-zablokowane',
    rank: 'RARE',
    hidden: false,
    scope: 'MODULE',
    xpReward: 25,
    isUnlocked: false,
    unlockedAt: null,
    pinned: null,
  },
  {
    code: 'full-transcript',
    title: 'Pełny zapis',
    description: 'Cała rozmowa rozpisana co do słowa. Sprawa bez luk.',
    conditionText: 'Zbierz wszystkie dowody (także ukryte) i zdobądź 100% za zadania w jednym podejściu do sprawy „Głos z helpdesku”.',
    icon: 'pl/osiagniecie-pelny-zapis',
    lockedIcon: 'pl/osiagniecie-pelny-zapis-zablokowane',
    rank: 'LEGENDARY',
    hidden: false,
    scope: 'MODULE',
    xpReward: 50,
    isUnlocked: false,
    unlockedAt: null,
    pinned: null,
  },
  {
    code: 'off-the-record',
    title: 'Poza protokołem',
    description: 'Wysłuchałeś webinaru do końca i usłyszałeś to, czego nie powinno tam być.',
    conditionText: 'Wysłuchaj do końca webinaru na stronie firmy w sprawie „Głos z helpdesku”.',
    icon: 'pl/osiagniecie-off-the-record',
    lockedIcon: 'pl/osiagniecie-tajne-zablokowane',
    rank: 'SECRET',
    hidden: true,
    scope: 'MODULE',
    xpReward: 0,
    isUnlocked: true,
    unlockedAt: '2026-09-29T11:05:00.000Z',
    pinned: null,
  },
];

const PINNED = [
  { code: 'flawless-case', title: 'Sprawa bez skazy', icon: 'pl/osiagniecie-perfekcyjne-sledztwo', rank: 'LEGENDARY' as const },
  { code: 'curious-detective', title: 'Ciekawski detektyw', icon: 'pl/osiagniecie-ciekawski-detektyw', rank: 'SECRET' as const },
  { code: 'first-case-closed', title: 'Pierwsza sprawa zamknięta', icon: 'pl/osiagniecie-pierwsza-sprawa', rank: 'MILESTONE' as const },
];
const NAMES = ['Katarzyna', 'Bartłomiej', 'Anna', 'Jan', 'Małgorzata', 'Piotr', 'Zofia', 'Krzysztof', 'Ewa', 'Tomasz'];
const TOP: LeaderboardEntry[] = NAMES.map((firstName, index) => ({
  rank: index + 1,
  userId: `dev-${index + 1}`,
  firstName,
  lastInitial: 'ABCDEFGHIJ'[index],
  avatarUrl: index % 3 === 0 ? 'fox' : null,
  level: 8 - Math.floor(index / 2),
  xp: 2400 - index * 170,
  pinned: PINNED.slice(0, 3 - (index % 4)),
}));
const ME: LeaderboardEntry = { rank: 14, userId: 'dev-me', firstName: 'Ola', lastInitial: 'W', avatarUrl: null, level: 2, xp: 300, pinned: [PINNED[2]] };
const LEADERBOARD: Leaderboard = { enabled: true, top: TOP, me: ME };

export default function AchievementsHarnessPage() {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') notFound();
  return (
    <div className="min-h-dvh bg-slate-50">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:p-8">
        <AchievementsProfile badges={BADGES} displayName="Ola W." />
        <Card className="mt-8" data-testid="harness-leaderboard">
          <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
            <h2 className="text-lg font-bold tracking-[-0.01em]">Ranking organizacji</h2>
          </div>
          <LeaderboardTable leaderboard={LEADERBOARD} currentUserId="dev-me" />
        </Card>
      </main>
    </div>
  );
}
