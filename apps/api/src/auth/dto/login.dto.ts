import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
