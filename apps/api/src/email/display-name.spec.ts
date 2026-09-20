import { displayName } from './display-name';

describe('displayName', () => {
  it('zwykła nazwa bez zmian', () => {
    expect(displayName('Firma Testowa Sp. z o.o.')).toBe('Firma Testowa Sp. z o.o.');
  });

  it('przycina do 50 znaków z wielokropkiem (dokładnie 50 przechodzi, 51 jest cięte)', () => {
    expect(displayName('a'.repeat(50))).toBe('a'.repeat(50));
    const cut = displayName('a'.repeat(51));
    expect(Array.from(cut)).toHaveLength(50);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('usuwa znaki sterujące i nowe linie (także unicode: LS/PS, NEL, bidi, zero-width) oraz zwija białe znaki', () => {
    expect(displayName('Firma\r\nBcc: x@y.pl\tPilne kliknij‮​\u0085ok')).toBe('Firma Bcc: x@y.pl Pilne kliknij ok');
    expect(displayName('   a    b   ')).toBe('a b');
  });

  it('nie rozcina pary zastępczej (emoji) i nie-tekst daje pusty napis', () => {
    expect(Array.from(displayName('😀'.repeat(60)))).toHaveLength(50);
    expect(displayName(undefined)).toBe('');
    expect(displayName({ toString: () => 'x' })).toBe('');
  });
});
