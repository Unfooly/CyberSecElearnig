import type { PillTone } from '@/components/ui/Pill';

export const REPORT_STATUSES = ['NEW', 'IN_REVIEW', 'THREAT', 'SAFE'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const STATUS_LABELS: Record<ReportStatus, string> = {
  NEW: 'Nowe',
  IN_REVIEW: 'W analizie',
  THREAT: 'Zagrożenie',
  SAFE: 'Bezpieczne',
};

export const STATUS_TONES: Record<ReportStatus, PillTone> = {
  NEW: 'acc',
  IN_REVIEW: 'warn',
  THREAT: 'warn',
  SAFE: 'ok',
};

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Widok ORG_ADMIN: pełna tożsamość zgłaszającego (potrzebna do odpowiedzi), lista bez treści.
export interface AdminInboxItem {
  id: string;
  createdAt: string;
  status: ReportStatus;
  subject: string | null;
  senderText: string | null;
  senderDomain: string | null;
  reporter: { userId: string; name: string | null; email: string } | null;
  // false = treść zgłoszenia została usunięta (retencja 90 dni).
  hasContent: boolean;
}

export interface ReportEvent {
  id: string;
  type: 'STATUS_CHANGED' | 'NOTE_ADDED';
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  note: string | null;
  actorEmail: string;
  createdAt: string;
}

export interface AdminReportDetail extends AdminInboxItem {
  body: string | null;
  headers: string | null;
  comment: string | null;
  departmentName: string | null;
  events: ReportEvent[];
}

// Widok kierownika działu: bez zgłaszającego, treści i notatek; bez zmian.
export interface DepartmentInboxItem {
  id: string;
  createdAt: string;
  status: ReportStatus;
  subject: string | null;
  senderText: string | null;
  senderDomain: string | null;
}

export interface DepartmentInbox extends Page<DepartmentInboxItem> {
  insufficientData: boolean;
  minGroupSize: number;
}
