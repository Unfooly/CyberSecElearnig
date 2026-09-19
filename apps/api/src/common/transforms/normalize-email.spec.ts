import { normalizeEmailValue } from './normalize-email';

describe('normalizeEmailValue', () => {
  it('przycina, zamienia na małe litery', () => {
    expect(normalizeEmailValue('  Jan.Kowalski@Firma.PL ')).toBe('jan.kowalski@firma.pl');
  });

  it('domena IDN idzie w punycode, część lokalna bez zmian', () => {
    const idn = `Jan@B${String.fromCharCode(0xfc)}cher.de`;

    expect(normalizeEmailValue(idn)).toBe('jan@xn--bcher-kva.de');
    expect(normalizeEmailValue('jan@xn--bcher-kva.de')).toBe('jan@xn--bcher-kva.de');
  });

  it('używa ostatniego @ (część lokalna może zawierać @ w cudzysłowie)', () => {
    expect(normalizeEmailValue('"a@b"@Firma.pl')).toBe('"a@b"@firma.pl');
  });

  it('niepoprawna domena zostaje bez zmian (odrzuci ją walidator, nie transformacja)', () => {
    expect(normalizeEmailValue('jan@zła domena.pl')).toBe('jan@zła domena.pl');
    expect(normalizeEmailValue('brak-malpy')).toBe('brak-malpy');
  });
});
