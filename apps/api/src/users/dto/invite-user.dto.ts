import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '../name-pattern';
import { NormalizeEmail } from '../../common/transforms/normalize-email';
import { ASSIGNABLE_ROLES, Role } from '@cyberszkolo/shared';

export class InviteUserDto {
  @NormalizeEmail()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  lastName!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  departmentId?: string;

  // SUPER_ADMIN celowo wykluczony z ASSIGNABLE_ROLES - patrz komentarz przy
  // stałej w @cyberszkolo/shared.
  @IsIn(ASSIGNABLE_ROLES)
  role!: Role;
}
