export class LeaderboardEntryDto {
  rank!: number;
  userId!: string;
  firstName!: string;
  lastName!: string;
  avatarUrl!: string | null;
  level!: number;
  xp!: number;
  departmentName!: string | null;
}
