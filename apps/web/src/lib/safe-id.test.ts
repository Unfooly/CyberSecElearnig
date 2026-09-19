import { describe, it, expect } from 'vitest';
import { isSafeId } from './safe-id';

describe('isSafeId', () => {
  it.each(['cmu875z6i0010obovfcf94iqy', 'phishtpl_kurier', 'a-b_C1'])('przepuszcza %s', (id) => {
    expect(isSafeId(id)).toBe(true);
  });

  it.each(['', '..', '../x', 'a/b', 'a b', 'a?b', 'a%2fb', 'a.b', 'a'.repeat(65), 12, null, undefined, {}])('odrzuca %j', (id) => {
    expect(isSafeId(id)).toBe(false);
  });
});
