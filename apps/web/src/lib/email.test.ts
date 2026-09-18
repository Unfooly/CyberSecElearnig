import { describe, it, expect } from 'vitest';
import { EMAIL_REGEX } from './email';

describe('EMAIL_REGEX', () => {
  it('akceptuje zwykłe adresy ASCII', () => {
    expect(EMAIL_REGEX.test('adrian.pozniak@aries-it.pl')).toBe(true);
    expect(EMAIL_REGEX.test('a+tag@sub.firma.co.uk')).toBe(true);
  });

  it('odrzuca znaki spoza ASCII w części lokalnej (np. "poźniak" - dostawca ich nie przyjmuje)', () => {
    expect(EMAIL_REGEX.test('adrian.poźniak@aries-it.pl')).toBe(false);
  });

  it('odrzuca kropki na początku/końcu i podwójne kropki w części lokalnej (tak jak backend)', () => {
    expect(EMAIL_REGEX.test('a..b@x.pl')).toBe(false);
    expect(EMAIL_REGEX.test('.a@x.pl')).toBe(false);
    expect(EMAIL_REGEX.test('a.@x.pl')).toBe(false);
  });

  it('odrzuca adresy bez domeny, ze spacją i bez @', () => {
    expect(EMAIL_REGEX.test('jan@')).toBe(false);
    expect(EMAIL_REGEX.test('jan kowalski@firma.pl')).toBe(false);
    expect(EMAIL_REGEX.test('jan.firma.pl')).toBe(false);
  });
});
