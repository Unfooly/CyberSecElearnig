import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// Sprawdzenie jednego kliknięcia (/check, D-132): wybór w trybie prostym (`option` - indeks odpowiedzi) albo werdykt karty SWIPE_SORT
// (`card` - nieprzejrzyste id karty z /start, `verdict`). Klient wysyła wyłącznie swój wybór - ocenę liczy serwer (evaluateCheck).
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class CheckBlockDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  option?: number;

  // Wielokrotny wybór (D-158): zaznaczone indeksy odpowiedzi. Powtórzenia i zakres bloku sprawdza evaluateCheck.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(7, { each: true })
  options?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(ID)
  card?: string;

  @IsOptional()
  @IsIn(['suspicious', 'ok'])
  verdict?: 'suspicious' | 'ok';
}
