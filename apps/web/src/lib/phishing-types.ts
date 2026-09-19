// Kształty odpowiedzi apps/api dla modułu symulacji phishingowych (lustro DTO API).

export interface PhishingTemplate {
  id: string;
  scope: 'GLOBAL' | 'ORGANIZATION';
  key: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  lessonHtml: string;
  senderName: string;
  senderLocalPart: string;
  // Pełny adres nadawcy (część lokalna @ domena symulacji); null, gdy domena nieskonfigurowana.
  senderAddress: string | null;
  sourceTemplateId: string | null;
  updatedAt: string;
}

export interface PhishingTemplateEdit {
  id: string;
  templateId: string | null;
  templateName: string;
  action: 'CLONED' | 'UPDATED' | 'DELETED';
  changedFields: string[];
  actorEmail: string;
  createdAt: string;
}

export interface TemplatePreview {
  bodyHtml: string | null;
  lessonHtml: string | null;
  hasTrackingLink: boolean;
}

// Pola edytowalne szablonu (allowlista także w BFF).
export const TEMPLATE_EDITABLE_FIELDS = ['name', 'subject', 'senderName', 'senderLocalPart', 'bodyHtml', 'lessonHtml'] as const;

// --- Kampanie ---

export type CampaignStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
export type AudienceType = 'ALL' | 'DEPARTMENTS' | 'USERS';

export interface CampaignCounts {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  // Dostawca MÓGŁ wysłać (timeout, przerwane zadanie) - "niepewne", nie ponawiane ("co najwyżej raz").
  uncertain: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  audienceType: AudienceType;
  templateName: string;
  subject: string;
  senderName: string;
  senderAddress: string | null;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
  createdByEmail: string;
  counts: CampaignCounts;
  failures: { code: string; count: number; uncertain: boolean }[];
}

export interface Audience {
  type: AudienceType;
  departmentIds?: string[];
  userIds?: string[];
}

export interface PhishingConfig {
  transport: string;
  configured: boolean;
  reason: string | null;
  senderDomain: string | null;
  landingHost: string | null;
  // "log" (tryb deweloperski) nic nie wysyła.
  sendsRealMail: boolean;
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  SCHEDULED: 'Zaplanowana',
  RUNNING: 'W trakcie',
  COMPLETED: 'Zakończona',
  CANCELLED: 'Anulowana',
};

// Opisy kodów porażek (kody nie zawierają danych osobowych).
export const FAILURE_LABELS: Record<string, string> = {
  TIMEOUT_UNKNOWN: 'Przekroczony czas - dostawca mógł wysłać wiadomość',
  RESULT_UNKNOWN: 'Nieznany wynik wysyłki - dostawca mógł wysłać wiadomość',
  INTERRUPTED_UNKNOWN: 'Wysyłka przerwana (restart/awaria) - dostawca mógł wysłać wiadomość',
  CANCELLED: 'Kampania anulowana przed wysyłką',
  WINDOW_EXPIRED: 'Okno wysyłki minęło przed wysłaniem',
  RECIPIENT_REMOVED: 'Pracownik usunięty lub nieaktywny w chwili wysyłki',
  COMPOSE_FAILED: 'Nie udało się złożyć wiadomości',
};

export function failureLabel(code: string): string {
  if (/^HTTP_5\d\d$/.test(code)) {
    return `Błąd serwera dostawcy (${code}) - dostawca mógł wysłać wiadomość`;
  }
  return FAILURE_LABELS[code] ?? (code.startsWith('HTTP_') || code.startsWith('SMTP_') ? `Odrzucone przez dostawcę (${code})` : code);
}
