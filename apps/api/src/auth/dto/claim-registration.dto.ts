import { IsString, MaxLength } from 'class-validator';

export class ClaimRegistrationDto {
  // Token ma postać "<organizationId (uuid)>.<64 znaki hex>" (101 znaków) - limit z zapasem, jak w VerifyEmailDto.
  @IsString()
  @MaxLength(256)
  token!: string;
}
