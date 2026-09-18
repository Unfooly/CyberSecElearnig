import { Role, UserStatus } from '@cyberszkolo/shared';

export class UserResponseDto {
  id!: string;
  email!: string;
  firstName!: string | null;
  lastName!: string | null;
  role!: Role;
  status!: UserStatus;
  department!: { id: string; name: string } | null;
  createdAt!: Date;
}
