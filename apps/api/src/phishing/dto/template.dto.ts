import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/transforms/trim';

// Nagłówki maila i nazwy: bez znaków sterujących/formatujących (wstrzyknięcie nagłówków, spoofing
// kierunku pisma) - jak w RegisterDto. Nazwa nadawcy dodatkowo bez < > " (trafia do nagłówka From).
const NO_CONTROL_CHARS = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
const NO_CONTROL_MESSAGE = 'Pole zawiera niedozwolone znaki.';
const SENDER_NAME = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>"]*$/u;
// Część lokalna adresu nadawcy (domena jest zawsze nasza): małe litery, cyfry, . _ - ; bez ".."
export const LOCAL_PART_REGEX = /^(?!.*\.\.)[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

export const TEMPLATE_LIMITS = { name: 120, subject: 200, senderName: 80, localPart: 64, body: 20_000, lesson: 10_000 } as const;

export class CloneTemplateDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(TEMPLATE_LIMITS.name)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_MESSAGE })
  name?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(TEMPLATE_LIMITS.name)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_MESSAGE })
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(TEMPLATE_LIMITS.subject)
  @Matches(NO_CONTROL_CHARS, { message: NO_CONTROL_MESSAGE })
  subject?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(TEMPLATE_LIMITS.senderName)
  @Matches(SENDER_NAME, { message: 'Nazwa nadawcy zawiera niedozwolone znaki.' })
  senderName?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(TEMPLATE_LIMITS.localPart)
  @Matches(LOCAL_PART_REGEX, {
    message: 'Część lokalna adresu: małe litery, cyfry oraz . _ - (bez podwójnych kropek, zaczyna i kończy się literą lub cyfrą).',
  })
  senderLocalPart?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(TEMPLATE_LIMITS.body)
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(TEMPLATE_LIMITS.lesson)
  lessonHtml?: string;
}

// Podgląd "co zostanie po sanityzacji" - nic nie zapisuje.
export class PreviewTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_LIMITS.body)
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_LIMITS.lesson)
  lessonHtml?: string;
}
