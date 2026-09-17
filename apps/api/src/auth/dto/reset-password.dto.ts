import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  // Realny token to 64 znaki hex (32 losowe bajty, patrz
  // AuthService.hashResetToken/forgotPassword) - limit z zapasem, głównie
  // żeby odrzucić rażąco za długi string PRZED przekazaniem go do
  // createHash (marginalny wektor DoS, znaleziony w security review).
  @IsString()
  @MaxLength(256)
  token!: string;

  // Potwierdzenie hasła to wyłącznie walidacja frontendowa (UX) - backend
  // dostaje tylko finalną wartość, tak jak RegisterDto.
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
