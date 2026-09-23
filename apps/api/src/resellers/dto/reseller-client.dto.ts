import { OrganizationStatus, Plan } from '@prisma/client';

/**
 * Klient na liście partnera (D-070). Świadomie WYŁĄCZNIE metadane organizacji: żadnych
 * pracowników, wyników szkoleń ani symulacji. Dostęp do danych klienta to osobny krok
 * („wejdź jako organizacja”), z tokenem zakresowanym i audytem.
 */
export class ResellerClientDto {
  id!: string;
  name!: string;
  status!: OrganizationStatus;
  plan!: Plan;
  seatsLimit!: number;
  assignedAt!: string;
}
