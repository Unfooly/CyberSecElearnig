import { IsEmail } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email';

export class ResendVerificationDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  email!: string;
}
