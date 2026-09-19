import { isPublicEmailDomain, isValidNip, normalizeNip, PUBLIC_EMAIL_DOMAINS } from '@cyberszkolo/shared';

// Reguły z @cyberszkolo/shared współdzielone z frontendem - testowane tu, bo
// pakiet shared nie ma własnego runnera testów.
describe('NIP (suma kontrolna)', () => {
  it.each(['5260250274', '526-025-02-74', '526 025 02 74', 'PL5260250274', 'pl 526-025-02-74', '1234563218', '9542751368'])(
    'przyjmuje poprawny NIP %s',
    (nip) => {
      expect(isValidNip(nip)).toBe(true);
    },
  );

  it.each([
    ['zła cyfra kontrolna', '5260250275'],
    ['reszta 10 (nieprawidłowy z definicji)', '1234567890'],
    ['za krótki', '526025027'],
    ['za długi', '52602502744'],
    ['litery', '52602502AB'],
    ['same zera', '0000000000'],
    ['same jedynki', '1111111111'],
    ['pusty', ''],
    ['tylko separatory', '- -'],
  ])('odrzuca: %s (%s)', (_label, nip) => {
    expect(isValidNip(nip)).toBe(false);
  });

  it('normalizeNip zwraca same cyfry albo null', () => {
    expect(normalizeNip('526-025-02-74')).toBe('5260250274');
    expect(normalizeNip('PL 5260250274')).toBe('5260250274');
    expect(normalizeNip('123')).toBeNull();
  });
});

describe('domeny publiczne', () => {
  it.each(['gmail.com', 'wp.pl', 'o2.pl', 'onet.pl', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'yahoo.com'])(
    'zawiera %s',
    (domain) => {
      expect(isPublicEmailDomain(domain)).toBe(true);
    },
  );

  it('nie oznacza domen firmowych jako publicznych', () => {
    expect(isPublicEmailDomain('firma.pl')).toBe(false);
    expect(isPublicEmailDomain('gmail.com.firma.pl')).toBe(false);
  });

  it('lista jest znormalizowana (małe litery) i bez duplikatów', () => {
    expect(PUBLIC_EMAIL_DOMAINS.every((d) => d === d.toLowerCase() && !d.endsWith('.'))).toBe(true);
    expect(new Set(PUBLIC_EMAIL_DOMAINS).size).toBe(PUBLIC_EMAIL_DOMAINS.length);
  });
});
