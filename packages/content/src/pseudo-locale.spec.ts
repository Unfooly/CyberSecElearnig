import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_LOCALES } from './common';
import { PSEUDO_EXPANSION, PSEUDO_LOCALE, pseudoLocalize } from './pseudo-locale';

// Generator pseudo-lokalizacji `xx` (D-143). Kontrole scen w xx: scripts/content/scenes/pseudo-locale.test.ts.
describe('pseudoLocalize (D-143)', () => {
  it('akcenty, nawiasy [ ], sufiks ~ w słowach po najwyżej 5 znaków, co najmniej 135% długości', () => {
    expect(pseudoLocalize('Łańcuszek przerwany.')).toBe('[Łáńçüšžék pržérwáñý. ~~~~]');
    expect(pseudoLocalize('SPRAWA')).toBe('[ŠPRÁWÁ ~~~]');
    const long = 'Nie klikaj w linki z nieznanych wiadomości, nawet gdy piszą znajomi z pracy.';
    const out = pseudoLocalize(long);
    expect([...out].length).toBeGreaterThanOrEqual(Math.ceil([...long].length * (1 + PSEUDO_EXPANSION)));
    expect(out).toMatch(/^\[.+ ~{1,5}(?: ~{1,5})*\]$/);
    expect(out).not.toMatch(/~{6}/);
  });

  it('tekst bez liter bez zmian; własne kryterium „bez języka” przez parametr', () => {
    for (const text of ['100%', '7/7', '???', '12:30', '']) expect(pseudoLocalize(text)).toBe(text);
    expect(pseudoLocalize('12 3XX', /^[\dX\s]*$/)).toBe('12 3XX');
  });

  it('xx nie jest językiem treści', () => {
    expect((CONTENT_LOCALES as readonly string[]).includes(PSEUDO_LOCALE)).toBe(false);
  });

  it('plik bez importów (kompozytor bierze go ścieżką względną, bez zbudowanego pakietu)', () => {
    expect(readFileSync(join(__dirname, 'pseudo-locale.ts'), 'utf8')).not.toMatch(/^import /m);
  });
});
