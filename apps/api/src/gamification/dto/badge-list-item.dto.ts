import { AchievementRank, AchievementScope } from '@prisma/client';

/**
 * Osiągnięcie na liście profilu (D-111). Tajne i niezdobyte (`hidden` && !`isUnlocked`) ma kod zastępczy `secret-<n>` i null
 * w nazwie, opisie, warunku i zakresie, a `icon` = grafika zablokowana - klient nie może się z odpowiedzi dowiedzieć, co to jest.
 */
export class BadgeListItemDto {
  code!: string;
  // Nazwa po angielsku (jak na grafice); null dla tajnego niezdobytego.
  title!: string | null;
  description!: string | null;
  conditionText!: string | null;
  // Plik w apps/web/public/achievements (bez rozszerzenia).
  icon!: string;
  lockedIcon!: string | null;
  rank!: AchievementRank | null;
  hidden!: boolean;
  scope!: AchievementScope | null;
  xpReward!: number;
  isUnlocked!: boolean;
  unlockedAt!: Date | null;
}
