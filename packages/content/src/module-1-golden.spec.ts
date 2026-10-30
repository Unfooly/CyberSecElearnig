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
// `media.scene.screen`; parsed, contentHash i clientBlocks nowe, ostrzeżenia bez zmian); D-135 (grafiki z tekstem jako krzywe -
// ponownie opublikowane, w module.json zmieniły się WYŁĄCZNIE skróty w kluczach plików `assets/.../<nazwa>.<skrót>.svg`); D-154
// (typografia: trzy „ - ” w tekstach dla gracza zamienione na półpauzę „ – ” - parsed, contentHash i clientBlocks nowe, ostrzeżenia
// bez zmian; nowa wersja kursu przy imporcie).
const MODULE_1 = join(__dirname, '..', 'modules', 'wyludzone-haslo', 'module.json');

const context = {
  shuffleSeed: (blockId: string): ShuffleSeed => [blockId.length, 7, 11, 13],
  opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}`,
};

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const GOLDEN = {
  parsed: '54565f8b0c26f3d00ec75b8154293f1ba27c0c1241972852ab2f4bb085240627',
  contentHash: 'dff6c20607cb9f9df23f8893b8512d22e32193472698483e150ee6bd10e4911b',
  clientBlocks: 'cfd91fbcddd7b5920afa6691d4940b8dba4afbf107a88a0a26d97b79265dc803',
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
