import { IsInt, IsOptional, Min } from 'class-validator';

export class SubmitBlockProgressDto {
  @IsInt()
  @Min(0)
  blockIndex!: number;

  // Odpowiedź zależy od typu bloku: indeks wybranej opcji (QUIZ/BRANCHING_SCENARIO) albo obiekt z listą id
  // ({ visited } / { asked } / { opened } / { selected } / { order }); dla bloków bez odpowiedzi pomijana. Kształt waliduje
  // serwer wg typu bloku z zapisanej wersji kursu (evaluateSubmit). Serwer sam wylicza poprawność i punkty - DTO celowo NIE
  // przyjmuje pola "correct" ani żadnej oceny od klienta.
  @IsOptional()
  answer?: unknown;
}
