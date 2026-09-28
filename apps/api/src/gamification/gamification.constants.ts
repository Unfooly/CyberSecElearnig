// Kody osiągnięć (D-111) - muszą być zgodne z `code` w katalogu `badges`, który wstawia migracja
// 20260928200000_achievements (i dla środowisk deweloperskich prisma/seed-badges.ts). Jeśli wpisu katalogu nie ma,
// GamificationService.tryUnlockBadge po cichu go pomija (nie wywala flow ukończenia kursu z powodu brakujących danych).
export const ACHIEVEMENT_CODES = {
  FIRST_CASE_CLOSED: 'first-case-closed',
  FLAWLESS_CASE: 'flawless-case',
  CURIOUS_DETECTIVE: 'curious-detective',
} as const;

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[keyof typeof ACHIEVEMENT_CODES];

// Osiągnięcia modułu 1 („Wyłudzone hasło”): moduł rozpoznajemy po `Course.slug` (stały klucz importu treści, D-062),
// easter egg po id wyróżnienia z treści (`media.badge.id`, D-100) zapisanym przez serwer w postępie (`easterEggs`).
export const MODULE_1_SLUG = 'wyludzone-haslo';

// Wersja zasad przyznania wstecznego (users.achievementsSyncVersion): podbij przy NOWYM osiągnięciu, którego warunek mógł być
// spełniony wcześniej - każdy użytkownik przejdzie wtedy backfill jeszcze raz (idempotentnie).
export const ACHIEVEMENTS_SYNC_VERSION = 1;
export const CURIOUS_DETECTIVE_EASTER_EGG = 'ciekawski-detektyw';

export const COURSE_COMPLETION_XP = 100;
export const PERFECT_SCORE_XP = 50;

export const LEADERBOARD_LIMIT = 20;

export type LeaderboardScope = 'organization' | 'department';
