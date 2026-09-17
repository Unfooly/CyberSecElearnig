import { describe, it, expect, vi } from 'vitest';
import { setAuthCookies, clearAuthCookies } from './auth-cookies';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from './config';

describe('setAuthCookies', () => {
  it('ustawia oba cookies jako httpOnly z poprawnym maxAge', () => {
    const set = vi.fn();
    setAuthCookies({ set }, { accessToken: 'access-value', refreshToken: 'refresh-value' });

    expect(set).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      'access-value',
      expect.objectContaining({ httpOnly: true, maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS }),
    );
    expect(set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-value',
      expect.objectContaining({ httpOnly: true, maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS }),
    );
    expect(set).toHaveBeenCalledTimes(2);
  });
});

describe('clearAuthCookies', () => {
  it('nadpisuje oba cookies pustą wartością i maxAge 0', () => {
    const set = vi.fn();
    clearAuthCookies({ set });

    expect(set).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
    expect(set).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, '', expect.objectContaining({ maxAge: 0 }));
  });
});
