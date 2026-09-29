import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShuffleSeed, toClientBlock } from './index';
import { hashContent, moduleWarnings, parseModule } from './node';

// Moduł 1 („Wyłudzone hasło”, schemaVersion 5) BEZ ZMIAN bajt w bajt po schemacie v6 (faza 1a modułu 2, format wielojęzyczny).
// Sumy SHA-256 policzone na kodzie SPRZED v6 (main 4314519): parsowany moduł, skrót treści (import, wersje kursu), odpowiedź
// /start (toClientBlock każdego bloku ze stałym kontekstem) i ostrzeżenia importu. Zmiana którejkolwiek sumy = zmiana zachowania
// dla istniejącej treści - wolno ją zaktualizować wyłącznie świadomą decyzją (nowy wpis D-xxx), nigdy „żeby test przeszedł”.
const MODULE_1 = join(__dirname, '..', 'modules', 'wyludzone-haslo', 'module.json');

const context = {
  shuffleSeed: (blockId: string): ShuffleSeed => [blockId.length, 7, 11, 13],
  opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}`,
};

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const GOLDEN = {
  parsed: 'e4c4cdd61ba9bdcc95fe32d6d2d7df4fd5f9c4c1db13ceeece026d55ef1bad57',
  contentHash: '504fe17f55e0920c77e66c4363930a27b60465fe197f4c3b69769f38eed7f8f5',
  clientBlocks: '62b86b4269bc6d6647324eb8649d60d9a2459de4a68557df2b7747a98ebac50b',
  warnings: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
};

describe('moduł 1 bez zmian po schemacie v6 (bajt w bajt)', () => {
  const raw = JSON.parse(readFileSync(MODULE_1, 'utf8'));
  const parsed = parseModule(raw);

  it('parsowany moduł, skrót treści, odpowiedź /start i ostrzeżenia importu mają sumy sprzed v6', () => {
    const actual = {
      parsed: sha(parsed),
      contentHash: hashContent(parsed.blocks),
      clientBlocks: sha(parsed.blocks.map((block) => toClientBlock(block as Record<string, unknown>, context))),
      warnings: sha(moduleWarnings(parsed)),
    };
    expect(actual).toEqual(GOLDEN);
  });
});
