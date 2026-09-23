// Panel operatora i panel partnera (D-070). Typy odwzorowują DTO z apps/api/src/resellers/dto
// pole-po-polu (ta sama praktyka co courses-types.ts; wspólne DTO to osobne zadanie, B-042).

export interface Reseller {
  id: string;
  name: string;
  createdAt: string;
  /** Ile organizacji klienckich obsługuje. */
  clientCount: number;
}

export interface AssignableOrganization {
  id: string;
  name: string;
  status: 'PENDING_DOMAIN_VERIFICATION' | 'ACTIVE';
  /** null = organizacja nie ma opiekuna. */
  resellerId: string | null;
  resellerName: string | null;
}

/** Klient na liście partnera: WYŁĄCZNIE metadane organizacji, bez danych pracowników i wyników. */
export interface ResellerClient {
  id: string;
  name: string;
  status: 'PENDING_DOMAIN_VERIFICATION' | 'ACTIVE';
  plan: string;
  seatsLimit: number;
  assignedAt: string;
}
