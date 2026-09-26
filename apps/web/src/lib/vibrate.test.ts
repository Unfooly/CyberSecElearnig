import { describe, it, expect, vi, afterEach } from 'vitest';
import { vibrate } from './vibrate';

describe('vibrate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('woła navigator.vibrate z podanym wzorcem, gdy API jest dostępne', () => {
    const spy = vi.fn();
    vi.stubGlobal('navigator', { vibrate: spy });
    vibrate(10);
    expect(spy).toHaveBeenCalledWith(10);
  });

  it('brak navigator.vibrate (Safari itp.): nie wyrzuca błędu', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibrate(10)).not.toThrow();
  });

  it('navigator.vibrate rzuca (zablokowane przez przeglądarkę): nie propaguje błędu', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => vibrate(10)).not.toThrow();
  });
});
