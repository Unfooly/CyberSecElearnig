import { IsString, Matches } from 'class-validator';

// Ten sam wzorzec identyfikatora co SafeIdPipe (cuid i klucze seedów) - śmieci odpadają w DTO.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Przypisanie organizacji klienckiej do partnera (operator, D-070). */
export class AssignOrganizationDto {
  @IsString()
  @Matches(SAFE_ID, { message: 'Nieprawidłowy identyfikator organizacji.' })
  organizationId!: string;
}
