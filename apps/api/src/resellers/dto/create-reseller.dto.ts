import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '../../users/name-pattern';
import { NormalizeEmail } from '../../common/transforms/normalize-email';

/** Założenie partnera przez operatora: nazwa firmy i dane jej pierwszego administratora (D-069). */
export class CreateResellerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  adminEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  adminFirstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  adminLastName!: string;
}
