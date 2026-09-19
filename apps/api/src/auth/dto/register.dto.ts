import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { Trim } from '../../common/transforms/trim';
import { IsNip } from '../../common/validators/is-nip.validator';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '../../users/name-pattern';
import { PL_POSTAL_CODE_REGEX, REGISTRATION_COUNTRY } from '@cyberszkolo/shared';
import { Equals, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Bez znaków sterujących (\p{Cc}: nowe linie, C1), formatujących (\p{Cf}: znaki
// bidi, zero-width) i separatorów linii/akapitu (\p{Zl}, \p{Zp}) - nazwy firm i
// adres trafiają do tematów i treści maili (spoofing kierunku pisma,
// wstrzyknięcie nagłówków).
const NO_CONTROL_CHARS = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
const NO_CONTROL_CHARS_MESSAGE = 'Pole zawiera niedozwolone znaki.';

// Samoobsługowa rejestracja firmy. Nazwa organizacji NIE jest wyprowadzana z
// domeny e-maila - podaje ją klient (nazwa wyświetlana), a dane do faktury są
// osobno. Klient, który prześle dodatkowe pola, dostanie 400 (forbidNonWhitelisted).
export class RegisterDto {
  // --- administrator ---
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  firstName!: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  lastName!: string;

  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  // BRAK pola hasła (pre-hijacking): konto powstaje bez hasła klienta, a hasło
  // ustawia się dopiero po kliknięciu linku z maila (potwierdzenie skrzynki).
  // Klient, który prześle "password", dostanie 400 (forbidNonWhitelisted).

  // --- firma ---
  // Nazwa formalna (do faktury) i nazwa wyświetlana (może być taka sama).
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_CHARS_MESSAGE })
  organizationLegalName!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_CHARS_MESSAGE })
  organizationName!: string;

  @Trim()
  @IsNip()
  taxId!: string;

  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_CHARS_MESSAGE })
  addressLine!: string;

  @Trim()
  @IsString()
  @Matches(PL_POSTAL_CODE_REGEX, { message: 'Kod pocztowy ma format NN-NNN.' })
  postalCode!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_CHARS_MESSAGE })
  city!: string;

  // Na start tylko PL: pole jest opcjonalne (domyślnie PL), ale jeśli klient je
  // prześle, musi być "PL".
  @IsOptional()
  @IsIn([REGISTRATION_COUNTRY], { message: 'Na razie obsługujemy wyłącznie firmy z Polski.' })
  country?: string;

  // --- zgody (dowód z wersją dokumentu zapisuje serwer) ---
  @IsBoolean()
  @Equals(true, { message: 'Akceptacja regulaminu jest wymagana.' })
  acceptTerms!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Akceptacja polityki prywatności jest wymagana.' })
  acceptPrivacyPolicy!: boolean;
}
