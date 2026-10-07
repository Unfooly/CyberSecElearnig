import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { CONTENT_LOCALES } from '@cyberszkolo/content';

// Preferencje WŁASNEGO konta. Każde pole opcjonalne (zapis tylko podanych); pusty zapis odrzuca serwis. ValidationPipe (whitelist +
// forbidNonWhitelisted) odrzuca każde pole spoza DTO, więc nie da się tędy zmienić np. roli, organizacji ani avatara.
// ValidateIf zamiast IsOptional: pominięte pole jest w porządku, ale `null` to błąd walidacji (IsOptional przepuszczałby je po cichu).
const present = (_: object, value: unknown) => value !== undefined;

export class UpdatePreferencesDto {
  @ValidateIf(present)
  @IsBoolean()
  narrationEnabled?: boolean;

  // „Bez limitów czasu” (WCAG 2.2.1, D-124): rozmowa na żywo bez odliczania i bez krawędzi ciszy.
  @ValidateIf(present)
  @IsBoolean()
  noTimeLimits?: boolean;

  // Język szkoleń (D-133): obsługiwany język treści albo null - „wg przeglądarki” (Accept-Language, potem EN).
  @ValidateIf(present)
  @IsIn([...CONTENT_LOCALES, null])
  contentLocale?: string | null;
}
