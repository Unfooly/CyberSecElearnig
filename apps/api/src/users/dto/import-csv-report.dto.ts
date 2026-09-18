export interface ImportCsvRowError {
  line: number;
  email: string;
  reason: string;
}

export class ImportCsvReportDto {
  successCount!: number;
  failedCount!: number;
  // Konta utworzone (liczą się do successCount), ale e-mail z zaproszeniem
  // nie wyszedł - admin powinien użyć "Wyślij zaproszenie ponownie".
  emailFailedCount!: number;
  errors!: ImportCsvRowError[];
}
