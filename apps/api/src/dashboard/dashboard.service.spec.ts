import { escapeCsvField, toCsv } from './dashboard.service';

describe('escapeCsvField', () => {
  it('zwraca zwykły tekst bez zmian', () => {
    expect(escapeCsvField('Jan Kowalski')).toBe('Jan Kowalski');
  });

  it('cytuje pole zawierające przecinek', () => {
    expect(escapeCsvField('IT, Bezpieczeństwo')).toBe('"IT, Bezpieczeństwo"');
  });

  it('cytuje i podwaja cudzysłowy w polu zawierającym cudzysłów', () => {
    expect(escapeCsvField('Dział "Specjalny"')).toBe('"Dział ""Specjalny"""');
  });

  it('cytuje pole zawierające znak nowej linii', () => {
    expect(escapeCsvField('Linia 1\nLinia 2')).toBe('"Linia 1\nLinia 2"');
  });

  it('cytuje pole zawierające CRLF', () => {
    expect(escapeCsvField('Linia 1\r\nLinia 2')).toBe('"Linia 1\r\nLinia 2"');
  });
});

describe('toCsv', () => {
  it('łączy wiersze CRLF i dodaje końcowy CRLF (RFC4180)', () => {
    const csv = toCsv([
      ['Email', 'Dział'],
      ['jan@example.test', 'IT'],
    ]);
    expect(csv).toBe('Email,Dział\r\njan@example.test,IT\r\n');
  });

  it('poprawnie serializuje wiersz z polem wymagającym cytowania, nie łamiąc struktury kolumn', () => {
    const csv = toCsv([
      ['Email', 'Dział'],
      ['jan@example.test', 'Sprzedaż, Marketing'],
    ]);
    expect(csv).toBe('Email,Dział\r\njan@example.test,"Sprzedaż, Marketing"\r\n');
  });
});
