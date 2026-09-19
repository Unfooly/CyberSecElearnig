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
