export class UnlockedBadgeDto {
  code!: string;
  title!: string;
  description!: string;
  icon!: string;
  xpReward!: number;
  unlockedAt!: Date;
}

export class UserGamificationSummaryDto {
  // Dodane dla frontendu (UserGamificationCard) - żaden inny endpoint nie
  // zwraca avatarUrl bieżącego usera (PATCH /users/me/avatar zwraca tylko
  // nowo ustawioną wartość, JWT go nie niesie i tak by się nie odświeżał
  // przy zmianie). Zamiast osobnego GET /users/me - dokładamy tu.
  avatarUrl!: string | null;
  xp!: number;
  level!: number;
  nextLevelXp!: number;
  currentLevelProgressPercent!: number;
  badges!: UnlockedBadgeDto[];
}
