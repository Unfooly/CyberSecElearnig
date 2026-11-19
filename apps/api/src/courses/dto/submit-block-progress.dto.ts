import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class SubmitBlockProgressDto {
  @IsInt()
  @Min(0)
  blockIndex!: number;

  // Id bloku, który gracz widział (D-177, publiczne - jak w /start). Serwer porównuje go z blokiem pod `blockIndex` w przypiętej wersji:
  // niezgodność = treść zmieniła się pod otwartą kartą (przejście na nową wersję przy /start w innej karcie) - 409 zamiast oceny odpowiedzi
  // na innym bloku. Opcjonalne (starsze karty bez pola dalej działają jak dotąd).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
  blockId?: string;

  // Odpowiedź zależy od typu bloku: indeks wybranej opcji (QUIZ/BRANCHING_SCENARIO) albo obiekt z listą id
  // ({ visited } / { asked } / { opened } / { selected } / { order }); dla bloków bez odpowiedzi pomijana. Kształt waliduje
  // serwer wg typu bloku z zapisanej wersji kursu (evaluateSubmit). Serwer sam wylicza poprawność i punkty - DTO celowo NIE
  // przyjmuje pola "correct" ani żadnej oceny od klienta.
  @IsOptional()
  answer?: unknown;
}
