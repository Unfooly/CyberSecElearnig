import { IsString, MaxLength } from 'class-validator';

export class UpdateAvatarDto {
  // Celowo tylko kształt (string, rozsądna długość) w DTO - właściwa reguła
  // biznesowa („wyłącznie preset z listy”, D-067) jest w
  // UsersService.assertValidAvatar, razem z resztą zasad dotyczących avatara.
  // Własne zdjęcie idzie osobną trasą (POST /users/me/avatar/image), a znacznik
  // `upload:<hash>` ustawia wyłącznie serwer - tędy nie da się go podać.
  @IsString()
  @MaxLength(64)
  avatarUrl!: string;
}
