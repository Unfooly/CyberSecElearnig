import { IsString, MaxLength } from 'class-validator';

export class UpdateAvatarDto {
  // Celowo tylko kształt (string, rozsądna długość) w DTO - właściwa reguła
  // biznesowa ("preset z listy ALBO poprawny URL http/https") jest w
  // UsersService.assertValidAvatar, bo class-validator nie ma czytelnego
  // sposobu wyrażenia takiej alternatywy deklaratywnie.
  @IsString()
  @MaxLength(2048)
  avatarUrl!: string;
}
