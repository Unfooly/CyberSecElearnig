import { notFound } from 'next/navigation';
import type { Badge } from '@/lib/gamification-types';
import AchievementGrid from '../../courses/achievements/_components/AchievementGrid';

// Podgląd kart osiągnięć (D-111) bez backendu i logowania - WYŁĄCZNIE do scripts/layout-check.mjs (sekcja `achievements`) i ręcznego
// podglądu. Jak courses-harness: plik `.dev.tsx` istnieje w routingu tylko z NEXT_PUBLIC_DEV_HARNESS=1 (next.config.mjs), notFound()
// to druga linia obrony. Dane jak z GET /gamification/badges: jedno zdobyte, jedno niezdobyte (warunek), jedno tajne niezdobyte.
const BADGES: Badge[] = [
  {
    code: 'first-case-closed',
    title: 'First Case Closed',
    description: 'Twoja pierwsza zamknięta sprawa.',
    conditionText: 'Ukończ dowolne szkolenie.',
    icon: 'osiagniecie-pierwsza-sprawa',
    lockedIcon: 'osiagniecie-pierwsza-sprawa-zablokowane',
    rank: 'MILESTONE',
    hidden: false,
    scope: 'GLOBAL',
    xpReward: 50,
    isUnlocked: true,
    unlockedAt: '2026-09-28T10:00:00.000Z',
  },
  {
    code: 'flawless-case',
    title: 'Flawless Case',
    description: 'Zamknąłeś sprawę bez jednego przeoczonego śladu.',
    conditionText: 'Zbierz wszystkie dowody (23/23) i zdobądź 100% za zadania w jednym podejściu do sprawy „Wyłudzone hasło”.',
    icon: 'osiagniecie-perfekcyjne-sledztwo',
    lockedIcon: 'osiagniecie-perfekcyjne-sledztwo-zablokowane',
    rank: 'LEGENDARY',
    hidden: false,
    scope: 'MODULE',
    xpReward: 50,
    isUnlocked: false,
    unlockedAt: null,
  },
  {
    code: 'secret-3',
    title: null,
    description: null,
    conditionText: null,
    icon: 'osiagniecie-tajne-zablokowane',
    lockedIcon: 'osiagniecie-tajne-zablokowane',
    rank: 'SECRET',
    hidden: true,
    scope: null,
    xpReward: 0,
    isUnlocked: false,
    unlockedAt: null,
  },
];

export default function AchievementsHarnessPage() {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') notFound();
  return (
    <div className="min-h-dvh bg-slate-50">
      <main className="mx-auto max-w-7xl p-4 sm:p-8">
        <h1 className="mb-6 flex items-baseline gap-3 text-2xl font-semibold text-slate-900">
          Osiągnięcia
          <span className="text-base font-bold text-muted" data-testid="achievements-counter">
            1 / 3
          </span>
        </h1>
        <AchievementGrid badges={BADGES} />
      </main>
    </div>
  );
}
