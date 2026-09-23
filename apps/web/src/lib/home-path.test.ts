import { describe, it, expect } from 'vitest';
import { Role } from '@cyberszkolo/shared';
import { homePathForRole, resolveHomePath } from './home-path';

describe('homePathForRole', () => {
  it.each([
    [Role.ORG_ADMIN, '/dashboard'],
    // Role platformy mają własne panele (D-070); wysłanie ich na /courses kończyłoby się
    // pustym ekranem klienta, a nie tym, po co się logują.
    [Role.SUPER_ADMIN, '/dashboard/admin'],
    [Role.RESELLER_ADMIN, '/dashboard/reseller'],
    [Role.DEPARTMENT_MANAGER, '/courses'],
    [Role.EMPLOYEE, '/courses'],
    [undefined, '/courses'],
  ])('%s => %s', (role, path) => {
    expect(homePathForRole(role)).toBe(path);
  });
});

describe('resolveHomePath (allowlista - ochrona przed open redirect)', () => {
  it.each(['/dashboard', '/courses', '/onboarding', '/dashboard/admin', '/dashboard/reseller'])(
    'przepuszcza %s',
    (path) => {
      expect(resolveHomePath(path)).toBe(path);
    },
  );

  const hostile: string[] = [
    '//evil.com',
    '/\\evil.com',
    '/\\\\evil.com',
    '\\/evil.com',
    '/\t/evil.com',
    '/\r/evil.com',
    '/\n/evil.com',
    '/ /evil.com',
    '/@evil.com',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
    'javascript:alert(1)',
    'https://evil.com',
    'http://localhost:3000/dashboard',
    '/dashboard/',
    '/dashboard?x=1',
    '/dashboard#x',
    '/courses/../x',
    '',
  ];

  it.each(hostile)('odrzuca %j i zwraca /courses', (value) => {
    expect(resolveHomePath(value)).toBe('/courses');
  });

  it.each([undefined, null, 42, {}, ['/dashboard']])('odrzuca wartość nie-string (%j)', (value) => {
    expect(resolveHomePath(value)).toBe('/courses');
  });
});
