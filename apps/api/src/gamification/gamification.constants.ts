// Kody odznak - muszą być zgodne z `code` seedowanym przez
// prisma/seed-badges.ts. Jeśli odznaka o danym kodzie nie jest jeszcze
// zaseedowana, GamificationService.tryUnlockBadge po cichu ją pomija (nie
// wywala flow ukończenia kursu z powodu brakujących danych administracyjnych).
export const BADGE_CODES = {
  FIRST_STEP: 'FIRST_STEP',
  PERFECT_SCORE: 'PERFECT_SCORE',
  KNOWLEDGE_HUNTER: 'KNOWLEDGE_HUNTER',
  PHISHING_SPOTTER: 'PHISHING_SPOTTER',
  // Seedowana (prisma/seed-badges.ts), ale ŚWIADOMIE bez logiki
  // auto-odblokowania w GamificationService - wymagałaby znajomości momentu
  // faktycznego rozpoczęcia kursu, a CourseAssignment dziś tego nie
  // zapisuje (tylko createdAt = moment przypisania, nie startu). Dodanie
  // pola startedAt to zmiana schematu spoza zakresu tego zadania - patrz
  // README backlog.
  SPEED_DEMON: 'SPEED_DEMON',
} as const;

export const COURSE_COMPLETION_XP = 100;
export const PERFECT_SCORE_XP = 50;
export const KNOWLEDGE_HUNTER_THRESHOLD = 5;

export const LEADERBOARD_LIMIT = 20;

export type LeaderboardScope = 'organization' | 'department';
