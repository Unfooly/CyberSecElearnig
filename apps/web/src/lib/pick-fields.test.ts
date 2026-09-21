import { describe, it, expect } from 'vitest';
import { pickFields } from './pick-fields';

describe('pickFields', () => {
  it('przepuszcza tylko wymienione pola obecne w ciele (obce pola odcięte, wartości bez zmian)', () => {
    expect(pickFields({ a: 1, b: null, c: 'x', userId: 'obcy', organizationId: 'obca' }, ['a', 'b', 'd'])).toEqual({ a: 1, b: null });
  });

  it('brakujące pola nie pojawiają się (także jako undefined)', () => {
    const result = pickFields({ a: 1 }, ['a', 'b'])!;
    expect(Object.keys(result)).toEqual(['a']);
  });

  it.each([[null], [undefined], ['tekst'], [5], [[1, 2]], [true]])('ciało %j to nie obiekt: null', (body) => {
    expect(pickFields(body, ['a'])).toBeNull();
  });

  it('nie dziedziczy z prototypu i nie przenosi __proto__', () => {
    const body = JSON.parse('{"__proto__": {"role": "SUPER_ADMIN"}, "a": 1}');
    const result = pickFields(body, ['a', '__proto__', 'role'])!;
    expect(result.a).toBe(1);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });
});
