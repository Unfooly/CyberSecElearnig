// Typy odpowiedzi importu pracowników z CSV (apps/api: users/import/*). Dwuetapowy: podgląd (walidacja per wiersz, stan miejsc),
// potwierdzenie (konta INVITED) i kolejka zaproszeń z tempem (limit dobowy organizacji rozkłada wysyłkę na kolejne dni).

export type ImportBatchStatus = 'PREVIEW' | 'PROCESSING' | 'COMPLETED';
export type ImportRowStatus = 'VALID' | 'EXISTING' | 'ERROR';
export type ImportRowFilter = ImportRowStatus;

export interface ImportSeats {
  limit: number;
  used: number;
  available: number;
  // Ile nowych kont utworzyłby import i ile miejsc brakuje (0 = mieści się).
  required: number;
  missing: number;
  ok: boolean;
}

export interface ImportInviteCounts {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface ImportProgress {
  accountsCreated: number;
  accountsFailed: number;
  invites: ImportInviteCounts;
  invitesSent: number;
  invitesTotal: number;
  remaining: number;
  dailyLimit: number;
  dailyRemaining: number;
  // true = reszta nie zmieści się w dzisiejszym limicie i pójdzie w kolejnych dniach.
  restTomorrow: boolean;
  // Szacunek (nie obietnica); null, gdy nic nie czeka.
  estimatedCompletionAt: string | null;
  done: boolean;
}

export interface ImportSummary {
  id: string;
  status: ImportBatchStatus;
  fileName: string | null;
  delimiter: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  totalRows: number;
  validCount: number;
  existingCount: number;
  errorCount: number;
  skippedEmpty: number;
  ignoredColumns: string[];
  seats: ImportSeats;
  progress: ImportProgress | null;
}

export interface ImportRow {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  status: ImportRowStatus;
  reason: string | null;
  accountResult?: 'CREATED' | 'FAILED' | null;
  accountReason?: string | null;
  inviteStatus?: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | null;
  inviteReason?: string | null;
}

export interface ImportPreview extends ImportSummary {
  errors: { line: number; email: string; reason: string }[];
  errorsTruncated: boolean;
  sample: ImportRow[];
}

export interface ImportRowsPage {
  items: ImportRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Odpowiedź błędu API (także 409 SEAT_LIMIT z liczbą brakujących miejsc i odsyłaczem do ustawień). */
export interface ImportApiError {
  message?: string | string[];
  code?: string;
  seatsMissing?: number;
  seatsAvailable?: number;
  settingsPath?: string;
}
