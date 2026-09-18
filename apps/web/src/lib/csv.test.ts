import { describe, it, expect } from 'vitest';
import { parseCsv, buildCsvPreview } from './csv';

describe('parseCsv', () => {
  it('parsuje prosty plik bez cudzysłowów', () => {
    expect(parseCsv('email,firstName\njan@test.pl,Jan\n')).toEqual([
      ['email', 'firstName'],
      ['jan@test.pl', 'Jan'],
    ]);
  });

  it('obsługuje pole w cudzysłowie z przecinkiem', () => {
    expect(parseCsv('a,b\n1,"x, y"\n')).toEqual([
      ['a', 'b'],
      ['1', 'x, y'],
    ]);
  });

  it('ignoruje BOM i obsługuje średnik jako separator', () => {
    expect(parseCsv('﻿"a";"b"\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rzuca błąd dla niesparowanego cudzysłowu', () => {
    expect(() => parseCsv('a\n"1\n')).toThrow(/cudzysł/i);
  });
});

describe('buildCsvPreview', () => {
  it('rozdziela poprawne i niepoprawne wiersze', () => {
    const csv =
      'email,firstName,lastName,departmentName\n' +
      'jan@test.pl,Jan,Kowalski,IT\n' +
      'zly-email,Anna,Nowak,\n' +
      'brak@test.pl,,Zajac,\n';

    const preview = buildCsvPreview(csv);

    expect(preview.fileError).toBeNull();
    expect(preview.validRows).toEqual([
      { line: 2, email: 'jan@test.pl', firstName: 'Jan', lastName: 'Kowalski', departmentName: 'IT', error: null },
    ]);
    expect(preview.invalidRows).toHaveLength(2);
    expect(preview.invalidRows[0].error).toMatch(/e-maila/i);
    expect(preview.invalidRows[1].error).toMatch(/imienia lub nazwiska/i);
  });

  it('oznacza jako błąd imię będące frazą phishingową (allowlista znaków)', () => {
    const preview = buildCsvPreview('email,firstName,lastName\nok@test.pl,Jan,Kowalski\nx@test.pl,"Konto zablokowane http://x.pl",K\n');
    expect(preview.validRows).toHaveLength(1);
    expect(preview.invalidRows[0].error).toMatch(/niedozwolone znaki/i);
  });

  it('zgłasza błąd pliku, gdy w nagłówku brakuje wymaganych kolumn', () => {
    const preview = buildCsvPreview('email,firstName\njan@test.pl,Jan\n');
    expect(preview.fileError).toMatch(/lastName/i);
    expect(preview.validRows).toHaveLength(0);
  });

  it('zgłasza błąd pliku dla strukturalnie uszkodzonego CSV', () => {
    const preview = buildCsvPreview('email,firstName,lastName\n"jan@test.pl,Jan,Kowalski\n');
    expect(preview.fileError).toMatch(/cudzysł/i);
  });

  it('zgłasza błąd pliku dla pustego pliku', () => {
    const preview = buildCsvPreview('');
    expect(preview.fileError).toMatch(/pusty/i);
  });

  it('pomija całkowicie puste wiersze bez oznaczania ich jako błąd', () => {
    const csv = 'email,firstName,lastName\njan@test.pl,Jan,Kowalski\n,,\n';
    const preview = buildCsvPreview(csv);
    expect(preview.validRows).toHaveLength(1);
    expect(preview.invalidRows).toHaveLength(0);
  });
});
