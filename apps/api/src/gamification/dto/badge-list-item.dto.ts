export class BadgeListItemDto {
  code!: string;
  title!: string;
  description!: string;
  icon!: string;
  xpReward!: number;
  isUnlocked!: boolean;
  unlockedAt!: Date | null;
}
