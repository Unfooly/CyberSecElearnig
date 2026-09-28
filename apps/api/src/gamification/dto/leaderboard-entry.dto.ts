import { AchievementRank } from '@prisma/client';

/** Przypięte osiągnięcie przy nazwisku w rankingu i na profilu (X, część 3) - tylko zdobyte, niewycofane. */
export class PinnedAchievementDto {
  code!: string;
  title!: string;
  // Plik w apps/web/public/achievements (bez rozszerzenia).
  icon!: string;
  rank!: AchievementRank | null;
}

/**
 * Wpis rankingu organizacji (D-112): miejsce, imię i inicjał nazwiska (bez pełnego nazwiska i działu - minimum danych, ranking
 * widzą wszyscy pracownicy organizacji), poziom, XP, przypięte osiągnięcia.
 */
export class LeaderboardEntryDto {
  rank!: number;
  userId!: string;
  firstName!: string;
  lastInitial!: string;
  avatarUrl!: string | null;
  level!: number;
  xp!: number;
  pinned!: PinnedAchievementDto[];
}

/** Ranking: pierwsza dziesiątka + pozycja pytającego (także spoza dziesiątki); wyłączony przez admina - bez wpisów. */
export class LeaderboardDto {
  enabled!: boolean;
  top!: LeaderboardEntryDto[];
  me!: LeaderboardEntryDto | null;
}
