import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShuffleSeed, toClientBlock } from './index';
import { hashContent, moduleWarnings, parseModule } from './node';

// Moduł 1 („Wyłudzone hasło”, schemaVersion 5) BEZ ZMIAN bajt w bajt po schemacie v6 (faza 1a modułu 2, format wielojęzyczny).
// Sumy SHA-256 policzone na kodzie SPRZED v6 (main 4314519): parsowany moduł, skrót treści (import, wersje kursu), odpowiedź
// /start (toClientBlock każdego bloku ze stałym kontekstem) i ostrzeżenia importu. Zmiana którejkolwiek sumy = zmiana zachowania
// dla istniejącej treści - wolno ją zaktualizować wyłącznie świadomą decyzją (nowy wpis D-xxx), nigdy „żeby test przeszedł”.
// Aktualizacje: D-116 (sceny pionowe korytarza i biura Anny - imagePortrait + portraitHotspots, prostokąt ekranu pulpitu
// `media.scene.screen`; parsed, contentHash i clientBlocks nowe, ostrzeżenia bez zmian).
const MODULE_1 = join(__dirname, '..', 'modules', 'wyludzone-haslo', 'module.json');

const context = {
  shuffleSeed: (blockId: string): ShuffleSeed => [blockId.length, 7, 11, 13],
  opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}`,
};

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const GOLDEN = {
  parsed: '6cde9ca83be1df9742744bf1737370bdc46e72b5452af4e8d0d1ca560918b6db',
  contentHash: '4471bebd654be62d0cda241c33cb1f920ee96871b020bf9ecc6eebfc24049ffc',
  clientBlocks: '4f22409f40bcda32ec6217cd647cc82edc698402c8ff7f7e8cdd2257f0bd4b96',
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
