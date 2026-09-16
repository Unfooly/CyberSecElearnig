import { IsInt, IsOptional, Min } from 'class-validator';

export class SubmitBlockProgressDto {
  @IsInt()
  @Min(0)
  blockIndex!: number;

  // Indeks wybranej opcji - wymagany dla bloków QUIZ/BRANCHING_SCENARIO,
  // ignorowany dla VIDEO/DRAG_AND_DROP. Serwer sam wylicza poprawność z
  // contentBlocks danego kursu (CoursesService) - DTO celowo NIE przyjmuje
  // pola "correct" ani żadnej oceny od klienta.
  @IsInt()
  @Min(0)
  @IsOptional()
  answer?: number;
}
