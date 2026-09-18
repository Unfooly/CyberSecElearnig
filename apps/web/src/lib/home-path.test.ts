import { describe, it, expect } from 'vitest';
import { Role } from '@cyberszkolo/shared';
import { homePathForRole } from './home-path';

describe('homePathForRole', () => {
  it.each([
    [Role.ORG_ADMIN, '/dashboard'],
    [Role.SUPER_ADMIN, '/courses'],
    [Role.DEPARTMENT_MANAGER, '/courses'],
    [Role.EMPLOYEE, '/courses'],
    [undefined, '/courses'],
  ])('%s => %s', (role, path) => {
    expect(homePathForRole(role)).toBe(path);
  });
});
