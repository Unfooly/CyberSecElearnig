import { IsBoolean } from 'class-validator';

// Preferencje WŁASNEGO konta. Dziś jedno pole; kolejne dojdą jako opcjonalne. ValidationPipe (whitelist + forbidNonWhitelisted) odrzuca
// każde pole spoza DTO, więc nie da się tędy zmienić np. roli, organizacji ani avatara.
export class UpdatePreferencesDto {
  @IsBoolean()
  narrationEnabled!: boolean;
}
