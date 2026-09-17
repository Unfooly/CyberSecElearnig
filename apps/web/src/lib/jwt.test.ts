import { describe, it, expect } from 'vitest';
import { Role } from '@cyberszkolo/shared';
import { decodeJwtPayload, isExpired, type JwtPayload } from './jwt';

function encodeBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fakeJwt(payload: unknown): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

const validPayload: JwtPayload = {
  sub: 'user-1',
  organizationId: 'org-1',
  role: Role.ORG_ADMIN,
  email: 'admin@example.test',
  exp: Math.floor(Date.now() / 1000) + 900,
};

describe('decodeJwtPayload', () => {
  it('dekoduje poprawny payload', () => {
    const payload = decodeJwtPayload(fakeJwt(validPayload));
    expect(payload).toEqual(validPayload);
  });

  it('zwraca null dla tokena bez trzech segmentów', () => {
    expect(decodeJwtPayload('tylko-jeden-segment')).toBeNull();
    expect(decodeJwtPayload('dwa.segmenty')).toBeNull();
  });

  it('zwraca null dla niepoprawnego base64 w części payload', () => {
    expect(decodeJwtPayload('header.!!!niepoprawny-base64!!!.sig')).toBeNull();
  });

  it('zwraca null, gdy payload nie jest poprawnym JSON-em', () => {
    const header = encodeBase64Url(JSON.stringify({ alg: 'none' }));
    const body = encodeBase64Url('to nie jest json');
    expect(decodeJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('zwraca null, gdy brakuje pola exp (niekompletny payload nie jest "ważny domyślnie")', () => {
    const { exp: _exp, ...withoutExp } = validPayload;
    expect(decodeJwtPayload(fakeJwt(withoutExp))).toBeNull();
  });

  it('zwraca null dla nieznanej wartości role', () => {
    expect(decodeJwtPayload(fakeJwt({ ...validPayload, role: 'NIEISTNIEJACA_ROLA' }))).toBeNull();
  });

  it('zwraca null, gdy payload to tablica albo prymityw zamiast obiektu', () => {
    const header = encodeBase64Url(JSON.stringify({ alg: 'none' }));
    expect(decodeJwtPayload(`${header}.${encodeBase64Url('[1,2,3]')}.sig`)).toBeNull();
    expect(decodeJwtPayload(`${header}.${encodeBase64Url('"just a string"')}.sig`)).toBeNull();
  });
});

describe('isExpired', () => {
  it('zwraca false dla tokena ważnego jeszcze długo', () => {
    const payload: JwtPayload = { ...validPayload, exp: Math.floor(Date.now() / 1000) + 900 };
    expect(isExpired(payload)).toBe(false);
  });

  it('zwraca true dla tokena, który już wygasł', () => {
    const payload: JwtPayload = { ...validPayload, exp: Math.floor(Date.now() / 1000) - 10 };
    expect(isExpired(payload)).toBe(true);
  });

  it('zwraca true dla tokena wygasającego w granicy skew (domyślnie 30s)', () => {
    const payload: JwtPayload = { ...validPayload, exp: Math.floor(Date.now() / 1000) + 10 };
    expect(isExpired(payload)).toBe(true);
  });
});
