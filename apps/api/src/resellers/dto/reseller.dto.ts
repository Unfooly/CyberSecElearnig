/** Partner w panelu operatora (D-070). Bez danych klienckich - same liczniki. */
export class ResellerDto {
  id!: string;
  name!: string;
  createdAt!: string;
  /**
   * Ile organizacji klienckich obsługuje. Liczba użytkowników partnera celowo NIE jest tu
   * zwracana: `users` jest pod RLS, więc bez kontekstu organizacji zapytanie zwróciłoby 0.
   */
  clientCount!: number;
  /** Tylko w odpowiedzi na utworzenie: kto je założył (kopia adresu operatora). */
  createdByEmail?: string;
  /**
   * Tylko w odpowiedzi na utworzenie: false = konto administratora partnera powstało, ale e-mail
   * z zaproszeniem nie wyszedł. Operator musi to widzieć, bo partner nie ma jak poprosić o ponowną
   * wysyłkę (zaproszenia wysyła ORG_ADMIN organizacji klienckiej).
   */
  inviteEmailSent?: boolean;
}
