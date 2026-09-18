import { IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  // Realny token to 64 znaki hex - limit z zapasem, jak w ResetPasswordDto.
  @IsString()
  @MaxLength(256)
  token!: string;
}
