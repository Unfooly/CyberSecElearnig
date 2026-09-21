import { IsString, MaxLength } from 'class-validator';

export class AttemptBlockDto {
  // Odpowiedź tekstowa do bloku TEXT_INPUT_GUIDED. Limit długości chroni też dopasowanie regex po stronie serwera.
  @IsString()
  @MaxLength(500)
  answer!: string;
}
