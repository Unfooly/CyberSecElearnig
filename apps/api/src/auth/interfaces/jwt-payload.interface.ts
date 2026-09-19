import { Role } from '@cyberszkolo/shared';

export interface JwtPayload {
  sub: string;
  organizationId: string;
  role: Role;
  email: string;
  // Access token: chwila wydania w ms (iat ma tylko sekundy) - porównywana z
  // sessionsRevokedAt ("wyloguj wszędzie"). Tokeny sprzed tego pola: iat * 1000.
  iatMs?: number;
  // Refresh token: rodzina sesji i unikalny identyfikator tokenu.
  fid?: string;
  jti?: string;
  // Standardowe (dodawane przez jsonwebtoken).
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
}
