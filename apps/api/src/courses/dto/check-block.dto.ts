import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// Sprawdzenie jednego kliknięcia (/check, D-132): wybór w trybie prostym (`option` - indeks odpowiedzi) albo werdykt karty SWIPE_SORT
// (`card` - nieprzejrzyste id karty z /start, `verdict`). Klient wysyła wyłącznie swój wybór - ocenę liczy serwer (evaluateCheck).
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class CheckBlockDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  option?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(ID)
  card?: string;

  @IsOptional()
  @IsIn(['suspicious', 'ok'])
  verdict?: 'suspicious' | 'ok';
}
