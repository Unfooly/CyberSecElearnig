import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@cyberszkolo/shared';
import { RolesGuard } from './roles.guard';

function createContext(user: { role: Role } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('przepuszcza użytkownika z wymaganą rolą', () => {
    const reflector = { getAllAndOverride: () => [Role.ORG_ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ role: Role.ORG_ADMIN }))).toBe(true);
  });

  it('odrzuca użytkownika bez wymaganej roli (przypadek brzegowy)', () => {
    const reflector = { getAllAndOverride: () => [Role.ORG_ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(createContext({ role: Role.EMPLOYEE }))).toThrow(
      ForbiddenException,
    );
  });

  it('przepuszcza każdego, gdy endpoint nie deklaruje wymaganych ról', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext(undefined))).toBe(true);
  });
});
