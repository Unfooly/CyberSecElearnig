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

export interface Badge {
  code: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: number;
  xp: number;
  departmentName: string | null;
}

export type LeaderboardScope = 'organization' | 'department';

// Startowa lista presetów awatarów - musi być zgodna z
// apps/api/src/users/avatar-presets.ts (AVATAR_PRESETS). Backend dziś nie
// wystawia endpointu z metadanymi presetów (patrz README, backlog modułu
// grywalizacji), więc mapowanie slug -> emoji żyje tu, po stronie frontendu.
export const AVATAR_PRESETS: Record<string, string> = {
  fox: '🦊',
  owl: '🦉',
  wolf: '🐺',
  eagle: '🦅',
  bear: '🐻',
  shield: '🛡️',
  robot: '🤖',
  ninja: '🥷',
};
