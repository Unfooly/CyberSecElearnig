import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { IsEmail, IsString, MinLength } from 'class-validator';

// Brak organizationName - nazwa organizacji jest wyprowadzana z domeny
// e-maila (część po @), nie przyjmowana od klienta - patrz
// AuthService.register / deriveOrganizationNameFromEmail. Klient, który i
// tak by je przesłał, dostanie 400 (forbidNonWhitelisted w main.ts).
export class RegisterDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
