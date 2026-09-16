import { Role } from '@cyberszkolo/shared';

export class UserResponseDto {
  id!: string;
  email!: string;
  role!: Role;
  departmentId!: string | null;
  createdAt!: Date;
}
