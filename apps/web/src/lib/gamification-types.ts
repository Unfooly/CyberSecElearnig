import { Bird, Bot, Cat, Dog, Feather, PawPrint, Shield, Swords, type LucideIcon } from 'lucide-react';

// Ręcznie odwzorowane DTO z apps/api/src/gamification/ - ten sam,
// udokumentowany dług techniczny co przy kursach/dashboardzie (patrz
// README, sekcja "Backlog frontendu").

export interface UnlockedBadge {
  code: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  unlockedAt: string;
}

export interface GamificationOverview {
  avatarUrl: string | null;
  xp: number;
  level: number;
  nextLevelXp: number;
  currentLevelProgressPercent: number;
  badges: UnlockedBadge[];
}

export type AchievementRank = 'SECRET' | 'LEGENDARY' | 'MILESTONE';

/** Etykiety rang w UI - po angielsku, jak na grafikach trofeów (D-111). */
export const RANK_LABELS: Record<AchievementRank, string> = { SECRET: 'Secret', LEGENDARY: 'Legendary', MILESTONE: 'Milestone' };

/**
 * Osiągnięcie na profilu (GET /gamification/badges, D-111). Tajne niezdobyte przychodzi z kodem zastępczym, bez nazwy, opisu i
 * warunku (null), z grafiką zablokowaną w `icon`.
 */
export interface Badge {
  code: string;
  title: string | null;
  description: string | null;
  conditionText: string | null;
  // Nazwa pliku w public/achievements (bez rozszerzenia).
  icon: string;
  lockedIcon: string | null;
  rank: AchievementRank | null;
  hidden: boolean;
  scope: 'MODULE' | 'GLOBAL' | null;
  xpReward: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
  // Pozycja wśród przypiętych (1..3, D-112) albo null.
  pinned: number | null;
}

/** Przypięte osiągnięcie przy nazwisku (ranking, nagłówek profilu; D-112). */
export interface PinnedAchievement {
  code: string;
  title: string;
  icon: string;
  rank: AchievementRank | null;
}

export const MAX_PINNED = 3;
export const PIN_LIMIT_MESSAGE = 'Możesz przypiąć maksymalnie 3 odznaki.';

/** Adres grafiki trofeum z nazwy pliku z API - tylko bezpieczne nazwy (litery, cyfry, myślnik), inaczej brak grafiki. */
export function achievementImage(name: string | null | undefined): string | null {
  return name && /^[a-z0-9-]{1,80}$/.test(name) ? `/achievements/${name}.svg` : null;
}

/** Wpis rankingu organizacji (D-112): imię i inicjał nazwiska, bez działu. */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  firstName: string;
  lastInitial: string;
  avatarUrl: string | null;
  level: number;
  xp: number;
  pinned: PinnedAchievement[];
}

/** Ranking: pierwsza dziesiątka + pozycja pytającego; `enabled: false` - admin organizacji wyłączył ranking. */
export interface Leaderboard {
  enabled: boolean;
  top: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export type LeaderboardScope = 'organization' | 'department';

// Startowa lista presetów awatarów - klucze (slugi) muszą być zgodne z
// apps/api/src/users/avatar-presets.ts (AVATAR_PRESETS). Backend dziś nie
// wystawia endpointu z metadanymi presetów (patrz README, backlog modułu
// grywalizacji), więc mapowanie slug -> ikona żyje tu, po stronie frontendu.
// Ikony liniowe Lucide zamiast emoji (BRAND.md); do bazy trafia wyłącznie slug.
export const AVATAR_PRESETS: Record<string, LucideIcon> = {
  fox: Cat,
  owl: Bird,
  wolf: Dog,
  eagle: Feather,
  bear: PawPrint,
  shield: Shield,
  robot: Bot,
  ninja: Swords,
};
