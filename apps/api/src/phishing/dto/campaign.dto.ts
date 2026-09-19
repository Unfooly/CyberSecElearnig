import { PhishingAudienceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, Equals, IsArray, IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Trim } from '../../common/transforms/trim';

// Nazwy: bez znaków sterujących/formatujących (jak w szablonach).
const NO_CONTROL_CHARS = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const CAMPAIGN_LIMITS = { name: 120, maxRecipients: 5000, maxDepartments: 200 } as const;

export class AudienceDto {
  @IsEnum(PhishingAudienceType)
  type!: PhishingAudienceType;

  // Wymagane dla type = DEPARTMENTS (spójność typu i list sprawdza serwis; nadmiarowe listy => 400).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CAMPAIGN_LIMITS.maxDepartments)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SAFE_ID, { each: true, message: 'Nieprawidłowy identyfikator.' })
  departmentIds?: string[];

  // Wymagane dla type = USERS.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CAMPAIGN_LIMITS.maxRecipients)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SAFE_ID, { each: true, message: 'Nieprawidłowy identyfikator.' })
  userIds?: string[];
}

export class AudiencePreviewDto {
  @ValidateNested()
  @Type(() => AudienceDto)
  audience!: AudienceDto;
}

export class CreateCampaignDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(CAMPAIGN_LIMITS.name)
  @Matches(NO_CONTROL_CHARS, { message: 'Pole zawiera niedozwolone znaki.' })
  name!: string;

  @IsString()
  @Matches(SAFE_ID, { message: 'Nieprawidłowy identyfikator.' })
  templateId!: string;

  @ValidateNested()
  @Type(() => AudienceDto)
  audience!: AudienceDto;

  // Okno wysyłki (ISO 8601, ze strefą): każdy odbiorca dostaje mail w losowym momencie w tym oknie.
  @IsISO8601({ strict: true })
  windowStart!: string;

  @IsISO8601({ strict: true })
  windowEnd!: string;

  // Potwierdzenie ostrzeżenia z kreatora (liczba odbiorców, okno, nadawca) - bez niego kampania nie startuje.
  @Equals(true, { message: 'Potwierdź uruchomienie kampanii.' })
  acknowledged!: boolean;
}
