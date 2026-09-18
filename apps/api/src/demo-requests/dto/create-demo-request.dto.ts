import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateDemoRequestDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  employeeCount!: number;

  // Pułapka na boty (pole ukryte w formularzu) - człowiek go nie wypełni.
  // Wypełnione => udajemy sukces, ale nic nie wysyłamy.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
