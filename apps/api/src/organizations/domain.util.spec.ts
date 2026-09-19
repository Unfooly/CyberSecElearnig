import { emailDomain, generateDomainVerificationToken, normalizeDomain } from './domain.util';

describe('normalizeDomain', () => {
  it('akceptuje poddomeny i dodatkowe spacje', () => {
    expect(normalizeDomain('  sub.firma.com.pl ')).toBe('sub.firma.com.pl');
  });

  it('małe litery, bez końcowej kropki, IDN jako punycode', () => {
    expect(normalizeDomain('Firma.PL')).toBe('firma.pl');
    expect(normalizeDomain('firma.pl.')).toBe('firma.pl');
    expect(normalizeDomain('zażółć.pl')).toMatch(/^xn--/);
  });

  it.each(['', '   ', 'localhost', 'firma', '127.0.0.1', '1.2.3.4', 'fi rma.pl', '-firma.pl', 'firma-.pl', 'fir_ma.pl', 'a..pl'])(
    'odrzuca niepoprawną domenę %j',
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );

  it('odrzuca zbyt długie etykiety i domeny', () => {
    expect(normalizeDomain(`${'a'.repeat(64)}.pl`)).toBeNull();
    expect(normalizeDomain(`${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(20)}.pl`)).toBeNull();
  });
});

describe('emailDomain', () => {
  it('bierze domenę po ostatnim @ i normalizuje', () => {
    expect(emailDomain('Jan@Firma.PL')).toBe('firma.pl');
    expect(emailDomain('a@b@firma.pl')).toBe('firma.pl');
  });

  it('brak @ albo zła domena => null', () => {
    expect(emailDomain('brak-malpy')).toBeNull();
    expect(emailDomain('jan@localhost')).toBeNull();
  });
});

describe('generateDomainVerificationToken', () => {
  it('to 64 znaki hex (32 bajty), różne przy każdym wywołaniu', () => {
    const a = generateDomainVerificationToken();
    const b = generateDomainVerificationToken();

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
