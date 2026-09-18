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
