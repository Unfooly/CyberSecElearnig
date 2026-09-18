import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  email!: string;
}
