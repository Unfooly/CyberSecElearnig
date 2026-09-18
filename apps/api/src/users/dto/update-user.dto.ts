import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { NAME_PATTERN, NAME_PATTERN_MESSAGE } from '../name-pattern';
import { ASSIGNABLE_ROLES, Role } from '@cyberszkolo/shared';

// Bez email - zmiana e-maila (login/tożsamość konta) jest poza zakresem
// tego endpointu, patrz plan zadania "Zarządzanie i zapraszanie pracowników".
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NAME_PATTERN, { message: NAME_PATTERN_MESSAGE })
  lastName?: string;

  // null = usuń przypisanie do działu, undefined = nie zmieniaj. Pusty string
  // jest odrzucany (inaczej ominąłby sprawdzenie własności działu, bo jest
  // falsy, i wywalił FK jako 500).
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @IsNotEmpty()
  departmentId?: string | null;

  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: Role;
}
