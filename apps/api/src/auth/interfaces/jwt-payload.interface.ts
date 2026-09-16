import { Role } from '@cyberszkolo/shared';

export interface JwtPayload {
  sub: string;
  organizationId: string;
  role: Role;
  email: string;
}

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
}
