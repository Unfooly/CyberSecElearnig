import { parseCsv } from './csv.util';

describe('parseCsv', () => {
  it('parsuje prosty plik bez cudzysłowów', () => {
    const csv = 'email,firstName,lastName,departmentName\njan@example.test,Jan,Kowalski,IT\n';
    expect(parseCsv(csv)).toEqual([
      ['email', 'firstName', 'lastName', 'departmentName'],
      ['jan@example.test', 'Jan', 'Kowalski', 'IT'],
    ]);
  });

  it('obsługuje pole w cudzysłowie z przecinkiem w środku', () => {
    const csv = 'email,departmentName\njan@example.test,"Sprzedaż, Marketing"\n';
    expect(parseCsv(csv)).toEqual([
      ['email', 'departmentName'],
      ['jan@example.test', 'Sprzedaż, Marketing'],
    ]);
  });

  it('obsługuje escapowany cudzysłów "" wewnątrz pola', () => {
    const csv = 'name\n"Dział ""Specjalny"""\n';
    expect(parseCsv(csv)).toEqual([['name'], ['Dział "Specjalny"']]);
  });

  it('obsługuje plik bez końcowego znaku nowej linii', () => {
    const csv = 'email\njan@example.test';
    expect(parseCsv(csv)).toEqual([['email'], ['jan@example.test']]);
  });

  it('zwraca pustą listę dla pustego pliku', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parsuje sam nagłówek bez wierszy danych', () => {
    expect(parseCsv('email,firstName\n')).toEqual([['email', 'firstName']]);
  });

  it('ignoruje BOM przed cudzysłowem w nagłówku (Excel CSV UTF-8)', () => {
    expect(parseCsv('﻿"email","firstName"\njan@example.test,Jan\n')).toEqual([
      ['email', 'firstName'],
      ['jan@example.test', 'Jan'],
    ]);
  });

  it('wykrywa średnik jako separator (polski Excel)', () => {
    expect(parseCsv('email;firstName;lastName\njan@example.test;Jan;Kowalski\n')).toEqual([
      ['email', 'firstName', 'lastName'],
      ['jan@example.test', 'Jan', 'Kowalski'],
    ]);
  });

  it('rzuca błąd dla niesparowanego cudzysłowu (uszkodzony plik)', () => {
    expect(() => parseCsv('email\n"jan@example.test\n')).toThrow(/cudzysł/i);
  });

  it('rzuca błąd dla cudzysłowu w środku niecudzysłowionego pola', () => {
    expect(() => parseCsv('email\nJan"Kowalski\n')).toThrow(/cudzysł/i);
  });
});
