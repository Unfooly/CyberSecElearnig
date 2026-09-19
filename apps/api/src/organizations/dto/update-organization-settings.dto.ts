import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/transforms/trim';

// Bez znaków sterujących/formatujących (nazwa trafia do maili) - jak w RegisterDto.
const NO_CONTROL_CHARS = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

export class UpdateOrganizationSettingsDto {
  // Nazwa wyświetlana organizacji (dane do faktury zmienia się osobno).
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARS, { message: 'Pole zawiera niedozwolone znaki.' })
  name?: string;

  // "Pracownicy z adresem @domena mogą sami dołączyć" - włączenie wymaga
  // zweryfikowanej domeny (sprawdza serwis). Tu tylko przełącznik; sam przepływ
  // samodzielnego dołączania to osobne zadanie.
  @IsOptional()
  @IsBoolean()
  selfJoinEnabled?: boolean;
}
