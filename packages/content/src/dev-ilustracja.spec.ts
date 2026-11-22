import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModule } from './node';

// Moduł podglądu `dev-ilustracja` (D-200): przypadki layout-check (sekcja `monitor`, q7/q8). Harness czyta go samym schematem, bez
// semantyki - tu pełna walidacja, żeby zmiana reguł trybu prostego nie zepsuła po cichu przypadków layout-check (code review D-200).
describe('moduł podglądu dev-ilustracja (D-200)', () => {
  const parsed = parseModule(JSON.parse(readFileSync(join(__dirname, '..', 'dev-modules', 'dev-ilustracja', 'module.json'), 'utf8')));

  it('przechodzi pełną walidację; slajd, pytanie i wielokrotny wybór mają ilustrację z opisem', () => {
    expect(parsed.simpleMode).toBe(true);
    const illustrated = parsed.blocks.filter((block) => 'illustration' in block && block.illustration);
    expect(illustrated.map((block) => block.id)).toEqual(['tabela', 'instalowac', 'skutki']);
    for (const block of illustrated) {
      const illustration = (block as { illustration: { image: string; alt: string } }).illustration;
      expect(illustration.image).toMatch(/^images\/[a-z-]+\.webp$/);
      expect(illustration.alt.trim()).not.toBe('');
    }
  });
});
