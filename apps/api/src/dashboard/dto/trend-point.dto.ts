export class TrendPointDto {
  // 'YYYY-MM' (UTC)
  month!: string;
  completionRate!: number | null;
  mandatoryTotal!: number;
  mandatoryCompleted!: number;
}
